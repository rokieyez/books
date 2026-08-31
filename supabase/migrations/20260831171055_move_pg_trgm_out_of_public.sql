-- 확장은 public 밖에 둔다 (Supabase 린터 권고)
create schema if not exists extensions;
alter extension pg_trgm set schema extensions;
