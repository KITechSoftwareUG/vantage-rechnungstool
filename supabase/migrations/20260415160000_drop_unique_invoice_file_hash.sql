-- Drop des UNIQUE-Index auf invoices(user_id, file_hash).
--
-- Grund: Duplikat-Erkennung soll ausschliesslich im Matching-Tool passieren,
-- nicht am Ingest. Der Index blockierte doppelte Uploads auf DB-Ebene mit
-- 23505, sodass Duplikate gar nicht in die Review-Queue kamen. Ohne den Index
-- landen alle Uploads in der DB und koennen dort/im Matching sichtbar
-- zusammengefuehrt werden.
DROP INDEX IF EXISTS public.invoices_user_id_file_hash_unique;
