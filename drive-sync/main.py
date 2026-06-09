from __future__ import annotations

import asyncio
import os
import random
import re
from collections import OrderedDict, deque
from contextlib import asynccontextmanager
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from workflow_config import WATCHES, WorkflowWatch


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_PATH = "/" + os.getenv("APP_BASE_PATH", "").strip("/") if os.getenv("APP_BASE_PATH", "").strip("/") else ""
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_DRIVE_CLIENT_ID", "").strip()
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_DRIVE_CLIENT_SECRET", "").strip()
GOOGLE_REFRESH_TOKEN = os.getenv("GOOGLE_DRIVE_REFRESH_TOKEN", "").strip()
WORKFLOW_TARGET_BASE_URL = os.getenv("WORKFLOW_TARGET_BASE_URL", "").rstrip("/")
WORKFLOW_TARGET_API_KEY = os.getenv("WORKFLOW_TARGET_API_KEY", "").strip()
WORKFLOW_TARGET_USER_ID = os.getenv("WORKFLOW_TARGET_USER_ID", "").strip()
WORKFLOW_POLL_SECONDS = int(os.getenv("WORKFLOW_POLL_SECONDS", "20"))
WORKFLOW_SEEN_IDS_MAX = int(os.getenv("WORKFLOW_SEEN_IDS_MAX", "5000"))
WORKFLOW_SKIP_EXISTING_ON_START = os.getenv("WORKFLOW_SKIP_EXISTING_ON_START", "true").lower() == "true"
WORKFLOW_LIST_PAGE_SIZE = int(os.getenv("WORKFLOW_LIST_PAGE_SIZE", "100"))
WORKFLOW_MAX_PARALLEL_TRANSFERS = int(os.getenv("WORKFLOW_MAX_PARALLEL_TRANSFERS", "6"))
WORKFLOW_FORWARD_MAX_RETRIES = int(os.getenv("WORKFLOW_FORWARD_MAX_RETRIES", "5"))
WORKFLOW_RETRY_BASE_SECONDS = float(os.getenv("WORKFLOW_RETRY_BASE_SECONDS", "1.5"))
WORKFLOW_CHECKPOINT_OVERLAP_SECONDS = int(os.getenv("WORKFLOW_CHECKPOINT_OVERLAP_SECONDS", "2"))
WORKFLOW_INCLUDE_SUBFOLDERS_FOR_NON_MONTHLY = os.getenv("WORKFLOW_INCLUDE_SUBFOLDERS_FOR_NON_MONTHLY", "true").lower() == "true"


@dataclass
class ForwardEvent:
    timestamp: str
    watch_slug: str
    watch_name: str
    category: str
    year: str
    month: str | None
    file_id: str
    file_name: str
    mime_type: str
    status: str
    detail: str
    target_url: str


class _LRUSet:
    """Bounded LRU set: jüngste Inserts überleben, älteste werden evicted.

    Vorher: `set[str]` ohne Obergrenze → Memory-Leak bei Konten mit
    10k+ Drive-Files über die Lebenszeit des Service.
    """

    __slots__ = ("_data", "_max")

    def __init__(self, max_size: int) -> None:
        self._data: OrderedDict[str, None] = OrderedDict()
        self._max = max_size

    def __contains__(self, key: object) -> bool:
        return key in self._data

    def __len__(self) -> int:
        return len(self._data)

    def add(self, key: str) -> None:
        if key in self._data:
            self._data.move_to_end(key)
            return
        self._data[key] = None
        while len(self._data) > self._max:
            self._data.popitem(last=False)

    def clear(self) -> None:
        self._data.clear()


