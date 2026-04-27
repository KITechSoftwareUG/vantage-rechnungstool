-- Storage-RLS analog zu den Tabellen-Policies (siehe
-- 20260415150000_rls_back_to_authenticated_all.sql) auf "authenticated sees all"
-- umstellen.
--
-- Kontext: Single-User-Setup, aber mehrere Auth-Accounts (Alex Owner +
-- aalkh@kitech-software.de Dev). Die Tabellen-Policies sind seit April auf
-- "authenticated sees all", die Storage-Policies fuer den documents-Bucket
-- waren aber noch user-scoped via auth.uid()::text = (storage.foldername(name))[1].
-- Folge: Dev-Account sieht in den Tabellen Alex' Matches, kann die zugehoerigen
-- PDFs aber nicht aufrufen — der Browser bekam massenhaft 400er auf
-- /storage/v1/object/sign/documents/... und resolveStorageUrl loggte
-- "kein signed URL ... alle Kandidaten gescheitert".
--
-- Idempotent: DROP IF EXISTS + CREATE.

DROP POLICY IF EXISTS "Users can view their own documents" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload their own documents" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own documents" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own documents" ON storage.objects;

CREATE POLICY "Authenticated users can view all documents"
ON storage.objects FOR SELECT
USING (bucket_id = 'documents' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can upload documents"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'documents' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update documents"
ON storage.objects FOR UPDATE
USING (bucket_id = 'documents' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can delete documents"
ON storage.objects FOR DELETE
USING (bucket_id = 'documents' AND auth.role() = 'authenticated');
