/* 책 한 권짜리 나눔 쪽을 만든다 — b/<책id>.html
 *
 * 왜 필요한가:
 *   `#book/<id>` 는 브라우저에서는 잘 도는데, 링크 미리보기를 만드는 쪽
 *   (카카오톡·슬랙·트위터…)은 자바스크립트를 돌리지 않는다. 해시 뒤는
 *   서버로 가지도 않는다. 그래서 어느 책을 나눠도 미리보기는 늘 같은
 *   og.png 하나였다. 정적 사이트에서 이걸 고치는 길은 책마다 진짜 파일을
 *   하나씩 두는 것뿐이다.
 *
 * 무엇을 만드나:
 *   제목·지은이·표지가 박힌 og 태그만 가진 아주 작은 쪽. 사람이 열면
 *   곧바로 ../#book/<id> 로 넘어가고, 미리보기 로봇은 태그만 읽고 간다.
 *
 * 언제 다시 돌리나:
 *   책을 새로 꽂거나 표지가 바뀐 뒤. 안 돌려도 링크는 깨지지 않는다 —
 *   404.html 이 /b/<id>.html 을 알아보고 서재로 돌려보낸다 (미리보기만 없다).
 *
 * 쓰는 법:  node tools/make-book-pages.mjs
 */
import { writeFile, mkdir, readdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const 뿌리 = join(dirname(fileURLToPath(import.meta.url)), "..");
const 자리 = join(뿌리, "b");

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

/* 장서를 쪽으로 나눠 끝까지 읽는다 (PostgREST 는 한 번에 1,000줄까지) */
async function 장서() {
  const out = [];
  for (let from = 0; ; from += 500) {
    const to = from + 499;
    const r = await fetch(
      `${cfg.url}/rest/v1/books?select=id,title,author,publisher,published_year,cover_url,category,read_status,read_year,updated_at&order=id`,
      { headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}`, Range: `${from}-${to}` } },
    );
    if (!r.ok) throw new Error(`장서를 읽지 못했습니다 (${r.status}) ${await r.text()}`);
    const 쪽 = await r.json();
    out.push(...쪽);
    if (쪽.length < 500) break;
  }
  return out;
}

const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

/* 미리보기 그림은 알라딘 표지를 그대로 쓴다 — 우리 스토리지에 없다.
   표지가 없는 책은 서재의 기본 그림으로 돌아간다. */
const 쪽만들기 = (b) => {
  const 제목 = b.title || "무제";
  const 지은이 = b.author || "지은이 미상";
  const 부제 = [
    지은이,
    b.publisher || null,
    b.published_year || null,
    b.read_status === "읽음" ? (b.read_year ? `${b.read_year}년에 읽음` : "읽음") : null,
  ].filter(Boolean).join(" · ");
  const 그림 = b.cover_url || "https://www.rokiz.net/books/og.png";
  const 주소 = `https://www.rokiz.net/books/b/${b.id}.html`;

  /* 검색엔진에게 「이것은 책이다」라고 말해 준다. og 태그는 미리보기용이고,
     이쪽은 검색 결과의 얼굴을 정한다. 값이 없는 칸은 아예 넣지 않는다 —
     빈 문자열을 적으면 구조화 데이터 검사가 흠으로 잡는다. */
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
  };

  /* 본문의 서지 줄 — 로봇이 읽을 수 있게 진짜 글자로 적는다.
     사람은 이 화면을 볼 겨를이 없다 (아래 스크립트가 곧바로 서재로 보낸다). */
  const 줄 = [
    ["지은이", b.author],
    ["펴낸곳", b.publisher],
    ["펴낸해", b.published_year],
    ["분류", b.category],
    ["읽음", b.read_status === "읽음" ? (b.read_year ? `${b.read_year}년` : "읽음") : null],
  ].filter(([, v]) => v != null && v !== "");

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(제목)} — 서가 뒤의 방</title>
<link rel="canonical" href="${주소}">
<meta name="description" content="${esc(부제)} · 서가 뒤의 방">
<meta property="og:type" content="book">
<meta property="og:site_name" content="서가 뒤의 방">
<meta property="og:locale" content="ko_KR">
<meta property="og:title" content="${esc(제목)}">
<meta property="og:description" content="${esc(부제)}">
<meta property="og:image" content="${esc(그림)}">
<meta property="og:url" content="${주소}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(제목)}">
<meta name="twitter:description" content="${esc(부제)}">
<meta name="twitter:image" content="${esc(그림)}">
<link rel="icon" href="../favicon.svg" type="image/svg+xml">
<script type="application/ld+json">${JSON.stringify(표식).replace(/</g, "\\u003c")}</script>
<style>
  html { color-scheme: dark }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:#171009; color:#A3947A; font:14px/1.8 system-ui, sans-serif; text-align:center }
  main { padding:24px; max-width:38ch }
  h1 { margin:0 0 8px; font-size:19px; font-weight:400; color:#E2D5B8 }
  dl { margin:0 0 14px; font-size:12.5px; opacity:.75 }
  dt { display:inline; opacity:.6 } dd { display:inline; margin:0 10px 0 4px }
  a { color:#E0B15E }
</style>
</head>
<body>
  <main>
    <h1>${esc(제목)}</h1>
    ${줄.length ? `<dl>${줄.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` : ""}
    <p><a href="../#book/${b.id}">서가 뒤의 방에서 이 책을 엽니다</a></p>
  </main>
  <!-- 사람은 곧장 서재로 보낸다. 로봇은 자바스크립트를 돌리지 않으므로
       위의 서지와 ld+json 을 읽고 간다 — meta refresh 를 쓰면 로봇도
       「이 쪽은 딴 데로 간다」로 알고 본문을 통째로 버린다. -->
  <script>location.replace("../#book/${b.id}");</script>
</body>
</html>
`;
};

const books = await 장서();
await mkdir(자리, { recursive: true });

/* 서가에서 빠진 책의 쪽은 남겨 두지 않는다 — 없는 책의 미리보기가
   검색에 남는 것이 빈 링크보다 나쁘다 */
const 살아있음 = new Set(books.map((b) => `${b.id}.html`));
for (const f of await readdir(자리).catch(() => [])) {
  if (f.endsWith(".html") && !살아있음.has(f)) await rm(join(자리, f));
}

let n = 0, 표지 = 0;
for (const b of books) {
  await writeFile(join(자리, `${b.id}.html`), 쪽만들기(b), "utf8");
  n++;
  if (b.cover_url) 표지++;
}
console.log(`${n}권의 나눔 쪽을 지었습니다 (표지가 붙는 것 ${표지}권) → b/`);

/* 지도(sitemap) — 나눔 쪽은 서로 링크하지 않으므로, 지도가 없으면
   검색엔진은 첫 쪽 하나만 보고 돌아간다. 서재의 현관과 책 한 권씩을 적는다.
   lastmod 는 그 책을 마지막으로 손댄 날 (books_touch 트리거가 적어 둔 것). */
const 날 = (t) => (t ? String(t).slice(0, 10) : null);
const 지도 = [
  `<?xml version="1.0" encoding="UTF-8"?>`,
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
  `  <url><loc>https://www.rokiz.net/books/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>`,
  ...books.map((b) => {
    const m = 날(b.updated_at);
    return `  <url><loc>https://www.rokiz.net/books/b/${b.id}.html</loc>` +
      (m ? `<lastmod>${m}</lastmod>` : "") + `<priority>0.5</priority></url>`;
  }),
  `</urlset>`,
  "",
].join("\n");
await writeFile(join(뿌리, "sitemap.xml"), 지도, "utf8");
console.log(`지도에 ${books.length + 1}개 주소를 적었습니다 → sitemap.xml`);
