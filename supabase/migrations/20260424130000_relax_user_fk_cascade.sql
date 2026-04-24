-- FK-Haertung: ON DELETE CASCADE -> ON DELETE SET NULL auf den user_id-FKs
-- von invoices, bank_statements und google_drive_tokens.
--
-- Hintergrund (2026-04-24): Beim Neuanlegen der Auth-User (Passwort-Reset-
-- Roundtrip) wurden aufgrund des CASCADE-FK alle Rechnungen, Kontoauszuege
-- und Drive-Tokens automatisch mitgeloescht. In einem Single-User-Tool
-- (nur Alex) ist das ein Totalverlust. Nach dem Re-Ingest aus Google Drive
-- haerten wir die FKs, damit das nie wieder passieren kann: kuenftige
-- User-Deletes setzen user_id einfach auf NULL, Daten bleiben erhalten.
--
-- user_id wird deshalb auch NULLABLE gemacht. Das ist kein Semantik-Bruch,
-- weil die RLS-Policies "authenticated sees all" ohnehin nicht auf user_id
-- joinen. Der workflow-app-Poller befuellt user_id beim Ingest; spaeter kann
-- er bei geloeschten Besitzern nicht mehr befuellen, aber die Daten bleiben
-- sichtbar.
--
-- document_ingestion_log bleibt unangetastet (Logs duerfen ruhig verwaisen).

-- INVOICES --
ALTER TABLE public.invoices
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_user_id_fkey;

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


-- BANK_STATEMENTS --
ALTER TABLE public.bank_statements
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.bank_statements
  DROP CONSTRAINT IF EXISTS bank_statements_user_id_fkey;

ALTER TABLE public.bank_statements
  ADD CONSTRAINT bank_statements_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


-- GOOGLE_DRIVE_TOKENS --
-- Hier ist NULL allerdings problematisch, weil der Poller das Token
-- pro user braucht. Wir lassen user_id NOT NULL, aber aendern nur den
-- FK-Loesch-Modus: falls der User geloescht wird, loeschen wir die
-- Token-Row mit (CASCADE bleibt hier semantisch richtig — Token ohne
-- User hat keinen Wert). Also diese Tabelle NICHT anfassen.
--
-- Keine Aenderung an google_drive_tokens — der Poller setzt sich neu,
-- wenn noetig.

-- processed_drive_files, recurring_patterns: falls user_id-FK existiert,
-- auch relaxen. Aber nur wenn vorhanden; Verifikation:
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'processed_drive_files_user_id_fkey'
  ) THEN
    ALTER TABLE public.processed_drive_files
      DROP CONSTRAINT processed_drive_files_user_id_fkey;
    ALTER TABLE public.processed_drive_files
      ADD CONSTRAINT processed_drive_files_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
    ALTER TABLE public.processed_drive_files
      ALTER COLUMN user_id DROP NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'recurring_patterns_user_id_fkey'
  ) THEN
    ALTER TABLE public.recurring_patterns
      DROP CONSTRAINT recurring_patterns_user_id_fkey;
    ALTER TABLE public.recurring_patterns
      ADD CONSTRAINT recurring_patterns_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
    ALTER TABLE public.recurring_patterns
      ALTER COLUMN user_id DROP NOT NULL;
  END IF;
END $$;
