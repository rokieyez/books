-- 이음의 까닭 — 「같은 번역가」 「인용됨」처럼 왜 이었는지 한 줄.
-- 지금까지 고침 정책이 없었다 (잇고 풀기만 했으니) — 까닭을 적으려면 필요하다.
alter table public.book_links add column note text;

create policy "이음은 주인만 고친다" on public.book_links
  for update to authenticated using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