class RuntimeState:
    def __init__(self) -> None:
        self.access_token: str | None = None
        self.access_token_expires_at: datetime | None = None
        self.last_checked: dict[str, datetime] = {}
        self.seen_file_ids: _LRUSet = _LRUSet(WORKFLOW_SEEN_IDS_MAX)
        self.recent_events: deque[ForwardEvent] = deque(maxlen=500)
        self.poll_task: asyncio.Task[Any] | None = None
        self.running = False

    def bootstrap(self) -> None:
        now = datetime.now(UTC)
        initial = now if WORKFLOW_SKIP_EXISTING_ON_START else now - timedelta(minutes=10)
        for watch in WATCHES:
            self.last_checked[watch.slug] = initial
        self.running = True

    def record(self, event: ForwardEvent) -> None:
        self.recent_events.appendleft(event)


state = RuntimeState()


def require_config() -> None:
    missing = [
        name
        for name, value in [
            ("GOOGLE_DRIVE_CLIENT_ID", GOOGLE_CLIENT_ID),
            ("GOOGLE_DRIVE_CLIENT_SECRET", GOOGLE_CLIENT_SECRET),
            ("GOOGLE_DRIVE_REFRESH_TOKEN", GOOGLE_REFRESH_TOKEN),
            ("WORKFLOW_TARGET_BASE_URL", WORKFLOW_TARGET_BASE_URL),
            ("WORKFLOW_TARGET_API_KEY", WORKFLOW_TARGET_API_KEY),
            ("WORKFLOW_TARGET_USER_ID", WORKFLOW_TARGET_USER_ID),
        ]
        if not value
    ]
    if missing:
        raise RuntimeError(f"Missing workflow configuration: {', '.join(missing)}")


async def get_access_token() -> str:
    now = datetime.now(UTC)
    if state.access_token and state.access_token_expires_at and state.access_token_expires_at > now + timedelta(seconds=30):
        return state.access_token

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "client_id": GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "refresh_token": GOOGLE_REFRESH_TOKEN,
                "grant_type": "refresh_token",
            },
        )
        response.raise_for_status()
        payload = response.json()

    state.access_token = payload["access_token"]
    state.access_token_expires_at = now + timedelta(seconds=int(payload.get("expires_in", 3600)))
    return state.access_token


def parse_drive_timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def get_modified_time(file_data: dict[str, Any]) -> datetime | None:
    return parse_drive_timestamp(file_data.get("modifiedTime"))


def extract_date_from_filename(file_name: str) -> datetime | None:
    if not file_name:
        return None

    patterns = [
        r"(20\d{2})[-_.](0[1-9]|1[0-2])[-_.](0[1-9]|[12]\d|3[01])",  # YYYY-MM-DD / YYYY.MM.DD / YYYY_MM_DD
        r"(0[1-9]|[12]\d|3[01])[-_.](0[1-9]|1[0-2])[-_.](20\d{2})",  # DD-MM-YYYY / DD.MM.YYYY / DD_MM_YYYY
    ]

    for index, pattern in enumerate(patterns):
        match = re.search(pattern, file_name)
        if not match:
            continue
        try:
            if index == 0:
                year, month, day = match.groups()
            else:
                day, month, year = match.groups()
            return datetime(int(year), int(month), int(day), tzinfo=UTC)
        except ValueError:
            continue
    return None


def resolve_month_for_file(watch: WorkflowWatch, file_data: dict[str, Any]) -> str:
    file_name = file_data.get("name", "")
    parsed_date = extract_date_from_filename(file_name)
    if parsed_date:
        return f"{parsed_date.month:02d}"

    if watch.month:
        return watch.month

    modified_time = get_modified_time(file_data)
    if modified_time:
        return f"{modified_time.month:02d}"

    created_time = parse_drive_timestamp(file_data.get("createdTime"))
    if created_time:
        return f"{created_time.month:02d}"

    # Fallback to current UTC month if no timestamp is available.
    return f"{datetime.now(UTC).month:02d}"


def should_retry_exception(exc: Exception) -> bool:
    if isinstance(exc, (httpx.TimeoutException, httpx.NetworkError)):
        return True
    if isinstance(exc, httpx.HTTPStatusError):
        status = exc.response.status_code
        return status in {408, 409, 425, 429, 500, 502, 503, 504, 521, 522, 524}
    return False


