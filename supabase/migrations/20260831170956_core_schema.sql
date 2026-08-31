-- 서가 뒤의 방 — 기본 스키마
create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- 갱신 시각 자동 기록
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── 장서 ───────────────────────────────────────────────
create table public.books (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  author text,
  category text,
  isbn text,
  publisher text,
  published_year smallint,
  cover_url text,
  -- 책등 색: 표지에서 추출해 서가 렌더에 쓴다
  spine_color text,
  -- 물리적 위치: 사진 한 장이 곧 위치 기록이 된다
  wall text,
  shelf smallint,
  slot smallint,
  read_status text not null default '안 읽음'
    check (read_status in ('읽음', '읽는 중', '안 읽음')),
  acquired_on date not null default current_date,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index books_owner_idx on public.books (owner_id);
create index books_wall_idx on public.books (owner_id, wall, shelf, slot);
create index books_category_idx on public.books (owner_id, category);
-- 한국어 검색은 형태소 분석 대신 트라이그램으로 (ILIKE 부분일치가 빨라진다)
create index books_title_trgm on public.books using gin (title gin_trgm_ops);
create index books_author_trgm on public.books using gin (author gin_trgm_ops);

create trigger books_touch before update on public.books
  for each row execute function public.touch_updated_at();

-- ── AI 요약: 열어본 책에만 생긴다 (미리 만들지 않음) ────
create table public.book_summaries (
  book_id uuid primary key references public.books(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  summary text not null,
  model text,
  generated_at timestamptz not null default now()
);

create index book_summaries_owner_idx on public.book_summaries (owner_id);

-- ── 기록의 방 (아카이브) ───────────────────────────────
create table public.archive_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('문서', '사진', '링크')),
  title text not null,
  body text,
  url text,
  storage_path text,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index archive_owner_idx on public.archive_items (owner_id);
create index archive_tags_idx on public.archive_items using gin (tags);
create index archive_title_trgm on public.archive_items using gin (title gin_trgm_ops);

create trigger archive_touch before update on public.archive_items
  for each row execute function public.touch_updated_at();

-- ── 아카이브 ↔ 장서 상호 연결 ──────────────────────────
create table public.archive_book_links (
  archive_item_id uuid not null references public.archive_items(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (archive_item_id, book_id)
);

create index archive_links_book_idx on public.archive_book_links (book_id);

-- ── 등록 파이프라인: 책장 사진 ─────────────────────────
create table public.intake_photos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  storage_path text not null,
  wall text,
  shelf smallint,
  detected_count smallint,
  status text not null default '처리중'
    check (status in ('처리중', '완료', '실패')),
  note text,
  created_at timestamptz not null default now()
);

create index intake_photos_owner_idx on public.intake_photos (owner_id, created_at desc);

-- ── 검수함(궤짝): 확신이 갈리는 책만 여기 담긴다 ───────
create table public.intake_candidates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  photo_id uuid references public.intake_photos(id) on delete cascade,
  raw_text text,
  confidence numeric(4, 3),
  candidates jsonb not null default '[]'::jsonb,
  resolved_book_id uuid references public.books(id) on delete set null,
  status text not null default '대기'
    check (status in ('대기', '확정', '버림')),
  created_at timestamptz not null default now()
);

create index intake_candidates_pending_idx
  on public.intake_candidates (owner_id, status, created_at);
