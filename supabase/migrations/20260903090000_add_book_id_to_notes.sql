-- 글 한 편에 책 한 권을 걸 수 있게 한다.
--
-- 왜: 글방과 서재가 남남이었다. 책을 읽고 쓴 글인데 그 책으로 가는
-- 길이 없고, 책 쪽에서도 그 책을 말한 글을 알 수 없었다.
--
-- 왜 외래 키를 걸지 않나: books 는 서재가 통째로 다시 들이기도 하는
-- 표다(2026-09-01 에 544권을 한꺼번에 넣었다). 외래 키를 걸어 두면
-- 그런 작업이 글 때문에 막힌다. 책이 사라지면 글에 링크만 안 걸리게
-- 두는 편이 낫다 — 글이 책 때문에 지워지는 것보다.
alter table public.notes
  add column if not exists book_id uuid;

comment on column public.notes.book_id is
  '이 글이 말하는 책 (public.books.id). 외래 키를 일부러 걸지 않았다 — 서재를 통째로 다시 들이는 작업이 글 때문에 막히지 않게.';

-- 책 쪽에서 「이 책을 말한 글」을 찾을 때 쓴다
create index if not exists notes_book_id_idx
  on public.notes (book_id)
  where book_id is not null;
