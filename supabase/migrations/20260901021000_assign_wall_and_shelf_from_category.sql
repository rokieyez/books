-- 분류를 보고 벽을 정하고, 벽마다 차례로 단과 자리를 매긴다.
-- 사진에 벽·단을 적어 두었으면 그것이 우선이다 (실제로 찍은 자리가 더 정확하다).
-- 여기서 정하는 것은 어디까지나 1차 배정이고, 나중에 한 권씩 고칠 수 있다.

create or replace function public.wall_for_category(cat text)
returns text language sql immutable as $$
  select case cat
    when '역사' then '역사'
    when '과학' then '과학'
    when '예술' then '예술사회'
    when '사회' then '예술사회'
    else '문학'          -- 분류를 모르면 가장 큰 벽으로
  end
$$;

-- 한 단에 서른 권씩 채운다
with 자리 as (
  select id,
         public.wall_for_category(category) as w,
         row_number() over (
           partition by owner_id, public.wall_for_category(category)
           order by created_at, title
         ) - 1 as n
  from public.books
  where wall is null
)
update public.books b
set wall = 자리.w,
    shelf = (자리.n / 30) + 1,
    slot  = (자리.n % 30) + 1
from 자리
where b.id = 자리.id;
