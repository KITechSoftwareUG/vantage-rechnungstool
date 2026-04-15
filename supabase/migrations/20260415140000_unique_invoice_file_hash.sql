-- Partial unique index on invoices(user_id, file_hash).
-- Purpose: Verhindert Duplikat-Ingest derselben PDF pro User (gleicher file_hash).
-- Warum PARTIAL (WHERE file_hash IS NOT NULL):
--   Historische Zeilen aus der Zeit vor 20260414120000_add_invoice_file_hash.sql
--   haben file_hash = NULL. Ein normaler UNIQUE-Index würde zwar NULLs erlauben
--   (NULLs gelten in Postgres als distinct), aber wir machen explizit, dass
--   die Constraint nur für tatsächlich gehashte Rows greift und NULLs komplett
--   ignoriert werden. Dadurch bleibt Backfill optional und störungsfrei.
CREATE UNIQUE INDEX IF NOT EXISTS invoices_user_id_file_hash_unique
  ON public.invoices (user_id, file_hash)
  WHERE file_hash IS NOT NULL;
