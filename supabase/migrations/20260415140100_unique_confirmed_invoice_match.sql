-- Partial unique index on bank_transactions(matched_invoice_id).
-- Purpose: Race-Schutz. Eine Rechnung darf nur von GENAU EINER Transaktion
-- als 'confirmed' geclaimt werden. Zwei parallele Confirm-Aufrufe auf dieselbe
-- Invoice werden dadurch auf DB-Ebene serialisiert — der zweite läuft in einen
-- unique_violation und muss sauber behandelt werden.
-- Warum PARTIAL:
--   - match_status != 'confirmed' (z.B. 'suggested', 'rejected') darf dieselbe
--     Invoice mehrfach referenzieren (mehrere Kandidaten sind ok).
--   - matched_invoice_id IS NULL kommt massenhaft vor und soll nicht blockieren.
--   Der Index greift also nur dort, wo es zählt: confirmed + non-null invoice.
CREATE UNIQUE INDEX IF NOT EXISTS bank_transactions_confirmed_invoice_unique
  ON public.bank_transactions (matched_invoice_id)
  WHERE match_status = 'confirmed' AND matched_invoice_id IS NOT NULL;
