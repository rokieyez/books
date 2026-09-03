-- 글방 (rokiz.net/notes) — 로키즈의 방의 글을 담는다.
-- 서재와 같은 프로젝트를 쓴다: 계정이 하나이므로 로그인도 하나면 된다.
-- 화면은 루트 사이트 저장소(rokieyez/rokieyez.github.io)의 notes/index.html 이다.
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  slug text not null,
  title text not null,
  body text not null default '',
  -- 초고는 주인만 본다. 발행해야 방문자에게 열린다
  published boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notes_slug_shape check (slug ~ '^[0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ][0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ-]{0,79}$'),
  constraint notes_title_filled check (length(btrim(title)) > 0)
);

-- 한 사람 안에서 주소가 겹치지 않게. 주소는 곧 글의 문패다
create unique index if not exists notes_owner_slug_key on public.notes (owner_id, slug);
-- 목록은 늘 최근 것부터
create index if not exists notes_published_at_idx on public.notes (published_at desc nulls last);

-- updated_at 은 손댈 때마다 스스로 적힌다 (books 와 같은 함수)
drop trigger if exists notes_touch on public.notes;
create trigger notes_touch before update on public.notes
  for each row execute function public.touch_updated_at();

alter table public.notes enable row level security;

-- 읽기: 발행된 글은 누구나, 초고는 주인만
drop policy if exists "발행한 글은 누구나 본다" on public.notes;
create policy "발행한 글은 누구나 본다" on public.notes
  for select to anon, authenticated
  using (published or (select auth.uid()) = owner_id);

-- 쓰기: 주인만 (다른 표들과 같은 모양)
drop policy if exists "글은 주인만 남긴다" on public.notes;
create policy "글은 주인만 남긴다" on public.notes
  for insert to authenticated with check ((select auth.uid()) = owner_id);

drop policy if exists "글은 주인만 고친다" on public.notes;
create policy "글은 주인만 고친다" on public.notes
  for update to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);

drop policy if exists "글은 주인만 지운다" on public.notes;
create policy "글은 주인만 지운다" on public.notes
  for delete to authenticated using ((select auth.uid()) = owner_id);