async def list_files_for_watch(watch: WorkflowWatch, created_after: datetime | None = None) -> list[dict[str, Any]]:
    token = await get_access_token()
    parent_ids = [watch.folder_id]
    if WORKFLOW_INCLUDE_SUBFOLDERS_FOR_NON_MONTHLY and watch.month is None:
        async with httpx.AsyncClient(timeout=30) as client:
            folders_response = await client.get(
                "https://www.googleapis.com/drive/v3/files",
                params={
                    "q": f"'{watch.folder_id}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder'",
                    "orderBy": "name asc",
                    "pageSize": "200",
                    "fields": "files(id,name)",
                    "supportsAllDrives": "true",
                    "includeItemsFromAllDrives": "true",
                },
                headers={"Authorization": f"Bearer {token}"},
            )
            folders_response.raise_for_status()
            for folder in folders_response.json().get("files", []):
                folder_id = folder.get("id")
                if folder_id:
                    parent_ids.append(folder_id)

    parent_clauses = [f"'{parent_id}' in parents" for parent_id in parent_ids]
    query_parts = [
        f"({' or '.join(parent_clauses)})",
        "trashed = false",
        "mimeType != 'application/vnd.google-apps.folder'",
    ]
    if created_after:
        # `modifiedTime` is more reliable than `createdTime` for files copied/moved into folders.
        query_parts.append(f"modifiedTime > '{created_after.astimezone(UTC).strftime('%Y-%m-%dT%H:%M:%SZ')}'")

    all_files: list[dict[str, Any]] = []
    page_token: str | None = None

    async with httpx.AsyncClient(timeout=30) as client:
        while True:
            params = {
                "q": " and ".join(query_parts),
                "orderBy": "modifiedTime asc,name asc",
                "pageSize": str(max(1, WORKFLOW_LIST_PAGE_SIZE)),
                "fields": "nextPageToken,files(id,name,mimeType,createdTime,modifiedTime,parents,size,md5Checksum)",
                "supportsAllDrives": "true",
                "includeItemsFromAllDrives": "true",
            }
            if page_token:
                params["pageToken"] = page_token

            response = await client.get(
                "https://www.googleapis.com/drive/v3/files",
                params=params,
                headers={"Authorization": f"Bearer {token}"},
            )
            response.raise_for_status()
            data = response.json()
            all_files.extend(data.get("files", []))
            page_token = data.get("nextPageToken")
            if not page_token:
                break

    return all_files


