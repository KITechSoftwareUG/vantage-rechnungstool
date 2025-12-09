-- Add original_currency column to bank_transactions for tracking currency conversions
ALTER TABLE public.bank_transactions 
ADD COLUMN original_currency text DEFAULT NULL;

COMMENT ON COLUMN public.bank_transactions.original_currency IS 'Original currency if transaction was converted (e.g., USD, GBP). NULL means EUR/no conversion.';
