-- Create bank_transactions table for individual transactions from bank statements
CREATE TABLE public.bank_transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  bank_statement_id UUID REFERENCES public.bank_statements(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  transaction_type TEXT NOT NULL DEFAULT 'debit', -- 'debit' or 'credit'
  matched_invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  match_confidence NUMERIC, -- 0-100 confidence score from AI matching
  match_status TEXT NOT NULL DEFAULT 'unmatched', -- 'unmatched', 'matched', 'confirmed', 'no_match'
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.bank_transactions ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users can view their own transactions" 
ON public.bank_transactions 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own transactions" 
ON public.bank_transactions 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own transactions" 
ON public.bank_transactions 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own transactions" 
ON public.bank_transactions 
FOR DELETE 
USING (auth.uid() = user_id);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_bank_transactions_updated_at
BEFORE UPDATE ON public.bank_transactions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Add bank_type column to bank_statements for filtering
ALTER TABLE public.bank_statements 
ADD COLUMN bank_type TEXT NOT NULL DEFAULT 'volksbank'; -- 'amex' or 'volksbank'