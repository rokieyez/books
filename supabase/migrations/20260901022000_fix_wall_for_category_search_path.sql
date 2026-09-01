-- search_path 이 열려 있으면, 누군가 같은 이름의 함수를 앞 스키마에 심어
-- 이 함수가 그것을 부르게 만들 수 있다. 빈 경로로 못박는다.
-- (보안 린터의 function_search_path_mutable 경고)
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
    else '문학'
  end
$$;
