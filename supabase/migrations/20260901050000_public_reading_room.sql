-- 공개 서재로 전환 (주인의 지시, 2026-09-01) —
-- 이 사이트는 비밀 서재가 아니라 보통의 개인 홈페이지다.
-- 읽기는 누구에게나, 쓰기(꽂기·고치기·빼기)는 여전히 주인에게만.
-- 들이기 작업대(intake_photos·intake_candidates)와 백업(backup_snapshots)은
-- 작업 공간이므로 계속 주인만 본다.

drop policy "장서는 주인만 본다" on public.books;
create policy "장서는 누구나 본다" on public.books
  for select to anon, authenticated using (true);

drop policy "요약은 주인만 본다" on public.book_summaries;
create policy "요약은 누구나 본다" on public.book_summaries
  for select to anon, authenticated using (true);

drop policy "기록은 주인만 본다" on public.archive_items;
create policy "기록은 누구나 본다" on public.archive_items
  for select to anon, authenticated using (true);

drop policy "이음은 주인만 본다" on public.book_links;
create policy "이음은 누구나 본다" on public.book_links
  for select to anon, authenticated using (true);

-- 실물 책등 조각(covers 버킷)도 공개 — 서가를 그리는 재료다.
-- 공개 버킷은 서명 없이 public URL 로 읽힌다 (쓰기는 여전히 정책이 막는다).
update storage.buckets set public = true where id = 'covers';
