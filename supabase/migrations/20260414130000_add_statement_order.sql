-- Reihenfolge der Transaktion innerhalb des Kontoauszugs (0-basiert),
-- damit die Liste im UI exakt in der PDF-Reihenfolge angezeigt werden kann.
-- Sortieren nach `date` allein reicht nicht, weil mehrere Buchungen am selben
-- Tag im Auszug eine definierte Abfolge haben (Wertstellung / Buchungslauf).
ALTER TABLE public.bank_transactions
ADD COLUMN IF NOT EXISTS statement_order INTEGER;

COMMENT ON COLUMN public.bank_transactions.statement_order IS
  'Position der Transaktion im Kontoauszug-PDF (0-basiert). NULL bei Altdaten und bei synthetischen Kasse-Transaktionen.';

CREATE INDEX IF NOT EXISTS idx_bank_transactions_statement_order
  ON public.bank_transactions (bank_statement_id, statement_order);
