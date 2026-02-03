-- Add source tracking to invoices table
ALTER TABLE public.invoices
ADD COLUMN IF NOT EXISTS source_endpoint TEXT;

-- Add source tracking to bank_statements table
ALTER TABLE public.bank_statements
ADD COLUMN IF NOT EXISTS source_endpoint TEXT;

-- Create document ingestion log for tracking
CREATE TABLE public.document_ingestion_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  endpoint_category TEXT NOT NULL,
  endpoint_year INTEGER NOT NULL,
  endpoint_month INTEGER,
  file_name TEXT NOT NULL,
  document_type TEXT NOT NULL,
  document_id UUID,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.document_ingestion_log ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view their own ingestion logs"
ON public.document_ingestion_log
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own ingestion logs"
ON public.document_ingestion_log
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role can manage all logs"
ON public.document_ingestion_log
FOR ALL
USING (true)
WITH CHECK (true);

-- Create index for faster queries
CREATE INDEX idx_ingestion_log_user_created ON public.document_ingestion_log(user_id, created_at DESC);