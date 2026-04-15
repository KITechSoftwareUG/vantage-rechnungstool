-- Vorschlaege als Konzept entfernt: alle bestehenden Zeilen mit
-- match_status = 'matched' (das waren die KI-Vorschlaege) werden
-- auf 'unmatched' zurueckgesetzt. Alle Match-Felder werden geleert,
-- damit der User sie ueber die normale Manuell-Mit-Relevanz-UI neu
-- behandeln kann.
--
-- Idempotent: erneutes Ausfuehren ist No-op.

UPDATE public.bank_transactions
SET
  match_status = 'unmatched',
  matched_invoice_id = NULL,
  match_confidence = NULL,
  match_reason = NULL
WHERE match_status = 'matched';
