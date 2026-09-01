-- 같은 책이 두 번 꽂히지 않게 한다.
-- 화면이나 함수에서 막는 것으로는 부족하다 — 사진을 다시 읽든, 궤짝에서
-- 확정하든, 손으로 넣든 모든 길이 이 자리를 지나가게 만든다.

-- ISBN 은 가장 확실한 신원이다. 다만 옛 책·전집은 없을 수 있어 있을 때만 건다.
create unique index if not exists books_owner_isbn_uq
  on public.books (owner_id, isbn)
  where isbn is not null and isbn <> '';

-- ISBN 이 없을 때를 위한 대비책: 제목과 지은이에서 공백·문장부호를 걷어낸 열쇠.
-- "삼대 26" 과 "삼대 27" 은 다른 책으로 남는다 (숫자를 지우지 않는다).
-- 주의: js 쪽(Edge Function 의 keyOf)도 같은 규칙이어야 한다. 한쪽만 고치면
-- 화면은 통과시키고 DB 가 거절하는 엇갈림이 생긴다.
alter table public.books
  add column if not exists dedup_key text
  generated always as (
    lower(regexp_replace(
      coalesce(title, '') || '|' || coalesce(author, ''),
      '[^0-9A-Za-z가-힣]', '', 'g'))
  ) stored;

create unique index if not exists books_owner_dedup_uq
  on public.books (owner_id, dedup_key);
