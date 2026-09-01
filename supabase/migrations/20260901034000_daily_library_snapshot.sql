-- 자동 백업 — 매일 새벽, 장서 전체를 jsonb 로 떠서 스냅샷 표에 쌓는다.
-- 잘못 지우거나 잘못 고친 날로부터 30일 안이면 여기서 되찾을 수 있다.
-- (Supabase 밖으로의 사본은 화면의 CSV 내려받기가 맡는다)

create extension if not exists pg_cron;

create table if not exists public.backup_snapshots (
  id bigint generated always as identity primary key,
  owner_id uuid not null,
  taken_on date not null default current_date,
  books_count int not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (owner_id, taken_on)
);

alter table public.backup_snapshots enable row level security;

drop policy if exists "owner reads own snapshots" on public.backup_snapshots;
create policy "owner reads own snapshots"
  on public.backup_snapshots for select
  using (auth.uid() = owner_id);

-- 스냅샷 뜨기 — cron 이 부른다 (postgres 권한이라 RLS 를 지나간다)
create or replace function public.take_library_snapshot()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.backup_snapshots (owner_id, taken_on, books_count, payload)
  select owner_id, current_date, count(*), jsonb_agg(to_jsonb(b))
  from public.books b
  group by owner_id
  on conflict (owner_id, taken_on)
  do update set payload = excluded.payload,
                books_count = excluded.books_count,
                created_at = now();

  -- 30일 넘은 스냅샷은 버린다
  delete from public.backup_snapshots where taken_on < current_date - 30;
end;
$$;

-- 일반 사용자가 이 함수를 함부로 부르지 못하게 한다
revoke execute on function public.take_library_snapshot() from public, anon, authenticated;

-- 매일 04:17 KST (19:17 UTC)
select cron.schedule(
  'daily-library-snapshot',
  '17 19 * * *',
  $$select public.take_library_snapshot()$$
);

-- 첫 스냅샷은 지금 바로 하나 떠 둔다
select public.take_library_snapshot();
