-- 실물 크기(mm) — 책등을 진짜 판형대로 그리기 위한 재료.
-- 알라딘 ItemLookUp 에 OptResult=packing 을 붙이면 subInfo.packing 으로 온다.
-- 높이는 책등 키, 등두께는 책등 폭이 된다. 없으면 쪽수·해시로 물러난다.
alter table public.books add column if not exists size_height smallint;
alter table public.books add column if not exists size_depth smallint;
