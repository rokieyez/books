-- 갈피를 꽂은 시점 — 「지난번 142쪽 · 3주 전」처럼 멈춘 지 얼마나 됐는지
-- 오늘의 책이 알려주는 재료. updated_at 은 아무 칸이나 고쳐도 움직여서 못 쓴다.
alter table public.books add column bookmark_at timestamptz;
