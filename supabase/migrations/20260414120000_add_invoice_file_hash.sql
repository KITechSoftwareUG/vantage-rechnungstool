-- Content-based duplicate detection for invoices.
-- file_hash is the SHA-256 of the uploaded file bytes, computed in n8n-webhook
-- BEFORE OCR runs, so bit-identical re-uploads are rejected without burning AI
-- calls. Nullable to allow legacy rows; not UNIQUE so a soft-dedup failure
-- cannot block ingestion entirely.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS file_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_invoices_user_file_hash
  ON public.invoices (user_id, file_hash)
  WHERE file_hash IS NOT NULL;
