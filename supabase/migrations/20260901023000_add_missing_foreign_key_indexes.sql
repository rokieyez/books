-- 외래키에 덮는 색인이 없으면 부모 줄을 지울 때마다 자식 표를 통째로 훑는다.
-- 지금은 줄이 적어 티가 안 나지만 1,300권이 들어오면 달라진다.
-- (성능 린터의 unindexed_foreign_keys)
create index if not exists archive_book_links_owner_idx
  on public.archive_book_links (owner_id);

create index if not exists intake_candidates_photo_idx
  on public.intake_candidates (photo_id);

create index if not exists intake_candidates_resolved_idx
  on public.intake_candidates (resolved_book_id);
