-- Fix für einen Config-Bug im workflow-app-Poller: AMEX-Watch hatte
-- category="vrbank" statt "amex", wodurch AMEX-Kontoauszüge durch den
-- Volksbank-Endpoint gelaufen und mit bank_type='volksbank' eingefügt wurden.
--
-- Folge: die AMEX-spezifische Fremdwährungs-Logik im Auto-Match
-- (auto-match-transactions/index.ts:124 — `isAmexWithCurrencyConversion`)
-- griff für diese Statements nicht.
--
-- Dieses Update korrigiert NUR Zeilen, die eindeutig als American Express
-- zu identifizieren sind:
--   1. bank_type ist aktuell 'volksbank' (Default des kaputten Endpoints)
--   2. source_endpoint = 'n8n/vrbank' (kamen tatsächlich über den falschen Pfad)
--   3. bank-Feld enthält "American Express" / "Amex" (OCR-Erkennung sagt AMEX)
--
-- Echte Volksbank-Statements haben bank='Volksbank' / 'VR Bank' / 'Raiffeisen'
-- und werden durch das ILIKE-Filter nicht angefasst.

UPDATE public.bank_statements
SET
  bank_type = 'amex',
  source_endpoint = 'n8n/amex'
WHERE bank_type = 'volksbank'
  AND source_endpoint = 'n8n/vrbank'
  AND (
    bank ILIKE '%american express%'
    OR bank ILIKE '%amex%'
  );
