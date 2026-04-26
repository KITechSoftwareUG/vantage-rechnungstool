# CLAUDE.md — vantage-rechnungstool

Kontext für Claude Code. Vor jeder Session **einmal komplett lesen**, bevor du
Annahmen triffst oder Code änderst.

## ⚠️ WICHTIG: Lovable ist Source of Truth

**Backend und Deployment laufen über Lovable.** Das betrifft insbesondere:
- **Auth** (Supabase Auth wird über Lovable konfiguriert)
- **Edge Functions** (Deployment über Lovable, nicht manuell via Supabase-CLI)
- **Datenbank / Supabase-Integration**
- **Frontend-Deployment** (läuft über Lovable, nicht über Docker-Build auf
  diesem Server)

Der Docker-Build auf diesem Server ist nur für **lokales Prototyping /
Entwicklung**. Produktive Änderungen an Backend, Auth oder Edge Functions
dürfen nicht am Lovable-Deployment vorbei gemacht werden.

## Repo

- Working directory: `/opt/app/vantage-rechnungstool`
- Remote: https://github.com/KITechSoftwareUG/vantage-rechnungstool (branch `main`)
- **Zwei-Richtungs-Sync mit Lovable.** Lovable kann jederzeit pushen.
  - Vor jeder Session: `git status` + `git pull`.
  - Vor jedem eigenen Commit prüfen, ob seitdem von Lovable etwas reingekommen ist.
  - Lokale uncommittete Änderungen können von einer früheren Session liegen
    (z. B. PDF-Preview-Fixes via `createSignedUrl`, [src/lib/resolveStorageUrl.ts](src/lib/resolveStorageUrl.ts)).
    Erst lesen, dann handeln.

## Architektur

**n8n wird in diesem Projekt NICHT benutzt.** Wenn du den Namen siehst, ist es
Legacy.

### Frontend
- React + Vite + TypeScript, gebaut über Docker.
- Container: `rechnungstool-web`, definiert in `/opt/app/docker-compose.yml`.
- Port-Bind: `172.17.0.1:8790:80`, ausgeliefert über elestio-nginx unter
  `/rechnungstool/`.
- Vite base path kommt aus dem Build-Arg `VITE_APP_BASE_PATH=/rechnungstool/`.

### Backend
- **Supabase Cloud** (nicht selbst-gehostet). Client: [src/integrations/supabase/client.ts](src/integrations/supabase/client.ts).
- Edge Functions liegen in [supabase/functions/](supabase/functions/).
  Deployment über Supabase-CLI oder Supabase-Dashboard, **nicht** über Docker
  hier auf dem Server.
- Die Function `n8n-webhook` heißt nur **historisch** so — sie hat **nichts**
  mit n8n zu tun. Sie ist der Drive-Ingest-Endpoint.

### Drive-Polling
- Separate Python-FastAPI-App in `/opt/app/app/` (Service `workflow-app`,
  Port 8788).
- Pollt Google Drive direkt mit einem Refresh-Token und postet Files an die
  Supabase-Edge-Function.

### Toter Ballast
- Die Container `n8n`, `n8n-worker` und `task-runners` im
  `/opt/app/docker-compose.yml` sind Reste vom Elestio-Template.
- **Kein Ingestion-Pfad berührt sie.** Nicht reparieren, nicht referenzieren,
  nicht in neuer Doku erwähnen.

## Supabase Storage

- Bucket: `documents`
- Pfad-Schema: `{userId}/{year}/{month}/{fileName}`
- PDF-Previews: Die in der DB gespeicherte `file_url` ist manchmal eine
  interne, vom Browser nicht erreichbare URL. Deswegen erzeugt
  [src/lib/resolveStorageUrl.ts](src/lib/resolveStorageUrl.ts) immer einen
  frischen `signedUrl` via `createSignedUrl`. Nicht durch Direkt-URLs ersetzen.

## Deploy-Workflow (auf diesem Server)

```bash
cd /opt/app
docker compose build rechnungstool-web
docker compose up -d rechnungstool-web
```

- Vor jedem Build: `git status` muss klar genug sein, dass du weißt, **was**
  du baust.
- **Niemals** Live-Files unter `/var/lib/docker/overlay2/...` anfassen — das
  sind Build-Layer, keine Quelle.
- Nginx-Route ist in `/opt/app/scripts/postInstall.sh` dokumentiert und in
  elestio-nginx live aktiv. Im Normalfall nicht anfassen.

## Zahnfunnel — externe Landingpage-Integration

Das Zahnfunnel-Lead-Modul wird vom externen Lovable-Projekt
`zahn-versteher-portal` (Repo `github.com/KITechSoftwareUG/zahn-versteher-portal`)
befuettert. Das Frontend dort baut den Request als
`POST ${VITE_API_URL}/webhook/form` mit Header `X-Api-Key`.

Da Supabase Edge Functions zwingend unter `/functions/v1/<name>` gemountet
sind, MUSS die Lovable-Env so gesetzt sein, dass der Subpfad an unsere
Function geroutet wird:

```
VITE_API_URL=https://fqjptwpdihwqdfxorvqq.supabase.co/functions/v1/zahnfunnel-form-webhook
VITE_FORM_API_KEY=<gleicher Wert wie FORM_API_KEY in app_config>
```

Supabase reicht beliebige Subpfade (`…/zahnfunnel-form-webhook/webhook/form`)
an die Function durch — die Function selbst ignoriert den URL-Pfad und
prueft nur die Methode. Verifiziert mit n8n-webhook am 2026-04-26.

WhatsApp-Webhook analog:
`https://fqjptwpdihwqdfxorvqq.supabase.co/functions/v1/zahnfunnel-whatsapp-webhook`
(Meta-Setup, GET = Verify, POST = Inbound).

Lead-Liste fuer das interne Dashboard laeuft NICHT ueber einen REST-Endpoint —
das Frontend liest direkt via Supabase-Client (RLS: `authenticated sees all`,
[src/hooks/useLeads.ts](src/hooks/useLeads.ts)).

## Regeln

- **Original lesen, nicht raten**, bevor du Code änderst.
- **Root Cause statt Fallback-Stapel.** Wenn etwas nicht geht, erst die
  Ursache finden, dann fixen.
- **Kein n8n** in neuen Code-Pfaden, Funktionsnamen oder Doku. Der Name
  `n8n-webhook` bleibt stehen, weil es eine bereits deployed Edge Function
  ist — aber neuer Code referenziert n8n nicht.
- Vor `docker compose build`: `git status` checken.
