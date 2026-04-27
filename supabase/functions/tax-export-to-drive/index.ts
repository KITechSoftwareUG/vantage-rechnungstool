// Tax-Export-to-Drive — exportiert die zugeordneten Transaktionen pro Jahr
// als HTML-Datei direkt in den Year-Folder im Google Drive des Users.
//
// Auth: verify_jwt=true. JWT liefert die user_id, OAuth-Token kommen aus
// google_drive_tokens (mit Auto-Refresh wie in sync-google-drive).
//
// Pro Jahr ein File "Steuerexport-{YYYY}-{YYYY-MM-DD}.html". Wenn fuer das
// Jahr keine Year-Folder existiert (Drive-Setup unvollstaendig), wird der
// Year-Folder am Drive-Root angelegt.
//
// PDF-Links: 1 Jahr signedUrls aus Supabase Storage. Wer das HTML hat,
// kann ein Jahr lang auf die PDFs zugreifen — bewusste Entscheidung, weil
// Steuerberater die Datei laenger nutzen muss als das Default-1h-TTL der
// App-internen signedUrls erlaubt.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Lovable's strict TS-Check meckert sonst beim .from(...).insert/update wegen
// "never"-Tabellen-Typen. Lokal als any.
// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

const SIGNED_URL_TTL_SEC = 60 * 60 * 24 * 365; // 1 Jahr

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// =====================================================================
// Google Drive Helpers — Pattern aus sync-google-drive uebernommen, damit
// Token-Refresh + Folder-Lookup konsistent sind.
// =====================================================================

async function getValidAccessToken(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data: tokenData, error } = await supabase
    .from("google_drive_tokens")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (error || !tokenData) return null;

  const expiresAt = new Date(tokenData.expires_at);
  if (expiresAt > new Date()) return tokenData.access_token;

  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    console.error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET missing");
    return null;
  }

  const refreshResp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokenData.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const newTokens = await refreshResp.json();

  if (newTokens.error) {
    // Refresh-Token ist invalid -> Token-Eintrag loeschen, damit der User
    // im UI sieht, dass er Drive neu connecten muss.
    await supabase.from("google_drive_tokens").delete().eq("user_id", userId);
    return null;
  }

  await supabase
    .from("google_drive_tokens")
    .update({
      access_token: newTokens.access_token,
      expires_at: new Date(Date.now() + newTokens.expires_in * 1000).toISOString(),
    })
    .eq("user_id", userId);
  return newTokens.access_token;
}

