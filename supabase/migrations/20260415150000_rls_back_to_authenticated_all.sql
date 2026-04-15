-- Revert des RLS-Reverts.
--
-- Kontext: Das Tool ist ein Single-User-Tool (nur Alex). Die Migration
-- 20260216095758_... hatte die user-scoped Policies bewusst auf
-- "auth.role() = 'authenticated'" umgestellt, damit Alex von mehreren
-- Accounts/Devices auf seine eigenen Daten zugreifen kann.
--
-- Meine vorherige Migration 20260415130000_revert_rls_to_user_scoped.sql
-- hat das als Multi-Tenant-Leak fehlinterpretiert und zurueck auf
-- user-scoped gebaut — das war falsch. Hiermit wird der Zustand von
-- 20260216095758 wiederhergestellt.

-- INVOICES
DROP POLICY IF EXISTS "Users can view their own invoices" ON public.invoices;
DROP POLICY IF EXISTS "Users can create their own invoices" ON public.invoices;
DROP POLICY IF EXISTS "Users can update their own invoices" ON public.invoices;
DROP POLICY IF EXISTS "Users can delete their own invoices" ON public.invoices;

CREATE POLICY "Authenticated users can view all invoices" ON public.invoices FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can create invoices" ON public.invoices FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can update invoices" ON public.invoices FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can delete invoices" ON public.invoices FOR DELETE USING (auth.role() = 'authenticated');

-- BANK_STATEMENTS
DROP POLICY IF EXISTS "Users can view their own bank statements" ON public.bank_statements;
DROP POLICY IF EXISTS "Users can create their own bank statements" ON public.bank_statements;
DROP POLICY IF EXISTS "Users can update their own bank statements" ON public.bank_statements;
DROP POLICY IF EXISTS "Users can delete their own bank statements" ON public.bank_statements;

CREATE POLICY "Authenticated users can view all bank statements" ON public.bank_statements FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can create bank statements" ON public.bank_statements FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can update bank statements" ON public.bank_statements FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can delete bank statements" ON public.bank_statements FOR DELETE USING (auth.role() = 'authenticated');

-- BANK_TRANSACTIONS
DROP POLICY IF EXISTS "Users can view their own transactions" ON public.bank_transactions;
DROP POLICY IF EXISTS "Users can create their own transactions" ON public.bank_transactions;
DROP POLICY IF EXISTS "Users can update their own transactions" ON public.bank_transactions;
DROP POLICY IF EXISTS "Users can delete their own transactions" ON public.bank_transactions;

CREATE POLICY "Authenticated users can view all transactions" ON public.bank_transactions FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can create transactions" ON public.bank_transactions FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can update transactions" ON public.bank_transactions FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can delete transactions" ON public.bank_transactions FOR DELETE USING (auth.role() = 'authenticated');

-- DOCUMENT_INGESTION_LOG
DROP POLICY IF EXISTS "Users can view their own ingestion logs" ON public.document_ingestion_log;
DROP POLICY IF EXISTS "Users can insert their own ingestion logs" ON public.document_ingestion_log;
DROP POLICY IF EXISTS "Users can delete their own ingestion logs" ON public.document_ingestion_log;

CREATE POLICY "Authenticated users can view all ingestion logs" ON public.document_ingestion_log FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can create ingestion logs" ON public.document_ingestion_log FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can delete ingestion logs" ON public.document_ingestion_log FOR DELETE USING (auth.role() = 'authenticated');
-- "Service role can manage all logs" bleibt unangetastet

-- RECURRING_PATTERNS
DROP POLICY IF EXISTS "Users can view their own patterns" ON public.recurring_patterns;
DROP POLICY IF EXISTS "Users can create their own patterns" ON public.recurring_patterns;
DROP POLICY IF EXISTS "Users can delete their own patterns" ON public.recurring_patterns;

CREATE POLICY "Authenticated users can view all patterns" ON public.recurring_patterns FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can create patterns" ON public.recurring_patterns FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can delete patterns" ON public.recurring_patterns FOR DELETE USING (auth.role() = 'authenticated');

-- PROCESSED_DRIVE_FILES
DROP POLICY IF EXISTS "Users can view their own processed files" ON public.processed_drive_files;
DROP POLICY IF EXISTS "Users can insert their own processed files" ON public.processed_drive_files;
DROP POLICY IF EXISTS "Users can delete their own processed files" ON public.processed_drive_files;

CREATE POLICY "Authenticated users can view all processed files" ON public.processed_drive_files FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can create processed files" ON public.processed_drive_files FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can delete processed files" ON public.processed_drive_files FOR DELETE USING (auth.role() = 'authenticated');

-- GOOGLE_DRIVE_TOKENS
DROP POLICY IF EXISTS "Users can view their own tokens" ON public.google_drive_tokens;
DROP POLICY IF EXISTS "Users can insert their own tokens" ON public.google_drive_tokens;
DROP POLICY IF EXISTS "Users can update their own tokens" ON public.google_drive_tokens;
DROP POLICY IF EXISTS "Users can delete their own tokens" ON public.google_drive_tokens;

CREATE POLICY "Authenticated users can view all tokens" ON public.google_drive_tokens FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can create tokens" ON public.google_drive_tokens FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can update tokens" ON public.google_drive_tokens FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can delete tokens" ON public.google_drive_tokens FOR DELETE USING (auth.role() = 'authenticated');
