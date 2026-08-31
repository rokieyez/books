-- 잠그고 시작한다. 나중에 공개할 만큼만 연다.
-- 주의: '로그인했으면 통과'는 잠근 게 아니다 — 반드시 주인(owner_id)까지 확인한다.

alter table public.books enable row level security;
alter table public.book_summaries enable row level security;
alter table public.archive_items enable row level security;
alter table public.archive_book_links enable row level security;
alter table public.intake_photos enable row level security;
alter table public.intake_candidates enable row level security;

-- (select auth.uid()) 형태는 행마다 재평가되지 않아 큰 표에서 빠르다
create policy "장서는 주인만 본다" on public.books
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "장서는 주인만 꽂는다" on public.books
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "장서는 주인만 고친다" on public.books
  for update to authenticated using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy "장서는 주인만 뺀다" on public.books
  for delete to authenticated using ((select auth.uid()) = owner_id);

create policy "요약은 주인만 본다" on public.book_summaries
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "요약은 주인만 남긴다" on public.book_summaries
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "요약은 주인만 고친다" on public.book_summaries
  for update to authenticated using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy "요약은 주인만 지운다" on public.book_summaries
  for delete to authenticated using ((select auth.uid()) = owner_id);

create policy "기록은 주인만 본다" on public.archive_items
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "기록은 주인만 넣는다" on public.archive_items
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "기록은 주인만 고친다" on public.archive_items
  for update to authenticated using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy "기록은 주인만 지운다" on public.archive_items
  for delete to authenticated using ((select auth.uid()) = owner_id);

create policy "연결은 주인만 본다" on public.archive_book_links
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "연결은 주인만 잇는다" on public.archive_book_links
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "연결은 주인만 끊는다" on public.archive_book_links
  for delete to authenticated using ((select auth.uid()) = owner_id);

create policy "사진은 주인만 본다" on public.intake_photos
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "사진은 주인만 올린다" on public.intake_photos
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "사진은 주인만 고친다" on public.intake_photos
  for update to authenticated using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy "사진은 주인만 지운다" on public.intake_photos
  for delete to authenticated using ((select auth.uid()) = owner_id);

create policy "궤짝은 주인만 연다" on public.intake_candidates
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "궤짝은 주인만 채운다" on public.intake_candidates
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "궤짝은 주인만 확정한다" on public.intake_candidates
  for update to authenticated using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy "궤짝은 주인만 비운다" on public.intake_candidates
  for delete to authenticated using ((select auth.uid()) = owner_id);

-- ── 파일도 같이 잠근다 ─────────────────────────────────
-- 표만 잠그고 스토리지를 열어두면 줄은 못 지워도 사진은 지울 수 있다.
insert into storage.buckets (id, name, public) values
  ('covers', 'covers', false),
  ('intake', 'intake', false),
  ('archive', 'archive', false)
on conflict (id) do nothing;

-- 경로 규칙: <uid>/<파일명> — 첫 폴더가 주인의 uid여야 통과
create policy "파일은 주인만 본다" on storage.objects
  for select to authenticated using (
    bucket_id in ('covers', 'intake', 'archive')
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );
create policy "파일은 주인만 올린다" on storage.objects
  for insert to authenticated with check (
    bucket_id in ('covers', 'intake', 'archive')
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );
create policy "파일은 주인만 바꾼다" on storage.objects
  for update to authenticated using (
    bucket_id in ('covers', 'intake', 'archive')
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );
create policy "파일은 주인만 지운다" on storage.objects
  for delete to authenticated using (
    bucket_id in ('covers', 'intake', 'archive')
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );
