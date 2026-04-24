-- Bank-Statements: CHECK-Constraint um 'pending_manual_review' erweitern.
--
-- Hintergrund: Die n8n-webhook Edge Function setzt beim zweiten OCR-Pass,
-- der bei Kontoauszuegen ein 45-Sekunden-Hardtimeout hat, den Status auf
-- 'pending_manual_review', damit Alex die Liste prueft bevor das Matching
-- darauf losgeht. Die urspruengliche Schema-Migration hatte die CHECK-
-- Constraint aber nur fuer ('processing', 'ready', 'saved') angelegt —
-- bei Timeout floppte der INSERT stumm und es entstand keine Statement-
-- Zeile, obwohl der Upload scheinbar erfolgreich war.
--
-- Heute beim Re-Ingest gefunden: alle 3 Volksbank- und 3 AMEX-Dateien
-- wurden vom Poller erfolgreich an die Edge Function geschickt, aber
-- in bank_statements kam nichts an. Das war dieser Bug.

ALTER TABLE public.bank_statements
  DROP CONSTRAINT IF EXISTS bank_statements_status_check;

ALTER TABLE public.bank_statements
  ADD CONSTRAINT bank_statements_status_check
  CHECK (status IN ('processing', 'ready', 'saved', 'pending_manual_review'));
