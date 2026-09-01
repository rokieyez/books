-- 종교의 벽 — 다섯째 벽 (주인의 요청, 2026-09-01).
-- 분류 「종교」가 새로 생기고, 그 분류는 제 벽으로 간다.
-- 같은 규칙이 recognize-spines 의 wallFor, intake.js 의 WALL_OF 에도 있다.
create or replace function public.wall_for_category(cat text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case cat
    when '역사' then '역사'
    when '과학' then '과학'
    when '예술' then '예술사회'
    when '사회' then '예술사회'
    when '종교' then '종교'
    else '문학'
  end
$$;
