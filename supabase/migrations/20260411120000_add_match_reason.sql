-- Speichert die Begründung der KI bzw. Heuristik für ein Auto-Match.
-- Wird im Matching-UI angezeigt, damit der User die Match-Entscheidung
-- nachvollziehen und ggf. korrigieren kann.
ALTER TABLE public.bank_transactions
ADD COLUMN IF NOT EXISTS match_reason TEXT;

COMMENT ON COLUMN public.bank_transactions.match_reason IS
  'Begründung des Auto-Matchings (z.B. KI-Antwort oder Heuristik-Beschreibung). NULL bei manuell zugeordneten oder ungematchten Transaktionen.';
