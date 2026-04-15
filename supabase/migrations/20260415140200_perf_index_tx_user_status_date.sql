-- Composite index on bank_transactions(user_id, match_status, date DESC).
-- Ergänzt den bereits existierenden (user_id, match_status)-Index aus
-- 20260414140000_perf_indexes.sql. Dieser hier deckt zusätzlich Queries ab,
-- die nach Datum filtern oder sortieren (z.B. Review-Queue: neueste offene
-- Transaktionen eines Users zuerst). Postgres kann den Index dann für
-- ORDER BY date DESC ohne extra Sort nutzen.
CREATE INDEX IF NOT EXISTS bank_transactions_user_status_date_idx
  ON public.bank_transactions (user_id, match_status, date DESC);
