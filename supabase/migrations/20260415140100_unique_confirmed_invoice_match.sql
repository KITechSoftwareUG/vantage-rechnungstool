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

-- Bestehende Daten-Duplikate vor dem Index-Build auflösen:
-- Pro matched_invoice_id bleibt die jüngste confirmed-TX (nach updated_at, dann id)
-- confirmed. Alle älteren Duplikate werden auf 'suggested' zurückgesetzt — das ist
-- reversibel (Status-Flip, keine Datenverluste) und der User sieht sie weiterhin
-- als Kandidat in der Review-Queue.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY matched_invoice_id
      ORDER BY updated_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM public.bank_transactions
  WHERE match_status = 'confirmed'
    AND matched_invoice_id IS NOT NULL
)
UPDATE public.bank_transactions bt
SET match_status = 'suggested'
FROM ranked r
WHERE bt.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS bank_transactions_confirmed_invoice_unique
  ON public.bank_transactions (matched_invoice_id)
  WHERE match_status = 'confirmed' AND matched_invoice_id IS NOT NULL;
