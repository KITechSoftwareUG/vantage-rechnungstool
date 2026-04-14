-- Performance indexes for common filter paths in the UI.
-- - bank_transactions: list-view filters by (user_id, match_status) and by date range
-- - invoices: matching candidates filtered by (user_id, date, issuer)
--
-- Safe for re-run (IF NOT EXISTS).

CREATE INDEX IF NOT EXISTS idx_bank_tx_user_match
  ON public.bank_transactions (user_id, match_status);

CREATE INDEX IF NOT EXISTS idx_bank_tx_user_date
  ON public.bank_transactions (user_id, date);

CREATE INDEX IF NOT EXISTS idx_invoices_user_date_issuer
  ON public.invoices (user_id, date, issuer);
