-- 스냅샷이 장서만 뜨고 있었다 — 기록의 벽과 책 요약도 같이 뜬다.
-- payload 모양이 {books:[…]} 에서 {books, archive, summaries} 로 넓어진다.
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
           'summaries', coalesce((select jsonb_agg(to_jsonb(s)) from public.book_summaries s where s.owner_id = b.owner_id), '[]'::jsonb)
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

-- 넓어진 모양으로 오늘 스냅샷을 다시 뜬다
select public.take_library_snapshot();