async def download_file(file_id: str) -> tuple[bytes, str]:
    token = await get_access_token()
    async with httpx.AsyncClient(timeout=120) as client:
        meta_response = await client.get(
            f"https://www.googleapis.com/drive/v3/files/{file_id}",
            params={
                "fields": "id,name,mimeType,createdTime,parents,size",
                "supportsAllDrives": "true",
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        meta_response.raise_for_status()
        metadata = meta_response.json()

        mime_type = metadata.get("mimeType", "application/octet-stream")
        if mime_type.startswith("application/vnd.google-apps"):
            raise HTTPException(status_code=400, detail=f"Google-native Datei wird noch nicht unterstuetzt: {mime_type}")

        content_response = await client.get(
            f"https://www.googleapis.com/drive/v3/files/{file_id}",
            params={"alt": "media", "supportsAllDrives": "true"},
            headers={"Authorization": f"Bearer {token}"},
        )
        content_response.raise_for_status()

    return content_response.content, mime_type


def build_target_url(watch: WorkflowWatch, month: str) -> str:
    return f"{WORKFLOW_TARGET_BASE_URL}/{watch.category}/{watch.year}/{month}"


async def forward_file(watch: WorkflowWatch, file_data: dict[str, Any]) -> ForwardEvent:
    file_id = file_data["id"]
    file_name = file_data["name"]
    effective_month = resolve_month_for_file(watch, file_data)
    target_url = build_target_url(watch, effective_month)

    last_error: Exception | None = None
    for attempt in range(1, max(1, WORKFLOW_FORWARD_MAX_RETRIES) + 1):
        try:
            file_bytes, mime_type = await download_file(file_id)
            async with httpx.AsyncClient(timeout=180) as client:
                response = await client.post(
                    target_url,
                    params={
                        "user_id": WORKFLOW_TARGET_USER_ID,
                        "drive_file_id": file_id,
                        "file_name": file_name,
                    },
                    headers={
                        "x-api-key": WORKFLOW_TARGET_API_KEY,
                        "Content-Type": mime_type,
                    },
                    content=file_bytes,
                )
                response.raise_for_status()
                response_text = response.text[:300]

            event = ForwardEvent(
                timestamp=datetime.now(UTC).isoformat(),
                watch_slug=watch.slug,
                watch_name=watch.name,
                category=watch.category,
                year=watch.year,
                month=effective_month,
                file_id=file_id,
                file_name=file_name,
                mime_type=mime_type,
                status="success",
                detail=response_text or "OK",
                target_url=target_url,
            )
            state.seen_file_ids.add(file_id)
            state.record(event)
            return event
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            if attempt >= max(1, WORKFLOW_FORWARD_MAX_RETRIES) or not should_retry_exception(exc):
                break
            jitter = random.uniform(0.0, 0.25)
            backoff_seconds = (WORKFLOW_RETRY_BASE_SECONDS * (2 ** (attempt - 1))) + jitter
            await asyncio.sleep(backoff_seconds)

    event = ForwardEvent(
        timestamp=datetime.now(UTC).isoformat(),
        watch_slug=watch.slug,
        watch_name=watch.name,
        category=watch.category,
        year=watch.year,
        month=effective_month,
        file_id=file_id,
        file_name=file_name,
        mime_type=file_data.get("mimeType", "unknown"),
        status="error",
        detail=str(last_error) if last_error else "Unbekannter Fehler",
        target_url=target_url,
    )
    state.record(event)
    # Auch bei Fehler die file_id als "gesehen" markieren, sonst hämmert der
    # Poller das kaputte File alle 10 Sekunden endlos. Bei Container-Restart
    # wird seen_file_ids geleert, dann kann ein echter Retry passieren.
    state.seen_file_ids.add(file_id)
    return event


async def run_watch_once(watch: WorkflowWatch, include_existing: bool = False) -> list[ForwardEvent]:
    created_after = None if include_existing else state.last_checked.get(watch.slug)
    files = await list_files_for_watch(watch, created_after=created_after)
    results: list[ForwardEvent] = []
    latest_seen = created_after
    processing_candidates: list[dict[str, Any]] = []

    for file_data in files:
        modified_time = get_modified_time(file_data)
        if modified_time and (latest_seen is None or modified_time > latest_seen):
            latest_seen = modified_time
        if file_data["id"] in state.seen_file_ids:
            continue
        processing_candidates.append(file_data)

    semaphore = asyncio.Semaphore(max(1, WORKFLOW_MAX_PARALLEL_TRANSFERS))

    async def process_with_limit(file_data: dict[str, Any]) -> ForwardEvent:
        async with semaphore:
            return await forward_file(watch, file_data)

    tasks = [asyncio.create_task(process_with_limit(file_data)) for file_data in processing_candidates]
    if tasks:
        results = await asyncio.gather(*tasks)

    failed_modified_times: list[datetime] = []
    file_by_id = {item["id"]: item for item in processing_candidates}
    for result in results:
        if result.status == "success":
            continue
        failed_file = file_by_id.get(result.file_id)
        failed_time = get_modified_time(failed_file or {})
        if failed_time:
            failed_modified_times.append(failed_time)

    overlap = timedelta(seconds=max(0, WORKFLOW_CHECKPOINT_OVERLAP_SECONDS))
    if failed_modified_times:
        failure_checkpoint = min(failed_modified_times) - overlap
        state.last_checked[watch.slug] = failure_checkpoint
    elif latest_seen:
        state.last_checked[watch.slug] = latest_seen - overlap
    else:
        state.last_checked[watch.slug] = datetime.now(UTC)

    return results


async def poll_loop() -> None:
    while state.running:
        for watch in WATCHES:
            try:
                await run_watch_once(watch)
            except Exception as exc:  # noqa: BLE001
                state.record(
                    ForwardEvent(
                        timestamp=datetime.now(UTC).isoformat(),
                        watch_slug=watch.slug,
                        watch_name=watch.name,
                        category=watch.category,
                        year=watch.year,
                        month=watch.month,
                        file_id="-",
                        file_name="-",
                        mime_type="-",
                        status="error",
                        detail=f"Polling-Fehler: {exc}",
                        target_url=build_target_url(watch, watch.month or f"{datetime.now(UTC).month:02d}"),
                    )
                )
        await asyncio.sleep(WORKFLOW_POLL_SECONDS)


@asynccontextmanager
async def lifespan(_: FastAPI):
    require_config()
    state.bootstrap()
    state.poll_task = asyncio.create_task(poll_loop())
    try:
        yield
    finally:
        state.running = False
        if state.poll_task:
            state.poll_task.cancel()
            try:
                await state.poll_task
            except asyncio.CancelledError:
                pass


app = FastAPI(title="Rechnungsaufnahme 2026 Runner", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=os.path.join(BASE_DIR, "static")), name="static")
templates = Jinja2Templates(directory=os.path.join(BASE_DIR, "templates"))


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/", response_class=HTMLResponse)
def index(request: Request) -> HTMLResponse:
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={
            "base_path": BASE_PATH,
            "watches": WATCHES,
            "events": list(state.recent_events),
            "poll_seconds": WORKFLOW_POLL_SECONDS,
            "skip_existing": WORKFLOW_SKIP_EXISTING_ON_START,
        },
    )


