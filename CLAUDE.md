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

### Externes Lovable-Projekt
- **Repo**: `github.com/KITechSoftwareUG/zahn-versteher-portal`
- **Live**: https://zahn-versteher-portal.lovable.app
- **Preview**: https://id-preview--9f47078c-b1f4-4adf-91d0-1963ad0b8d12.lovable.app
- **Eigene Domain**: noch nicht verbunden
- **Stack**: React 18 + Vite + TS + Tailwind + shadcn/ui, Lovable-deployed
- **Eigenes Lovable-Cloud-Projekt (Supabase, Ref `nsatkehqrsisaztjfuxk`)**:
  aktiviert, aber **bewusst leer**. Wir nutzen es NICHT zur Lead-Speicherung.
- Im Repo liegt zusätzlich ein altes FastAPI-Backend (`app/`), das in
  Lovable **nicht aktiv** ist — Legacy, ignorieren.

### Wo Leads landen (Architektur-Entscheidung)
Leads werden NICHT im Lovable-Cloud-Projekt des `zahn-versteher-portal`
gespeichert, sondern direkt in **unserem** Supabase
(`fqjptwpdihwqdfxorvqq`, Tabelle `public.leads`,
Migration [supabase/migrations/20260424120000_zahnfunnel_schema.sql](supabase/migrations/20260424120000_zahnfunnel_schema.sql)).

Grund: Das interne Dashboard ([src/hooks/useLeads.ts](src/hooks/useLeads.ts))
liest Leads direkt via Supabase-Client (RLS: `authenticated sees all`),
WhatsApp-Inbox läuft hier, Alex' OS-System lebt hier — alles in einem
Backend statt zwei. Deshalb gilt **Option A** (direkter Webhook
Frontend → unsere Edge Function), keine Sync-Pipeline.

### Frontend-Konfig (Lovable-Env im `zahn-versteher-portal`)
Der Funnel POSTet als `POST ${VITE_API_URL}/webhook/form` mit
Header `X-Api-Key`. Da Supabase Edge Functions zwingend unter
`/functions/v1/<name>` gemountet sind, MUSS die Env so gesetzt sein,
dass der Subpfad an unsere Function geroutet wird:

```
VITE_API_URL=https://fqjptwpdihwqdfxorvqq.supabase.co/functions/v1/zahnfunnel-form-webhook
VITE_FORM_API_KEY=<gleicher Wert wie FORM_API_KEY in app_config>
```

Supabase reicht beliebige Subpfade (`…/zahnfunnel-form-webhook/webhook/form`)
an die Function durch — die Function selbst ignoriert den URL-Pfad und
prueft nur die Methode. Verifiziert mit n8n-webhook am 2026-04-26.

### Payload-Vertrag (Edge Function)
Die Function akzeptiert das deutschsprachige Schema des Funnels direkt:

| DB-Spalte (`public.leads`) | Pflicht | Top-Level-Aliase im Payload          |
|---------------------------|---------|---------------------------------------|
| `phone`                    | ja      | `phone`, `telnr`                      |
| `email`                    | nein    | `email`, `mail`                       |
| `name`                     | nein    | `name`                                |
| `source`                   | nein    | `source`, `quelle` (Default `website`) |

`einverstaendnis == "ja"` triggert den WhatsApp-Template-Send.
**Alle anderen Felder** (`alter`, `gesundheitsdaten_einwilligung`,
Anamnese-Felder wie `laufende_behandlungen`, `fehlende_zaehne`, `ersatz_typ`,
… sowie Tracking wie `utm_*`, `page_url`, `referrer`, `user_agent`,
`form_started_at`, `form_completed_at`, `duration_seconds`) landen 1:1 in
`leads.meta` (JSONB). Frontend kann jederzeit neue Felder einführen, ohne
dass das Backend angefasst werden muss.

`phone` wird zu E.164-ohne-Plus normalisiert (Meta-Format), Conflict-Key
beim Upsert ist `phone` — Mehrfach-Submits desselben Leads merge'n.
**`meta` wird beim Re-Submit überschrieben, nicht deep-merged** (letzte
Submission = aktuelle Wahrheit).

