-- 실물 책등 — 책장 사진에서 그 책등만 오려 서가에 붙인다.
-- spine_box 는 인식 때 받은 자리(0~1000 비율, {x,y,w,h}),
-- spine_url 은 오려 낸 조각의 storage 경로 (covers 버킷, <uid>/spines/…).
alter table public.books add column if not exists spine_photo_id uuid references public.intake_photos(id) on delete set null;
alter table public.books add column if not exists spine_box jsonb;
alter table public.books add column if not exists spine_url text;

-- 궤짝 후보도 자리를 기억한다 — 골라서 꽂을 때 함께 넘긴다
alter table public.intake_candidates add column if not exists spine_box jsonb;
