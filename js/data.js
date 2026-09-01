/* 서가의 뼈대 — 벽의 이름과 설명만 여기 산다.
 *
 * 예전에는 이 파일이 방문자용 표본 장서(1,199권짜리 가짜 데이터)를 만들었다.
 * 이제 서재는 공개다: 책은 로그인과 무관하게 전부 Supabase 에서 온다
 * (읽기는 누구나, 쓰기는 주인만 — RLS 가 정한다). 그래서 여기엔
 * 빈 벽의 뼈대만 남았고, auth.js 의 loadRealLibrary 가 살을 붙인다.
 */
const $ = (id) => document.getElementById(id);

/* 결정적 난수 — 기록의 벽의 「제목 없는 책들」을 항상 같은 모양으로 그린다 */
function makeRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const WALLS = [
  { nm: "역사의 벽", cat: "역사", n: 0, desc: "연대기와 지도의 방이 뒤에 있다", read: 0, books: [], featured: [], latchIdx: -1 },
  { nm: "문학의 벽", cat: "문학", n: 0, desc: "가장 큰 벽 — 전집이 산다", read: 0, books: [], featured: [], latchIdx: -1 },
  { nm: "과학의 벽", cat: "과학", n: 0, desc: "별과 유전자의 방", read: 0, books: [], featured: [], latchIdx: -1 },
  { nm: "예술과 사회의 벽", cat: "예술사회", n: 0, desc: "그림과 광장의 방", read: 0, books: [], featured: [], latchIdx: -1 },
  { nm: "종교의 벽", cat: "종교", n: 0, desc: "경전과 신학의 방", read: 0, books: [], featured: [], latchIdx: -1 },
  { nm: "기록의 벽", cat: "archive", n: 0, desc: "…이 벽의 책들에는 제목이 없다", read: 0 },
];

/* 기록의 벽 내용물 — loadRealLibrary 가 실제 기록으로 채운다 */
const LEAVES = [];
