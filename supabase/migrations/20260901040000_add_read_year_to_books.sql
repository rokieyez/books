-- 읽은 해 — 「그 해에 읽은 책」 통계와 연말 회고의 재료.
-- 읽음으로 바꾸는 순간의 해를 자동으로 적고, 서표에서 손으로 고칠 수 있다.
-- 과거에 읽은 책을 나중에 등재할 수도 있으니 제약은 느슨하게 둔다.
alter table public.books add column read_year smallint
  check (read_year is null or read_year between 1900 and 2200);
