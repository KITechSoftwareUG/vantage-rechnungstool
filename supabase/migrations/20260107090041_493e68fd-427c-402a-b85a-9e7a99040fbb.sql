-- Add invoice_number column to invoices table
ALTER TABLE public.invoices 
ADD COLUMN invoice_number TEXT DEFAULT NULL;