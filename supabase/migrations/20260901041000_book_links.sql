-- 책 사이 이음 — 같은 작가 계보, 인용 관계, 이어 읽기.
-- 이음은 방향이 없다: A↔B 를 한 줄로 적고, 뒤집힌 중복(B→A)은
-- least/greatest 유일 색인이 막는다.
create table public.book_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  linked_book_id uuid not null references public.books(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint book_links_distinct check (book_id <> linked_book_id)
);

create unique index book_links_pair_idx
  on public.book_links (least(book_id, linked_book_id), greatest(book_id, linked_book_id));
create index book_links_owner_idx on public.book_links (owner_id);
-- 양쪽 어느 책에서 열어도 찾을 수 있어야 한다
create index book_links_book_idx on public.book_links (book_id);
create index book_links_linked_idx on public.book_links (linked_book_id);

alter table public.book_links enable row level security;

-- (select auth.uid()) 형태는 행마다 재평가되지 않아 큰 표에서 빠르다
create policy "이음은 주인만 본다" on public.book_links
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "이음은 주인만 잇는다" on public.book_links
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "이음은 주인만 푼다" on public.book_links
  for delete to authenticated using ((select auth.uid()) = owner_id);
