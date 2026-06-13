-- The previous migration (20260505000000_unaccent) was marked as applied
-- but never actually created the extension: Supabase's pooler role cannot
-- create extensions in the "public" schema, only in "extensions" (which is
-- part of search_path). Without it, unaccent() does not exist and any query
-- using it (e.g. business city search) fails with Postgres error 42883.
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;