### WhatsApp-Webhook (Meta)
`https://fqjptwpdihwqdfxorvqq.supabase.co/functions/v1/zahnfunnel-whatsapp-webhook`
(GET = Verify, POST = Inbound). Lead-Liste für das interne Dashboard
läuft NICHT über einen REST-Endpoint — das Frontend liest direkt via
Supabase-Client.

### E2E-Smoke-Test (nach Meta+Gmail-Setup)

Reihenfolge — bei jedem Schritt anhalten und Ergebnis prüfen, bevor weiter:

1. **Function-Liveness** — die fünf Zahnfunnel-Edge-Functions müssen deployed
   sein. Pro URL einmal `curl` (404 = nicht deployed → in Lovable redeployen):
   ```
   curl -i https://fqjptwpdihwqdfxorvqq.supabase.co/functions/v1/zahnfunnel-form-webhook
   curl -i https://fqjptwpdihwqdfxorvqq.supabase.co/functions/v1/zahnfunnel-whatsapp-webhook
   curl -i https://fqjptwpdihwqdfxorvqq.supabase.co/functions/v1/zahnfunnel-whatsapp-send
   curl -i https://fqjptwpdihwqdfxorvqq.supabase.co/functions/v1/zahnfunnel-suggest-reply
   curl -i https://fqjptwpdihwqdfxorvqq.supabase.co/functions/v1/zahnfunnel-health-check
   ```
   Erwartet: 405 (method_not_allowed) oder 401 (jwt). 404 = Deploy fehlt.

2. **Status-Page** — `/status` im internen Dashboard. Alle 3 Cards müssen
   grün sein (Meta, Anthropic/OpenAI, Gmail). Rot/grau heißt: Token oder
   `app_config`-Eintrag fehlt — dann erst weiter.

3. **Funnel-Submit (echter Browser-Submit, kein curl)** — auf
   https://zahn-versteher-portal.lovable.app das Formular einmal komplett
   durchklicken (Telefonnummer = deine eigene Test-Nummer, Einverständnis = ja).
   Erwartet: Innerhalb ~5s erscheint der Lead in `/funnel`. `meta` enthält
   die Anamnese-Felder. `source = website`.

4. **Auto-Template-Send** — prüfen, ob das WA-Template rausgegangen ist:
   - `wa_messages`-Eintrag mit `direction='outbound'` und `template_name`
     gesetzt für den frischen Lead
   - WhatsApp auf dem Test-Handy zeigt die Template-Nachricht
   Wenn nichts kommt: Lovable-Logs der `zahnfunnel-form-webhook` checken
   (`whatsapp template send failed`-Zeile).

5. **Inbound-Reply** — auf dem Test-Handy auf das Template antworten.
   Erwartet: Nachricht erscheint in `/inbox` beim Lead. `lead.status` wechselt
   auf `contacted`, `message_count` zählt hoch.
   Wenn nichts kommt: Meta-Webhook-URL falsch eingetragen oder
   `WA_VERIFY_TOKEN` weicht ab.

6. **Outbound-Send aus Inbox** — KI-Vorschlag generieren, anpassen, senden.
   Erwartet: `wa_messages`-Eintrag mit `direction='outbound'`, Lead bekommt
   die Nachricht auf WhatsApp.

7. **Direct-WhatsApp-Lead** (zweiter Test) — von einer anderen, im System
   noch nicht bekannten Nummer direkt auf die Business-WhatsApp schreiben
   (kein Funnel davor). Erwartet: neuer Lead mit `source='whatsapp'`,
   `meta` leer. In `/funnel/<id>` zeigt LeadDetail Inbound-Thread + die
   FirstContactCard mit englisch-locker generiertem Vorschlag.

## Regeln

- **Original lesen, nicht raten**, bevor du Code änderst.
- **Root Cause statt Fallback-Stapel.** Wenn etwas nicht geht, erst die
  Ursache finden, dann fixen.
- **Kein n8n** in neuen Code-Pfaden, Funktionsnamen oder Doku. Der Name
  `n8n-webhook` bleibt stehen, weil es eine bereits deployed Edge Function
  ist — aber neuer Code referenziert n8n nicht.
- Vor `docker compose build`: `git status` checken.
