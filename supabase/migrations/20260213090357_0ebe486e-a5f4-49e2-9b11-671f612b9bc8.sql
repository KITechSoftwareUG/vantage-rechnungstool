CREATE POLICY "Users can delete their own ingestion logs"
ON public.document_ingestion_log
FOR DELETE
USING (auth.uid() = user_id);