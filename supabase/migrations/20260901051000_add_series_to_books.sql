-- 시리즈 이름 — 서표에서 손으로 묶는다.
-- 제목 끝 숫자 규칙(자동 접기)이 못 잡는 전집(권마다 제목이 다른 것)을
-- 같은 이름으로 적으면 목록에서 한 줄로 접힌다.
alter table public.books add column series text;
