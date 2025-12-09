-- Create invoices table
CREATE TABLE public.invoices (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  file_name TEXT NOT NULL,
  file_url TEXT,
  date DATE NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  issuer TEXT NOT NULL,
  amount DECIMAL(12, 2) NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('incoming', 'outgoing')),
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('processing', 'ready', 'saved')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create bank_statements table
CREATE TABLE public.bank_statements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  file_name TEXT NOT NULL,
  file_url TEXT,
  bank TEXT NOT NULL,
  account_number TEXT NOT NULL,
  date DATE NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  opening_balance DECIMAL(12, 2) NOT NULL,
  closing_balance DECIMAL(12, 2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('processing', 'ready', 'saved')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_statements ENABLE ROW LEVEL SECURITY;

-- RLS Policies for invoices
CREATE POLICY "Users can view their own invoices"
ON public.invoices FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own invoices"
ON public.invoices FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own invoices"
ON public.invoices FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own invoices"
ON public.invoices FOR DELETE
USING (auth.uid() = user_id);

-- RLS Policies for bank_statements
CREATE POLICY "Users can view their own bank statements"
ON public.bank_statements FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own bank statements"
ON public.bank_statements FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own bank statements"
ON public.bank_statements FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own bank statements"
ON public.bank_statements FOR DELETE
USING (auth.uid() = user_id);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create triggers for automatic timestamp updates
CREATE TRIGGER update_invoices_updated_at
BEFORE UPDATE ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_bank_statements_updated_at
BEFORE UPDATE ON public.bank_statements
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create storage bucket for documents
INSERT INTO storage.buckets (id, name, public) VALUES ('documents', 'documents', false);

-- Storage policies for documents bucket
CREATE POLICY "Users can view their own documents"
ON storage.objects FOR SELECT
USING (bucket_id = 'documents' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can upload their own documents"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'documents' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can update their own documents"
ON storage.objects FOR UPDATE
USING (bucket_id = 'documents' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete their own documents"
ON storage.objects FOR DELETE
USING (bucket_id = 'documents' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Create indexes for faster queries by year/month
CREATE INDEX idx_invoices_year_month ON public.invoices(year, month);
CREATE INDEX idx_invoices_user_id ON public.invoices(user_id);
CREATE INDEX idx_bank_statements_year_month ON public.bank_statements(year, month);
CREATE INDEX idx_bank_statements_user_id ON public.bank_statements(user_id);