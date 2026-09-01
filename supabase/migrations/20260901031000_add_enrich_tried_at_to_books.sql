-- 서지 채우기가 이미 훑고 지나간 책의 표식.
-- 이것이 없으면 알라딘이 모르는 책이 대기줄 맨 앞에 쌓여, 자동 반복이
-- 같은 스무 권만 영원히 다시 묻는다 (뒤의 책은 영영 차례가 오지 않는다).
-- 서표에서 제목·지은이를 고치면 null 로 되돌려 다음 차례에 다시 묻는다.
alter table public.books add column if not exists enrich_tried_at timestamptz;
