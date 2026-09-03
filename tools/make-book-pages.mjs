/* 서재의 정적인 얼굴들을 짓는다 — 나눔 쪽·색인·지도·피드·연간 회고
 *
 * 왜 필요한가:
 *   `#book/<id>` 는 브라우저에서는 잘 도는데, 링크 미리보기를 만드는 쪽
 *   (카카오톡·슬랙·트위터…)과 검색엔진은 자바스크립트를 돌리지 않는다.
 *   해시 뒤는 서버로 가지도 않는다. 그래서 어느 책을 나눠도 미리보기는 늘
 *   같은 og.png 하나였고, 검색에는 현관 한 장뿐이었다. 정적 사이트에서
 *   이걸 고치는 길은 책마다 진짜 파일을 하나씩 두는 것뿐이다.
 *
 * 무엇을 만드나:
 *   b/<슬러그>-<앞자리>.html   책 한 권의 쪽 (서지·기록·표식이 든 본체)
 *   b/<책id>.html              옛 주소 — 위 쪽으로 넘긴다 (이미 나눈 링크가 산다)
 *   b/index.html               책 전체 목록 — 로봇이 걸어 다닐 길
 *   sitemap.xml                지도
 *   feed.xml                   새로 꽂은 책·새로 지은 기록 (Atom)
 *   y/<연도>.html              그 해에 읽은 책
 *
 * 언제 다시 돌리나:
 *   책을 새로 꽂거나, 표지·기록이 바뀐 뒤. 안 돌려도 링크는 깨지지 않는다 —
 *   404.html 이 /b/<uuid>.html 을 알아보고 서재로 돌려보낸다 (미리보기만 없다).
 *
 * 쓰는 법:  node tools/make-book-pages.mjs
 */
import { writeFile, mkdir, readdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/* 알림 글이 끊겨도 하던 일은 끝낸다.
   `node tools/make-book-pages.mjs | head -2` 처럼 출력을 자르면 파이프가
   닫히면서 EPIPE 로 프로그램이 죽는다. 그런데 지도는 맨 마지막에 쓰이므로,
   그렇게 죽으면 sitemap.xml 이 0바이트로 남는다 — 실제로 그랬다 (2026-09-03).
   말은 못 해도 파일은 끝까지 쓴다. */
process.stdout.on("error", (e) => { if (e.code !== "EPIPE") throw e; });

const 뿌리 = join(dirname(fileURLToPath(import.meta.url)), "..");
const 자리 = join(뿌리, "b");
const 해자리 = join(뿌리, "y");
const 집 = "https://www.rokiz.net/books";

/* js/config.js 에서 접속 정보를 그대로 읽는다 — 값을 두 곳에 적지 않기 위해.
   이 키는 공개 키이고, 여기서 하는 일은 읽기뿐이다. */
const cfg = await (async () => {
  const src = await import("node:fs/promises").then((fs) =>
    fs.readFile(join(뿌리, "js/config.js"), "utf8"));
  const url = src.match(/supabaseUrl:\s*"([^"]+)"/)?.[1];
  const key = src.match(/supabaseKey:\s*"([^"]+)"/)?.[1];
  if (!url || !key) throw new Error("js/config.js 에서 접속 정보를 찾지 못했습니다");
  return { url, key };
})();

