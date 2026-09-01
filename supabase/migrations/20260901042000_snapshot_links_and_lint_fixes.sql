-- 4회전 훑기에서 나온 세 가지.
-- ① 책 사이 이음(book_links)이 백업에 빠져 있었다 — 스냅샷에 넣는다.
--    books 는 to_jsonb 통짜라 read_year 같은 새 열은 저절로 따라온다.
create or replace function public.take_library_snapshot()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.backup_snapshots (owner_id, taken_on, books_count, payload)
  select b.owner_id, current_date, count(*),
         jsonb_build_object(
           'books', jsonb_agg(to_jsonb(b)),
           'archive', coalesce((select jsonb_agg(to_jsonb(a)) from public.archive_items a where a.owner_id = b.owner_id), '[]'::jsonb),
           'summaries', coalesce((select jsonb_agg(to_jsonb(s)) from public.book_summaries s where s.owner_id = b.owner_id), '[]'::jsonb),
           'links', coalesce((select jsonb_agg(to_jsonb(l)) from public.book_links l where l.owner_id = b.owner_id), '[]'::jsonb)
         )
  from public.books b
  group by b.owner_id
  on conflict (owner_id, taken_on)
  do update set payload = excluded.payload,
                books_count = excluded.books_count,
                created_at = now();

  delete from public.backup_snapshots where taken_on < current_date - 30;
end;
$$;

revoke execute on function public.take_library_snapshot() from public, anon, authenticated;

-- ② 스냅샷 조회 정책이 auth.uid() 를 행마다 다시 셈하고 있었다 (린터 WARN).
--    다른 표들처럼 (select auth.uid()) 로 한 번만 셈하게 한다.
drop policy "owner reads own snapshots" on public.backup_snapshots;
create policy "owner reads own snapshots" on public.backup_snapshots
  for select to authenticated using ((select auth.uid()) = owner_id);

-- ③ books.spine_photo_id 외래열쇠에 색인이 없었다 (린터 지적) —
--    사진을 지울 때마다 books 전체를 훑게 된다.
create index books_spine_photo_idx on public.books (spine_photo_id);

-- 넓어진 모양으로 오늘 스냅샷을 다시 뜬다
select public.take_library_snapshot();