@app.get("/api/status")
def status() -> JSONResponse:
    return JSONResponse(
        {
            "running": state.running,
            "poll_seconds": WORKFLOW_POLL_SECONDS,
            "skip_existing_on_start": WORKFLOW_SKIP_EXISTING_ON_START,
            "last_checked": {slug: ts.isoformat() for slug, ts in state.last_checked.items()},
            "seen_file_ids_count": len(state.seen_file_ids),
            "watches": [asdict(watch) for watch in WATCHES],
            "recent_events": [asdict(event) for event in state.recent_events],
        }
    )


@app.post("/api/test/run-once")
async def run_all_once() -> JSONResponse:
    all_results: list[dict[str, Any]] = []
    for watch in WATCHES:
        results = await run_watch_once(watch)
        all_results.extend(asdict(result) for result in results)
    return JSONResponse({"results": all_results, "count": len(all_results)})


@app.post("/api/test/reset")
def reset_runtime(hours_back: int = 1, clear_seen: bool = True) -> JSONResponse:
    now = datetime.now(UTC)
    checkpoint = now - timedelta(hours=max(hours_back, 0))
    for watch in WATCHES:
        state.last_checked[watch.slug] = checkpoint
    if clear_seen:
        state.seen_file_ids.clear()
    state.recent_events.clear()
    return JSONResponse(
        {
            "ok": True,
            "checkpoint": checkpoint.isoformat(),
            "clear_seen": clear_seen,
            "watches_updated": len(WATCHES),
        }
    )


@app.post("/api/test/process-latest/{watch_slug}")
async def process_latest(watch_slug: str) -> JSONResponse:
    watch = next((item for item in WATCHES if item.slug == watch_slug), None)
    if watch is None:
        raise HTTPException(status_code=404, detail="Watch nicht gefunden")

    files = await list_files_for_watch(watch, created_after=None)
    if not files:
        raise HTTPException(status_code=404, detail="Keine Dateien in diesem Ordner gefunden")

    latest = files[-1]
    result = await forward_file(watch, latest)
    return JSONResponse({"result": asdict(result)})


@app.post("/test/process-latest/{watch_slug}")
async def process_latest_redirect(watch_slug: str) -> RedirectResponse:
    await process_latest(watch_slug)
    target = f"{BASE_PATH}/" if BASE_PATH else "/"
    return RedirectResponse(target, status_code=303)