/* 표를 쪽으로 나눠 끝까지 읽는다 (PostgREST 는 한 번에 1,000줄까지) */
async function 전부(길) {
  const out = [];
  for (let from = 0; ; from += 500) {
    const r = await fetch(`${cfg.url}/rest/v1/${길}`, {
      headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}`, Range: `${from}-${from + 499}` },
    });
    if (!r.ok) throw new Error(`${길} 을 읽지 못했습니다 (${r.status}) ${await r.text()}`);
    const 쪽 = await r.json();
    out.push(...쪽);
    if (쪽.length < 500) break;
  }
  return out;
}

const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

/* 주소에 쓸 이름 — 「어둠의 심연」 → 어둠의-심연.
   한글은 그대로 둔다 (브라우저가 알아서 인코딩하고, 주소창에는 한글로 보인다).
   너무 길면 자르고, 같은 제목이 여럿이라 뒤에 책 아이디 앞자리를 붙인다. */
function 슬러그몸(제목) {
  return String(제목 || "무제")
    .replace(/[‘’“”「」『』]/g, "")                          // 따옴표·낫표는 지운다
    .replace(/[^0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ]+/g, "-")          // 나머지 구분자는 하이픈 하나로
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "") || "무제";
}

/* 검색엔진에게 「이것은 책이다」라고 말해 준다. og 태그는 미리보기용이고,
   이쪽은 검색 결과의 얼굴을 정한다. 값이 없는 칸은 아예 넣지 않는다 —
   빈 문자열을 적으면 구조화 데이터 검사가 흠으로 잡는다. */
const 표식쓰기 = (o) => `<script type="application/ld+json">${
  JSON.stringify(o).replace(/</g, "\\u003c")}</script>`;

const 머리 = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#171009">
<meta name="color-scheme" content="dark">`;

/* 나눔 쪽·색인·회고가 같은 옷을 입는다 — 서재의 밤빛을 그대로 */
const 옷 = `<style>
  html { color-scheme: dark }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:#171009; color:#A3947A; font:14px/1.8 system-ui, sans-serif }
  main { padding:28px 24px; max-width:70ch; width:100% }
  h1 { margin:0 0 10px; font-size:19px; font-weight:400; color:#E2D5B8 }
  dl { margin:0 0 14px; font-size:12.5px; opacity:.75 }
  dt { display:inline; opacity:.6 } dd { display:inline; margin:0 10px 0 4px }
  p.sum { margin:0 0 16px; font-size:13px; line-height:1.85; white-space:pre-line; opacity:.9 }
  a { color:#E0B15E }
  ul { margin:0; padding:0; list-style:none; columns:2; column-gap:28px }
  li { margin:0 0 5px; font-size:12.5px; break-inside:avoid }
  li i { font-style:normal; opacity:.5 }
  @media (max-width:560px) { ul { columns:1 } }
  /* 해마다의 막대 — 한 줄에 해·막대·권수 */
  .years { margin:0 0 20px; font-size:12px }
  .yr { display:grid; grid-template-columns:4.2em 1fr 3.2em; align-items:center; gap:9px; margin:0 0 5px }
  .yr .y { color:#9C8E74; letter-spacing:.04em }
  .yr .n { color:#9C8E74; text-align:right }
  .yr .bar { display:block; height:7px; background:rgba(224,177,94,.10); border-radius:2px; overflow:hidden }
  .yr .bar i { display:block; height:100%; background:rgba(224,177,94,.34) }
  .yr.on .y, .yr.on .n { color:#E2D5B8 }
  .yr.on .bar i { background:#E0B15E }
  /* 그 해의 표지들 — 제목 목록보다 한 해가 한눈에 들어온다.
     표지가 없는 책은 격자에 넣지 않는다 (빈 액자가 늘어서면 초라하다) */
  /* 바닥을 맞춘다 — 책은 꽂혀 있는 것이지 매달린 것이 아니다.
     표지마다 비율이 달라 위를 맞추면 아래가 들쭉날쭉해진다 */
  .covers { display:flex; flex-wrap:wrap; align-items:flex-end; gap:10px; margin:0 0 22px }
  .covers a { display:block; width:78px; line-height:0 }
  .covers img { width:78px; border-radius:2px; background:rgba(224,177,94,.06);
                box-shadow:0 2px 10px rgba(0,0,0,.45) }
</style>`;

/* ── 책 한 권의 쪽 ─────────────────────────────────────────────── */
const 쪽만들기 = (b, 기록) => {
  const 제목 = b.title || "무제";
  const 지은이 = b.author || "지은이 미상";
  const 부제 = [
    지은이,
    b.publisher || null,
    b.published_year || null,
    b.read_status === "읽음" ? (b.read_year ? `${b.read_year}년에 읽음` : "읽음") : null,
  ].filter(Boolean).join(" · ");
  const 그림 = b.cover_url || `${집}/og.png`;
  /* 지도의 loc 과 반드시 같은 글자여야 한다 (아래 지도짓기도 encodeURIComponent).
     한쪽만 날것 한글이면 검색엔진 눈에 서로 다른 두 주소가 된다 — 어느 쪽을
     대표로 삼을지 저쪽이 혼자 정하게 두는 셈이다. */
  const 주소 = `${집}/b/${encodeURIComponent(b.slug)}.html`;

  /* 기록이 있으면 그것이 이 쪽의 본문이다 — 검색 결과에 실리는 것도 이 글이다.
     AI 가 모른다고 고백한 첫 문장은 서재 화면처럼 각주로 밀지 않고 그냥 둔다
     (여기는 한 화면짜리 쪽이라 숨길 자리가 없다). */
  const 글 = (기록 || "").trim();
  const 요약 = 글 ? 글.replace(/\s+/g, " ").slice(0, 155) : 부제;

  const 표식 = {
    "@context": "https://schema.org",
    "@type": "Book",
    name: 제목,
    url: 주소,
    inLanguage: "ko",
    ...(b.author ? { author: { "@type": "Person", name: b.author } } : {}),
    ...(b.publisher ? { publisher: { "@type": "Organization", name: b.publisher } } : {}),
    ...(b.published_year ? { datePublished: String(b.published_year) } : {}),
    ...(b.cover_url ? { image: b.cover_url } : {}),
    ...(b.category ? { genre: b.category } : {}),
    ...(b.isbn ? { isbn: b.isbn } : {}),
    ...(b.page_count ? { numberOfPages: b.page_count } : {}),
    ...(글 ? { abstract: 글 } : {}),
    ...(b.read_status === "읽음"
      ? { readBy: { "@type": "Person", name: "로키즈" } } : {}),
  };

  const 줄 = [
    ["지은이", b.author],
    ["펴낸곳", b.publisher],
    ["펴낸해", b.published_year],
    ["쪽수", b.page_count ? `${b.page_count}쪽` : null],
    ["분류", b.category],
    ["읽음", b.read_status === "읽음" ? (b.read_year ? `${b.read_year}년` : "읽음") : null],
  ].filter(([, v]) => v != null && v !== "");

  return `<!doctype html>
<html lang="ko">
<head>
${머리}
<title>${esc(제목)} — 서가 뒤의 방</title>
<link rel="canonical" href="${주소}">
<meta name="description" content="${esc(요약)}">
<meta property="og:type" content="book">
<meta property="og:site_name" content="서가 뒤의 방">
<meta property="og:locale" content="ko_KR">
<meta property="og:title" content="${esc(제목)}">
<meta property="og:description" content="${esc(부제)}">
<meta property="og:image" content="${esc(그림)}">
<meta property="og:url" content="${주소}">
<!-- 책 표지는 세로로 길다. summary_large_image 로 걸면 1.91:1 띠에 맞추느라
     위아래가 잘려 제목이 날아간다 — 표지가 있는 책은 정사각 썸네일(summary)로
     온전히 보이게 하고, 표지가 없어 서재의 og.png(1200x630)로 돌아가는 책만
     넓은 카드를 쓴다 -->
<meta name="twitter:card" content="${b.cover_url ? "summary" : "summary_large_image"}">
<meta name="twitter:title" content="${esc(제목)}">
<meta name="twitter:description" content="${esc(부제)}">
<meta name="twitter:image" content="${esc(그림)}">
<link rel="icon" href="../favicon.svg" type="image/svg+xml">
<link rel="alternate" type="application/atom+xml" title="서가 뒤의 방" href="../feed.xml">
${표식쓰기(표식)}
${옷}
</head>
<body>
  <main>
    <h1>${esc(제목)}</h1>
    ${줄.length ? `<dl>${줄.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` : ""}
    ${글 ? `<p class="sum">${esc(글)}</p>` : ""}
    <p><a href="../#book/${b.id}">서가 뒤의 방에서 이 책을 엽니다</a>
       · <a href="index.html">책 목록</a></p>
  </main>
  <!-- 사람은 곧장 서재로 보낸다. 로봇은 자바스크립트를 돌리지 않으므로
       위의 서지와 ld+json 을 읽고 간다 — meta refresh 를 쓰면 로봇도
       「이 쪽은 딴 데로 간다」로 알고 본문을 통째로 버린다. -->
  <script>location.replace("../#book/${b.id}");</script>
</body>
</html>
`;
};

/* ── 옛 주소(b/<uuid>.html) ────────────────────────────────────────
   이미 나눈 링크가 죽지 않게 남긴다. canonical 로 새 주소를 가리켜
   검색엔진이 둘을 한 쪽으로 합치게 하고, 미리보기 태그는 그대로 둔다
   (카톡이 옛 링크를 다시 긁을 때 얼굴이 사라지지 않도록). */
const 옛쪽만들기 = (b) => {
  const 제목 = b.title || "무제";
  const 부제 = [b.author || "지은이 미상", b.publisher, b.published_year].filter(Boolean).join(" · ");
  const 그림 = b.cover_url || `${집}/og.png`;
  const 새 = `${집}/b/${encodeURIComponent(b.slug)}.html`;   // 새 쪽의 canonical 과 같은 글자로
  return `<!doctype html>
<html lang="ko">
<head>
${머리}
<title>${esc(제목)} — 서가 뒤의 방</title>
<link rel="canonical" href="${새}">
<meta name="description" content="${esc(부제)} · 서가 뒤의 방">
<meta property="og:type" content="book">
<meta property="og:site_name" content="서가 뒤의 방">
<meta property="og:title" content="${esc(제목)}">
<meta property="og:description" content="${esc(부제)}">
<meta property="og:image" content="${esc(그림)}">
<meta property="og:url" content="${새}">
<meta name="twitter:card" content="${b.cover_url ? "summary" : "summary_large_image"}">
<meta name="twitter:image" content="${esc(그림)}">
<link rel="icon" href="../favicon.svg" type="image/svg+xml">
${옷}
</head>
<body>
  <main><h1>${esc(제목)}</h1>
    <p><a href="${슬러그파일(b)}">이 책의 쪽으로</a></p></main>
  <script>location.replace(${JSON.stringify(슬러그파일(b))});</script>
</body>
</html>
`;
};
function 슬러그파일(b) { return `${encodeURIComponent(b.slug)}.html`; }

/* ── 책 목록 (b/index.html) ────────────────────────────────────────
   나눔 쪽끼리는 서로 링크하지 않는다. 지도만으로도 찾아지긴 하지만,
   로봇이 실제로 걸어 다닐 길이 하나는 있어야 한다 — 사람에게도 쓸모가 있다. */
const 색인만들기 = (books) => {
  const 정렬 = [...books].sort((a, b) => (a.title || "").localeCompare(b.title || "", "ko"));
  return `<!doctype html>
<html lang="ko">
<head>
${머리}
<title>책 목록 — 서가 뒤의 방</title>
<link rel="canonical" href="${집}/b/">
<meta name="description" content="서가 뒤의 방에 꽂힌 ${books.length}권 — 제목 차례로.">
<meta name="robots" content="index, follow">
<!-- 이 쪽도 링크로 건네진다 — og 가 없으면 카톡·슬랙이 회색 상자를 띄운다.
     tools/check-house.mjs 가 2026-09-03 에 이 빠짐을 잡아냈다. -->
<meta property="og:type" content="website">
<meta property="og:site_name" content="서가 뒤의 방">
<meta property="og:locale" content="ko_KR">
<meta property="og:title" content="책 목록 — 서가 뒤의 방">
<meta property="og:description" content="서가 뒤의 방에 꽂힌 ${books.length}권 — 제목 차례로.">
<meta property="og:url" content="${집}/b/">
<meta property="og:image" content="${집}/og.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="책 목록 — 서가 뒤의 방">
<meta name="twitter:description" content="서가 뒤의 방에 꽂힌 ${books.length}권 — 제목 차례로.">
<meta name="twitter:image" content="${집}/og.png">
<link rel="icon" href="../favicon.svg" type="image/svg+xml">
<link rel="alternate" type="application/atom+xml" title="서가 뒤의 방" href="../feed.xml">
${표식쓰기({
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "책 목록 — 서가 뒤의 방",
    url: `${집}/b/`,
    inLanguage: "ko",
    numberOfItems: books.length,
  })}
${옷}
</head>
<body>
  <main>
    <h1>서가 뒤의 방 — 책 ${books.length.toLocaleString()}권</h1>
    <p><a href="../">서재로 들어갑니다</a></p>
    <ul>
${정렬.map((b) => `      <li><a href="${슬러그파일(b)}">${esc(b.title || "무제")}</a>` +
      (b.author ? ` <i>${esc(b.author)}</i>` : "") + `</li>`).join("\n")}
    </ul>
  </main>
</body>
</html>
`;
};

/* 그 해에 읽은 책의 표지를 늘어놓는다. 알라딘의 「No Image」 그림은
   표지가 없는 것으로 친다 — 회색 안내판이 액자에 걸리면 초라하다.
   한 권도 표지가 없으면 격자를 아예 그리지 않는다. */
const 표지격자 = (목록) => {
  const 있는 = 목록.filter((b) => b.cover_url && !/\/noimg/i.test(b.cover_url));
  if (!있는.length) return "";
  return `<div class="covers">${있는.map((b) =>
    `<a href="../b/${슬러그파일(b)}"><img src="${esc(b.cover_url)}" alt="${
      esc(b.title || "무제")} 표지" loading="lazy" decoding="async"></a>`).join("")}</div>`;
};

/* 해마다 몇 권을 읽었는가 — 한 해만 있으면 견줄 것이 없으므로 그리지 않는다.
   막대는 가장 많이 읽은 해를 100 으로 잡아 잰다. 색은 하나뿐이라(황동)
   계열색 검증이 필요 없고, 숫자를 막대 옆에 그대로 적어 두어 막대 길이를
   눈으로 어림하지 않아도 되게 한다. 지금 보는 해는 밝게. */
const 막대 = (이해, 해들, 해별) => {
  if (해들.length < 2) return "";
  const 큰 = Math.max(...해들.map((y) => 해별.get(y).length));
  const 줄 = [...해들].sort((a, b) => a - b).map((y) => {
    const n = 해별.get(y).length;
    const 폭 = Math.max(3, Math.round(n / 큰 * 100));
    const 이번 = y === 이해;
    return `<div class="yr${이번 ? " on" : ""}">` +
      `<span class="y">${y}</span>` +
      `<span class="bar"><i style="width:${폭}%"></i></span>` +
      `<span class="n">${n}권</span></div>`;
  }).join("");
  return `<div class="years" role="img" aria-label="해마다 읽은 권수: ${
    [...해들].sort((a, b) => a - b).map((y) => `${y}년 ${해별.get(y).length}권`).join(", ")}">${줄}</div>`;
};

/* ── 그 해에 읽은 책 (y/<연도>.html) ───────────────────────────────
   통계의 회고 패널은 서재 안쪽에 있어 나누기 어렵다. 한 해를 한 쪽으로
   떼어 두면 링크 하나로 건넬 수 있고, 검색에도 남는다. */
const 해쪽만들기 = (해, 목록, 해들, 해별) => {
  const 쪽수 = 목록.reduce((a, b) => a + (b.page_count || 0), 0);
  const 갈래 = {};
  목록.forEach((b) => { const k = b.category || "그 밖"; 갈래[k] = (갈래[k] || 0) + 1; });
  const 갈래글 = Object.entries(갈래).sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} ${n}권`).join(" · ");
  const 요약 = `${해}년에 ${목록.length}권을 읽었습니다` +
    (쪽수 ? ` — 모두 ${쪽수.toLocaleString()}쪽.` : ".");
  return `<!doctype html>
<html lang="ko">
<head>
${머리}
<title>${해}년의 서재 — 서가 뒤의 방</title>
<link rel="canonical" href="${집}/y/${해}.html">
<meta name="description" content="${esc(요약)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="서가 뒤의 방">
<meta property="og:locale" content="ko_KR">
<meta property="og:title" content="${해}년의 서재">
<meta property="og:description" content="${esc(요약)}">
<meta property="og:image" content="${집}/og.png">
<meta property="og:url" content="${집}/y/${해}.html">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${집}/og.png">
<link rel="icon" href="../favicon.svg" type="image/svg+xml">
<link rel="alternate" type="application/atom+xml" title="서가 뒤의 방" href="../feed.xml">
<!-- 정적 쪽 가운데 여기만 집의 글꼴을 받는다. 나눔 쪽은 곧장 서재로
     넘어가고 책 목록은 로봇이 걸어 다니는 길이지만, 회고는 사람이 머물러
     읽는 쪽이라 시스템 글꼴로는 집의 얼굴이 아니다. 굵기 하나(400)만
     받는다 — 한글 글꼴은 굵기 하나가 CSS 로만 23KB(gzip) 다. -->
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Gowun+Batang&display=swap">
${표식쓰기({
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${해}년의 서재`,
    url: `${집}/y/${해}.html`,
    inLanguage: "ko",
    numberOfItems: 목록.length,
  })}
${옷}
<style>
  body { font-family: "Gowun Batang", serif; letter-spacing: .01em }
  h1 { font-size: 22px; letter-spacing: .04em }
  p.sum, li { word-break: keep-all }
</style>
</head>
<body>
  <main>
    <h1>${해}년의 서재</h1>
    <dl><dt>읽은 책</dt><dd>${목록.length}권</dd>${
      쪽수 ? `<dt>쪽수</dt><dd>${쪽수.toLocaleString()}쪽</dd>` : ""}${
      갈래글 ? `<dt>갈래</dt><dd>${esc(갈래글)}</dd>` : ""}</dl>
    <ul>
${목록.map((b) => `      <li><a href="../b/${슬러그파일(b)}">${esc(b.title || "무제")}</a>` +
      (b.author ? ` <i>${esc(b.author)}</i>` : "") + `</li>`).join("\n")}
    </ul>
    ${표지격자(목록)}
    ${막대(해, 해들, 해별)}
    <p style="margin-top:18px">${해들.filter((y) => y !== 해)
      .map((y) => `<a href="${y}.html">${y}년 ${해별.get(y).length}권</a>`).join(" · ")}${해들.length > 1 ? " · " : ""}<a href="../#stats">서재의 통계로</a> · <a href="../">서재로</a></p>
  </main>
</body>
</html>
`;
};

/* ── 피드 (feed.xml) ──────────────────────────────────────────────
   서재를 구독한다는 것은 「새 책이 꽂혔다」와 「새 기록이 지어졌다」를
   받는 일이다. 기록에는 진짜 시각(generated_at)이 있고, 입고에는
   created_at 이 있다 — 둘을 합쳐 최근 것부터 마흔 개. */
const 피드만들기 = (일들) => {
  const 갱신 = 일들[0]?.때 || new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="ko">
  <title>서가 뒤의 방</title>
  <subtitle>책장인 줄 알았는데 문이었다 — 한 사람의 서재에 드는 책과 기록</subtitle>
  <link href="${집}/feed.xml" rel="self"/>
  <link href="${집}/"/>
  <id>${집}/</id>
  <updated>${갱신}</updated>
  <author><name>로키즈</name></author>
${일들.map((it) => `  <entry>
    <title>${esc(it.제목)}</title>
    <link href="${집}/b/${슬러그파일(it.책)}"/>
    <id>tag:rokiz.net,2026:${it.갈래 === "기록" ? "note" : "shelved"}/${it.책.id}</id>
    <updated>${it.때}</updated>
    <category term="${it.갈래 === "기록" ? "기록" : "입고"}"/>
    <summary>${esc(it.글)}</summary>
  </entry>`).join("\n")}
</feed>
`;
};

/* ── 지음 ─────────────────────────────────────────────────────────── */
const books = await 전부(
  "books?select=id,title,author,publisher,published_year,cover_url,category," +
  "read_status,read_year,updated_at,created_at,isbn,page_count&order=id");
const 기록들 = await 전부("book_summaries?select=book_id,summary,generated_at");
const 기록표 = new Map(기록들.map((s) => [s.book_id, s]));

/* 슬러그가 겹치면(같은 제목의 다른 판본) 뒤의 아이디 앞자리가 갈라 준다.
   그래도 겹치면 자리 수를 늘린다 — 파일 하나가 다른 책을 덮어쓰면 안 된다. */
const 쓴이름 = new Set();
books.forEach((b) => {
  const 몸 = 슬러그몸(b.title);
  let s = `${몸}-${b.id.slice(0, 8)}`;
  // 앞자리 여덟 자로도 겹치면(같은 제목의 다른 판본) 자리를 늘려 가른다
  for (let n = 12; 쓴이름.has(s) && n <= 36; n += 4) s = `${몸}-${b.id.slice(0, n)}`;
  쓴이름.add(s);
  b.slug = s;
});

await mkdir(자리, { recursive: true });
await mkdir(해자리, { recursive: true });

/* 서가에서 빠진 책의 쪽은 남겨 두지 않는다 — 없는 책의 미리보기가
   검색에 남는 것이 빈 링크보다 나쁘다 */
const 살아있음 = new Set(books.flatMap((b) => [`${b.id}.html`, `${b.slug}.html`]));
살아있음.add("index.html");
for (const f of await readdir(자리).catch(() => [])) {
  if (f.endsWith(".html") && !살아있음.has(f)) await rm(join(자리, f));
}

let 기록붙음 = 0, 표지 = 0;
for (const b of books) {
  const 글 = 기록표.get(b.id)?.summary || null;
  if (글) 기록붙음++;
  if (b.cover_url) 표지++;
  await writeFile(join(자리, `${b.slug}.html`), 쪽만들기(b, 글), "utf8");
  await writeFile(join(자리, `${b.id}.html`), 옛쪽만들기(b), "utf8");
}
await writeFile(join(자리, "index.html"), 색인만들기(books), "utf8");
console.log(`${books.length}권의 나눔 쪽을 지었습니다 — 기록이 실린 것 ${기록붙음}권, 표지가 붙는 것 ${표지}권`);
console.log(`옛 주소(b/<아이디>.html) ${books.length}장도 새 쪽으로 이어 두었습니다`);

/* 그 해에 읽은 책 */
const 해별 = new Map();
books.filter((b) => b.read_year).forEach((b) => {
  if (!해별.has(b.read_year)) 해별.set(b.read_year, []);
  해별.get(b.read_year).push(b);
});
const 해들 = [...해별.keys()].sort((a, b) => b - a);
for (const [해, 목록] of 해별) {
  목록.sort((a, b) => (a.title || "").localeCompare(b.title || "", "ko"));
  await writeFile(join(해자리, `${해}.html`), 해쪽만들기(해, 목록, 해들, 해별), "utf8");
}
/* 없어진 해의 쪽은 지운다 (읽은 해를 고쳐 그 해가 비었을 때) */
for (const f of await readdir(해자리).catch(() => [])) {
  if (f.endsWith(".html") && !해별.has(Number(f.replace(".html", "")))) await rm(join(해자리, f));
}
console.log(`읽은 해 ${해들.length}개의 회고 쪽을 지었습니다 → y/ (${해들.join(", ")})`);

/* 피드 */
const 일들 = [
  ...기록들.filter((s) => s.generated_at).map((s) => {
    const 책 = books.find((b) => b.id === s.book_id);
    return 책 && {
      책, 갈래: "기록", 때: new Date(s.generated_at).toISOString(),
      제목: `기록 — ${책.title || "무제"}`,
      글: (s.summary || "").replace(/\s+/g, " ").slice(0, 300),
    };
  }).filter(Boolean),
  ...books.filter((b) => b.created_at).map((b) => ({
    책: b, 갈래: "입고", 때: new Date(b.created_at).toISOString(),
    제목: `${b.title || "무제"} 입고`,
    글: [b.author, b.publisher, b.published_year].filter(Boolean).join(" · ") || "서가에 꽂혔습니다",
  })),
].sort((a, b) => (a.때 < b.때 ? 1 : -1)).slice(0, 40);
await writeFile(join(뿌리, "feed.xml"), 피드만들기(일들), "utf8");
console.log(`피드에 최근 ${일들.length}개를 담았습니다 → feed.xml`);

/* 지도(sitemap) — 나눔 쪽은 서로 링크하지 않으므로, 지도가 없으면
   검색엔진은 첫 쪽 하나만 보고 돌아간다. 서재의 현관과 책 한 권씩을 적는다.
   lastmod 는 그 책을 마지막으로 손댄 날 (books_touch 트리거가 적어 둔 것).
   옛 주소(uuid)는 넣지 않는다 — 새 쪽을 가리키는 이정표일 뿐이다. */
const 날 = (t) => (t ? String(t).slice(0, 10) : null);
const 지도 = [
  `<?xml version="1.0" encoding="UTF-8"?>`,
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
  `  <url><loc>${집}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>`,
  `  <url><loc>${집}/b/</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>`,
  ...해들.map((y) => `  <url><loc>${집}/y/${y}.html</loc><priority>0.6</priority></url>`),
  ...books.map((b) => {
    const m = 날(b.updated_at);
    return `  <url><loc>${집}/b/${encodeURIComponent(b.slug)}.html</loc>` +
      (m ? `<lastmod>${m}</lastmod>` : "") + `<priority>0.5</priority></url>`;
  }),
  `</urlset>`,
  "",
].join("\n");
await writeFile(join(뿌리, "sitemap.xml"), 지도, "utf8");
console.log(`지도에 ${books.length + 2 + 해들.length}개 주소를 적었습니다 → sitemap.xml`);
