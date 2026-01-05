-- Add payment_method column to invoices table
-- 'bank' = normal payment via bank/credit card (needs matching)
-- 'cash' = cash or private card payment (no bank transaction)
ALTER TABLE public.invoices 
ADD COLUMN payment_method text NOT NULL DEFAULT 'bank';

-- Add a comment to explain the column
COMMENT ON COLUMN public.invoices.payment_method IS 'Payment method: bank (default, needs matching) or cash (no bank transaction needed)';