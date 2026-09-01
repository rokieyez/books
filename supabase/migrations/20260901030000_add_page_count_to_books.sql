-- 쪽수 — 책등 두께를 실제 책 두께대로 그리기 위한 재료.
-- 알라딘 ItemLookUp(subInfo.itemPage)에서 채워진다. 없으면 null 로 두고
-- 화면은 제목 해시로 만든 예전 두께로 물러난다.
alter table public.books add column if not exists page_count smallint;