async function findFolder(
  accessToken: string,
  name: string,
  parentId?: string,
): Promise<string | null> {
  // Apostrophes im Folder-Namen escapen (Drive Query-Syntax).
  const safe = name.replace(/'/g, "\\'");
  let q = `name='${safe}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  if (parentId) q += ` and '${parentId}' in parents`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!resp.ok) return null;
  const data = await resp.json();
  return data.files?.[0]?.id ?? null;
}

async function createFolder(
  accessToken: string,
  name: string,
  parentId?: string,
): Promise<string | null> {
  const body: Record<string, unknown> = {
    name,
    mimeType: "application/vnd.google-apps.folder",
  };
  if (parentId) body.parents = [parentId];
  const resp = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    console.error(`createFolder ${resp.status}:`, (await resp.text()).slice(0, 300));
    return null;
  }
  const data = await resp.json();
  return data.id ?? null;
}

async function findOrCreateFolder(
  accessToken: string,
  name: string,
  parentId?: string,
): Promise<string | null> {
  const existing = await findFolder(accessToken, name, parentId);
  if (existing) return existing;
  return createFolder(accessToken, name, parentId);
}

async function findFileByName(
  accessToken: string,
  name: string,
  parentId: string,
): Promise<string | null> {
  const safe = name.replace(/'/g, "\\'");
  const q = `name='${safe}' and '${parentId}' in parents and trashed=false`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!resp.ok) return null;
  const data = await resp.json();
  return data.files?.[0]?.id ?? null;
}

interface UploadResult {
  id: string;
  webViewLink: string;
}

// Drive-Upload via simple multipart. Wenn ein File mit gleichem Namen
// existiert, wird es ueberschrieben (PATCH /upload), damit der Berater
// immer die neueste Version unter derselben URL hat.
async function uploadHtmlFile(
  accessToken: string,
  html: string,
  fileName: string,
  parentId: string,
): Promise<UploadResult | null> {
  const existingId = await findFileByName(accessToken, fileName, parentId);

  const boundary = `----vantage-${crypto.randomUUID()}`;
  const metadata: Record<string, unknown> = { name: fileName };
  if (!existingId) metadata.parents = [parentId];

  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: text/html; charset=UTF-8\r\n\r\n` +
    `${html}\r\n` +
    `--${boundary}--`;

  const url = existingId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart&fields=id,webViewLink`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink`;

  const resp = await fetch(url, {
    method: existingId ? "PATCH" : "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });

  if (!resp.ok) {
    console.error(`uploadHtmlFile ${resp.status}:`, (await resp.text()).slice(0, 500));
    return null;
  }
  const data = await resp.json();
  return { id: data.id, webViewLink: data.webViewLink };
}

// =====================================================================
// HTML Builder — gleiche Optik wie der Frontend-HTML-Download.
// =====================================================================

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatEur(amount: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(amount);
}

function formatDateDe(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

interface ExportRow {
  date: string;
  description: string;
  amount: number;
  transaction_type: "debit" | "credit";
  bank: string | null;
  isCash: boolean;
  invoice: {
    fileName: string;
    issuer: string;
    invoiceNumber: string | null;
    signedUrl: string | null;
  } | null;
}

function buildHtml(year: number, rows: ExportRow[], generatedAt: Date): string {
  const validUntil = new Date(generatedAt.getTime() + 365 * 24 * 60 * 60 * 1000);

  const saldo = rows.reduce((sum, r) => {
    return sum + (r.transaction_type === "credit" ? r.amount : -Math.abs(r.amount));
  }, 0);

  const rowsHtml = rows
    .map((r) => {
      const isDebit = r.transaction_type === "debit";
      const sign = isDebit ? "−" : "+";
      const cls = isDebit ? "debit" : "credit";
      const date = formatDateDe(r.date);
      const desc = escapeHtml(r.description ?? "");
      const quelle = r.isCash ? "Kasse" : escapeHtml(r.bank ?? "—");
      const inv = r.invoice;
      const linkCell = inv && inv.signedUrl
        ? `<a href="${escapeHtml(inv.signedUrl)}" target="_blank" rel="noopener noreferrer">${
            inv.invoiceNumber ? `#${escapeHtml(inv.invoiceNumber)} · ` : ""
          }${escapeHtml(inv.issuer)}</a>`
        : inv
        ? `<span class="muted">${escapeHtml(inv.issuer)} (Datei nicht erreichbar)</span>`
        : `<span class="muted">—</span>`;

      return `<tr>
  <td class="num">${date}</td>
  <td>${desc}</td>
  <td>${quelle}</td>
  <td class="num amount ${cls}">${sign}${formatEur(Math.abs(r.amount))}</td>
  <td>${linkCell}</td>
</tr>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>Steuerexport ${year}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 32px 24px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    color: #1a1a1a;
    background: #f7f7f8;
    line-height: 1.5;
  }
  main { max-width: 1100px; margin: 0 auto; }
  header { border-bottom: 2px solid #d8d8dc; padding-bottom: 16px; margin-bottom: 24px; }
  h1 { font-size: 28px; margin: 0 0 4px; font-weight: 700; }
  h2 { font-size: 18px; margin: 32px 0 12px; font-weight: 600; }
  .meta { font-size: 13px; color: #6b6b73; margin: 0; }
  .muted { color: #8a8a92; font-weight: 400; font-size: 13px; }
  table {
    width: 100%; border-collapse: collapse; background: #fff;
    border: 1px solid #e3e3e7; border-radius: 6px; overflow: hidden; font-size: 14px;
  }
  thead th {
    text-align: left; background: #f0f0f3; color: #4a4a52;
    font-weight: 600; font-size: 12px; text-transform: uppercase;
    letter-spacing: 0.04em; padding: 10px 14px; border-bottom: 1px solid #e3e3e7;
  }
  tbody td { padding: 10px 14px; border-bottom: 1px solid #ececef; vertical-align: top; }
  tbody tr:last-child td { border-bottom: 0; }
  tbody tr:hover { background: #fafafb; }
  td.num, th.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  td.amount { font-weight: 600; }
  td.amount.debit { color: #b22222; }
  td.amount.credit { color: #1f7a3a; }
  a { color: #1f5fbe; text-decoration: none; border-bottom: 1px solid transparent; }
  a:hover { border-bottom-color: #1f5fbe; }
  footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #d8d8dc; font-size: 12px; color: #8a8a92; }
  @media print {
    body { background: #fff; padding: 0; }
    main { max-width: none; }
    table { border: 1px solid #ccc; }
    tbody tr:hover { background: transparent; }
    a { color: #000; border-bottom: 1px solid #999; }
  }
</style>
</head>
<body>
<main>
  <header>
    <h1>Steuerexport ${year}</h1>
    <p class="meta">Erstellt am ${formatDateDe(generatedAt.toISOString())} · ${
    rows.length
  } ${rows.length === 1 ? "Buchung" : "Buchungen"} · Saldo ${formatEur(
    saldo,
  )} · Rechnungs-Links gueltig bis ${formatDateDe(validUntil.toISOString())}</p>
  </header>
  <table>
    <thead>
      <tr>
        <th>Datum</th>
        <th>Beschreibung</th>
        <th>Quelle</th>
        <th class="num">Betrag</th>
        <th>Rechnung</th>
      </tr>
    </thead>
    <tbody>
${rowsHtml}
    </tbody>
  </table>
  <footer>
    Erzeugt von Vantage Rechnungstool. Klick auf eine Rechnung oeffnet das
    PDF im Browser. Alle Links sind privat signiert und laufen am
    ${formatDateDe(validUntil.toISOString())} ab — fuer aelteren Zugriff
    einen neuen Export generieren.
  </footer>
</main>
</body>
</html>`;
}

// =====================================================================
// Main Handler
// =====================================================================

interface UploadedFile {
  year: number;
  fileName: string;
  webViewLink: string;
  rowCount: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse(405, { ok: false, error: "method_not_allowed" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !supabaseServiceKey) {
    return jsonResponse(500, { ok: false, error: "server_misconfigured" });
  }
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // --- User aus JWT ---
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return jsonResponse(401, { ok: false, error: "missing_auth" });
  const { data: userResult, error: userErr } = await supabase.auth.getUser(jwt);
  if (userErr || !userResult?.user) {
    return jsonResponse(401, { ok: false, error: "invalid_auth" });
  }
  const userId = userResult.user.id;

  // --- Drive-Token holen ---
  const accessToken = await getValidAccessToken(supabase, userId);
  if (!accessToken) {
    return jsonResponse(412, {
      ok: false,
      error: "drive_not_connected",
      detail: "Bitte Google Drive in den Einstellungen neu verbinden.",
    });
  }

  // --- Transaktionen + Invoices laden ---
  // Single-User-Setup: KEIN user_id-Filter (Memory: "authenticated sees
  // all"). Daten liegen unter Alex' UUID, der eingeloggte User hat ggf.
  // eine andere UUID (Dev-Account). user_id der Invoice nehmen wir aus
  // der Row selbst fuer den Storage-Pfad.
  const { data: txData, error: txErr } = await supabase
    .from("bank_transactions")
    .select(`
      id, date, description, amount, transaction_type, matched_invoice_id, bank_statement_id,
      invoices!bank_transactions_matched_invoice_id_fkey (
        id, user_id, file_name, file_url, issuer, amount, date, type, year, month, invoice_number
      ),
      bank_statements!bank_transactions_bank_statement_id_fkey ( bank, bank_type )
    `)
    .eq("match_status", "confirmed")
    .not("matched_invoice_id", "is", null)
    .order("date", { ascending: true });

  if (txErr) {
    console.error("tx load failed:", txErr);
    return jsonResponse(500, { ok: false, error: "db_error" });
  }
  const txs = (txData ?? []) as Array<Record<string, any>>;
  if (txs.length === 0) {
    return jsonResponse(200, { ok: true, uploaded: [], message: "Keine zugeordneten Transaktionen." });
  }

  // --- Pro Jahr gruppieren (basierend auf transaction.date) ---
  const byYear = new Map<number, ExportRow[]>();
  for (const t of txs) {
    const d = new Date(t.date);
    if (Number.isNaN(d.getTime())) continue;
    const year = d.getFullYear();

    let signedUrl: string | null = null;
    const inv = t.invoices;
    if (inv) {
      // user_id des Invoice-Owners aus der Row (nicht JWT-userId), siehe
      // Kommentar bei der Query oben.
      const ownerId = inv.user_id ?? userId;
      const ivYear = Number(inv.year) || (new Date(inv.date).getFullYear());
      const ivMonth = Number(inv.month) || (new Date(inv.date).getMonth() + 1);
      const path = `${ownerId}/${ivYear}/${ivMonth}/${inv.file_name}`;
      const { data: signed } = await supabase.storage
        .from("documents")
        .createSignedUrl(path, SIGNED_URL_TTL_SEC);
      if (signed?.signedUrl) {
        signedUrl = signed.signedUrl;
      } else {
        // Fallback auf zero-padded Month, wie resolveStorageUrl es im Frontend macht.
        const path2 = `${ownerId}/${ivYear}/${String(ivMonth).padStart(2, "0")}/${inv.file_name}`;
        const { data: signed2 } = await supabase.storage
          .from("documents")
          .createSignedUrl(path2, SIGNED_URL_TTL_SEC);
        if (signed2?.signedUrl) signedUrl = signed2.signedUrl;
      }
    }

    const row: ExportRow = {
      date: t.date,
      description: t.description ?? "",
      amount: Number(t.amount),
      transaction_type: t.transaction_type as "debit" | "credit",
      bank: t.bank_statements?.bank ?? null,
      isCash: !t.bank_statement_id,
      invoice: inv
        ? {
            fileName: inv.file_name,
            issuer: inv.issuer,
            invoiceNumber: inv.invoice_number ?? null,
            signedUrl,
          }
        : null,
    };
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year)!.push(row);
  }

  // --- Pro Jahr: HTML bauen, Year-Folder finden/erstellen, hochladen ---
  const generatedAt = new Date();
  const stamp = `${generatedAt.getFullYear()}-${String(generatedAt.getMonth() + 1).padStart(2, "0")}-${String(generatedAt.getDate()).padStart(2, "0")}`;
  const uploaded: UploadedFile[] = [];
  const failed: Array<{ year: number; reason: string }> = [];

  for (const [year, rows] of byYear) {
    const html = buildHtml(year, rows, generatedAt);

    // Year-Folder finden — der User legt diese normalerweise selbst an.
    // Wenn er fehlt: anlegen, damit der Export auch beim "leeren" Drive
    // funktioniert.
    const yearFolderId = await findOrCreateFolder(accessToken, String(year));
    if (!yearFolderId) {
      failed.push({ year, reason: "year_folder_unavailable" });
      continue;
    }

    const fileName = `Steuerexport-${year}-${stamp}.html`;
    const result = await uploadHtmlFile(accessToken, html, fileName, yearFolderId);
    if (!result) {
      failed.push({ year, reason: "upload_failed" });
      continue;
    }
    uploaded.push({
      year,
      fileName,
      webViewLink: result.webViewLink,
      rowCount: rows.length,
    });
  }

  return jsonResponse(200, { ok: true, uploaded, failed });
});
