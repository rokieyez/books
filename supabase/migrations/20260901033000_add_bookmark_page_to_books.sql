-- 갈피 — 읽는 중인 책이 몇 쪽까지 왔는지. 서표에서 적는다.
alter table public.books add column if not exists bookmark_page smallint;
