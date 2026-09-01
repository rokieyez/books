/* 서지를 채운다 — 책등에서 읽은 제목에 진짜 정보를 붙인다
 *
 * 책등 글씨만으로는 「박상룡」처럼 잘못 읽히고, ISBN·출판사·표지가 비어 있다.
 * 알라딘에 물어 채우고, 아주 비슷하지만 다른 표기는 바로잡는다.
 *
 * 제목을 함부로 갈아치우지 않는다:
 *   전혀 다른 책이 잡히면 남의 제목으로 덮어써 되돌릴 수 없다.
 *   그래서 "거의 같은데 조금 다른" 경우에만 고친다. 나머지는 ISBN 같은
 *   빈 칸만 채우고 제목은 그대로 둔다.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

/* 비교용 열쇠 — 공백·문장부호를 걷어낸 뒤 견준다 */
const norm = (s: string) =>
  (s || "").toLowerCase().replace(/[^0-9a-z가-힣]/g, "");

/* 두 글자열이 얼마나 닮았는지 (0~1). 편집거리를 길이로 나눈 값. */
function similar(a: string, b: string): number {
  a = norm(a); b = norm(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return 1 - d[m][n] / Math.max(m, n);
}

/* 알라딘은 제목·설명에 HTML 실체를 그대로 담아 보낸다 (&lt; &amp; 등) */
function decode(s: string) {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

/* 알라딘의 분류 경로를 이 서재의 다섯 갈래로 옮긴다.
   예: "국내도서>소설/시/희곡>한국소설>2000년대 이전 한국소설" → 문학 */
function catOf(path: string): string | null {
  const p = path.replace(/\s/g, "");
  if (/소설|시\/희곡|에세이|시집|희곡/.test(p)) return "문학";
  if (/역사|인물|고전/.test(p)) return "역사";
  if (/과학|공학|컴퓨터|모바일|의학|수학/.test(p)) return "과학";
  if (/예술|대중문화|만화|건축|사진|음악|미술/.test(p)) return "예술";
  if (/종교|기독교|불교|천주교|가톨릭|신학|성경|이슬람|힌두/.test(p)) return "종교";
  if (/사회|정치|경제|경영|법|교육|자기계발|인문학|철학/.test(p)) return "사회";
  return null;   // 알아볼 수 없으면 원래 분류를 그대로 둔다
}

/* 알라딘 표지는 기본이 엄지손톱(coversum)이라 흐리다. 사이트 검색 화면이 쓰는
   큰 그림(cover500)으로 주소를 올려 보고, 진짜 있는지 HEAD 로 확인한 뒤에만
   바꾼다 — 아주 옛 책은 큰 그림이 없을 수 있고, 그때는 원래 것을 지킨다.
   (기존 196권도 같은 방법으로 전수 확인 후 승급했다, 2026-09-01) */
async function bigCover(url: string | null): Promise<string | null> {
  if (!url) return null;
  const up = url.replace(/\/cover(?:sum|\d+)\//, "/cover500/");
  if (up === url) return url;
  try {
    const r = await fetch(up, { method: "HEAD" });
    if (r.ok) return up;
  } catch { /* 못 물으면 원래 것 그대로 */ }
  return url;
}

async function aladin(key: string, query: string, target = "Book", queryType = "Keyword") {
  const params = new URLSearchParams({
    ttbkey: key,
    Query: query,
    QueryType: queryType,
    MaxResults: "5",
    start: "1",
    SearchTarget: target,
    output: "js",
    Version: "20131101",
  });
  const url = `https://www.aladin.co.kr/ttb/api/ItemSearch.aspx?${params}`;
  const res = await fetch(url);
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

/* 제목 끝의 권수 — 「백야행 1」의 1, 「13계단 029」의 029 */
function volOf(t: string): string | null {
  const m = norm(t).match(/(\d+)$/);
  return m ? String(Number(m[1])) : null;
}

/* 두 제목이 같은 책인지 점수를 매긴다.
   편집거리만 쓰면 「백야행 1」과 「백야행 1 - 하얀 어둠 속을 걷다」처럼
   부제가 긴 판본이 남남으로 나온다 — 포함 관계를 후하게 쳐 주되,
   권수가 어긋나면(1권과 2권) 크게 깎는다. */
function matchScore(mine: string, theirs: string): number {
  const a = norm(mine), b = norm(theirs);
  if (!a || !b) return 0;
  let s: number;
  if (a === b) s = 1;
  else if (b.startsWith(a) || a.startsWith(b)) s = 0.85;
  else if (a.length >= 4 && b.includes(a)) s = 0.8;
  else s = similar(mine, theirs);
  const va = volOf(mine), vb = volOf(theirs);
  if (va && vb && va === vb) s += 0.1;
  else if ((va || vb) && va !== vb) s -= 0.2;
  return s;
}

/* 다섯 결과 중 가장 닮은 것을 고른다 — 첫 번째가 늘 정답은 아니다 */
function pickBest(items: Array<Record<string, unknown>>, title: string) {
  let best = null, bestScore = 0;
  for (const it of items) {
    const sc = matchScore(title, decode(String(it.title ?? "")));
    if (sc > bestScore) { best = it; bestScore = sc; }
  }
  return { best, score: bestScore };
}

/* 쪽수는 검색(ItemSearch)에는 없고 조회(ItemLookUp)의 subInfo 에 온다.
   ISBN 을 알아낸 뒤 한 번 더 물어야 한다. 조회에는 출판사·표지도 같이
   오므로, ISBN 만 있고 나머지가 빈 책을 마저 채우는 데도 쓴다.
   OptResult=packing 을 붙이면 실물 크기(mm)도 온다 — 책등을 진짜
   판형대로 그리는 데 쓴다 (subInfo.packing.sizeHeight/sizeDepth). */
async function aladinLookup(key: string, id: string, idType?: string) {
  const params = new URLSearchParams({
    ttbkey: key,
    ItemId: id,
    ItemIdType: idType || (id.length === 13 ? "ISBN13" : "ISBN"),
    OptResult: "packing",
    output: "js",
    Version: "20131101",
  });
  const url = `https://www.aladin.co.kr/ttb/api/ItemLookUp.aspx?${params}`;
  try {
    const res = await fetch(url);
    const j = JSON.parse((await res.text()).replace(/;$/, ""));
    const it = j.item?.[0];
    if (!it) return null;
    const p = Number(it.subInfo?.itemPage ?? 0);
    // 크기는 mm — 말이 되는 범위(책 높이 80~400, 등두께 3~150)만 믿는다
    const mm = (v: unknown, lo: number, hi: number) => {
      const n = Number(v ?? 0);
      return n >= lo && n <= hi ? Math.round(n) : null;
    };
    return {
      title: it.title ? decode(String(it.title)).trim() : null,
      author: it.author ? decode(String(it.author)).split(/[,(]/)[0].trim() : null,
      isbn13: it.isbn13 ? String(it.isbn13) : null,
      pages: p > 0 && p < 32000 ? p : null,
      sizeHeight: mm(it.subInfo?.packing?.sizeHeight, 80, 400),
      sizeDepth: mm(it.subInfo?.packing?.sizeDepth, 3, 150),
      publisher: it.publisher ? decode(String(it.publisher)) : null,
      cover: it.cover ? await bigCover(String(it.cover)) : null,
      year: /^\d{4}/.test(String(it.pubDate ?? "")) ? Number(String(it.pubDate).slice(0, 4)) : null,
      category: catOf(String(it.categoryName ?? "")),
    };
  } catch {
    return null;
  }
}

/* 알라딘 웹사이트를 ISBN 으로 뒤진다 — API 검색에도 없는 절판서가 사이트에는
   있는 일이 있다. HTML 에서 ItemId 만 줍고 서지는 조회 API 로 받는다.
   광고 배너의 ItemId 가 섞이므로, 13자리면 조회 결과의 ISBN 이 정확히
   같을 때만 믿는다 (10자리는 견줄 것이 없어 조회가 성사되면 받는다). */
async function siteLookup(ttb: string, isbn: string) {
  try {
    const res = await fetch(
      "https://www.aladin.co.kr/search/wsearchresult.aspx?SearchTarget=All&SearchWord=" + isbn,
      { headers: { "User-Agent": "Mozilla/5.0" } },
    );
    const html = await res.text();
    const ids = [...new Set(
      [...html.matchAll(/wproduct\.aspx\?ItemId=(\d+)/g)].map((m) => m[1]),
    )].slice(0, 5);
    for (const id of ids) {
      const info = await aladinLookup(ttb, id, "ItemId");
      if (info?.title && (isbn.length !== 13 || info.isbn13 === isbn)) return info;
    }
  } catch { /* 사이트가 막혀도 다음 길이 있다 */ }
  return null;
}

/* 알라딘 밖의 마지막 길 — 구글 도서. 열쇠 없이 ISBN 으로 물을 수 있고,
   알라딘이 끝내 모르는 옛 책·작은 출판사 책도 곧잘 나온다.
   표지는 작고 실물 크기(mm)는 없지만, 빈손보다는 낫다. */
async function googleBooks(isbn: string) {
  try {
    const res = await fetch("https://www.googleapis.com/books/v1/volumes?q=isbn:" + isbn);
    const j = await res.json();
    const v = j.items?.[0]?.volumeInfo;
    if (!v?.title) return null;
    return {
      title: String(v.title).trim(),
      author: v.authors?.[0] ? String(v.authors[0]).trim() : null,
      isbn13: isbn.length === 13 ? isbn : null,
      pages: Number(v.pageCount) > 0 ? Number(v.pageCount) : null,
      sizeHeight: null, sizeDepth: null,
      publisher: v.publisher ? String(v.publisher).trim() : null,
      cover: v.imageLinks?.thumbnail
        ? String(v.imageLinks.thumbnail).replace(/^http:/, "https:") : null,
      year: /^\d{4}/.test(String(v.publishedDate ?? ""))
        ? Number(String(v.publishedDate).slice(0, 4)) : null,
      category: null,   // 구글 분류는 영어 갈래라 옮기지 않는다 — 원래 분류를 지킨다
    };
  } catch {
    return null;
  }
}

/* 알라딘 API 가 살아 있는지 한 번 묻는다 — 조회가 다 빈손일 때만 부른다.
   하루 5,000건 한도를 다 쓰면 모든 호출이 {errorCode, errorMessage} 로
   거부되는데, 그걸 「없는 번호」라고 말하면 사람이 번호를 의심하게 된다. */
async function aladinDown(ttb: string): Promise<string | null> {
  try {
    const r = await aladin(ttb, "책", "Book", "Keyword");
    const j = JSON.parse(r.text.replace(/;$/, ""));
    if (j.errorCode != null) return String(j.errorMessage ?? j.errorCode);
  } catch { /* 응답조차 없으면 판단 보류 */ }
  return null;
}

/* 조회의 사다리 — ① ItemLookUp ② ISBN 검색(정확 일치만) ③ 알라딘 사이트
   ④ 구글 도서. ItemLookUp 은 절판·옛 책에서 곧잘 빈손이 된다. 사람이
   붙여넣은 번호가 오는 서표·바코드 길에서만 쓴다. */
async function lookupHard(ttb: string, isbn: string) {
  const direct = await aladinLookup(ttb, isbn);
  if (direct?.title) return direct;
  for (const target of ["Book", "Foreign", "All"]) {
    try {
      const r = await aladin(ttb, isbn, target, "Keyword");
      const j = JSON.parse(r.text.replace(/;$/, ""));
      const it = (j.item ?? []).find((x: Record<string, unknown>) =>
        String(x.isbn13 ?? "") === isbn || String(x.isbn ?? "") === isbn);
      if (!it) continue;
      if (it.itemId) {
        const info = await aladinLookup(ttb, String(it.itemId), "ItemId");
        if (info?.title) return info;
      }
      // 조회가 끝내 빈손이면 검색 결과의 서지로라도 답한다 — 쪽수·크기만 빈다
      return {
        title: it.title ? decode(String(it.title)).trim() : null,
        author: it.author ? decode(String(it.author)).split(/[,(]/)[0].trim() : null,
        isbn13: it.isbn13 ? String(it.isbn13) : null,
        pages: null, sizeHeight: null, sizeDepth: null,
        publisher: it.publisher ? decode(String(it.publisher)) : null,
        cover: it.cover ? await bigCover(String(it.cover)) : null,
        year: /^\d{4}/.test(String(it.pubDate ?? "")) ? Number(String(it.pubDate).slice(0, 4)) : null,
        category: catOf(String(it.categoryName ?? "")),
      };
    } catch { /* 다음 과녁으로 */ }
  }
  // API 가 끝내 모르면: 알라딘 사이트 → 구글 도서 순으로 더 내려간다
  return (await siteLookup(ttb, isbn)) ?? (await googleBooks(isbn));
}

/* 마지막 수단 — 알라딘 웹사이트 검색.
   API 검색이 놓치는 책도 사이트 검색에는 잡히는 일이 있다. HTML 에서는
   ItemId 만 줍고, 서지는 반드시 조회 API 로 받는다 — 화면 구조가 바뀌어도
   깨지는 것은 발견뿐이고, 데이터가 더러워지지는 않는다. */
async function webFallback(key: string, title: string, author: string | null) {
  try {
    const q = encodeURIComponent([title, author].filter(Boolean).join(" "));
    const res = await fetch(
      `https://www.aladin.co.kr/search/wsearchresult.aspx?SearchTarget=All&SearchWord=${q}`,
      { headers: { "User-Agent": "Mozilla/5.0" } },
    );
    const html = await res.text();
    // 앞머리 광고·배너에도 ItemId 가 있어, 점수로 걸러낸다
    const ids = [...new Set(
      [...html.matchAll(/wproduct\.aspx\?ItemId=(\d+)/g)].map((m) => m[1]),
    )].slice(0, 5);
    for (const id of ids) {
      const info = await aladinLookup(key, id, "ItemId");
      if (info?.title && matchScore(title, info.title) >= 0.5) {
        return { info, score: matchScore(title, info.title) };
      }
    }
  } catch { /* 사이트가 막혀도 채우기 전체는 계속 돈다 */ }
  return null;
}

/* 후보 하나를 알라딘 서지로 꽂는다 — 궤짝 확정과 수동 검색이 같이 쓴다.
   겹치면(23505) 후보를 접고, 성공하면 확정으로 표시한다. */
// deno-lint-ignore no-explicit-any
async function plantCandidate(db: any, ttb: string, c: any, best: Record<string, unknown>) {
  const isbn = best.isbn13 || best.isbn ? String(best.isbn13 || best.isbn) : null;
  const info = isbn ? await aladinLookup(ttb, isbn) : null;
  const guess = (c.candidates as Array<Record<string, unknown>> | null)?.[0] ?? {};
  const category = catOf(String(best.categoryName ?? "")) || String(guess.category || "문학");
  const photo = (c.intake_photos ?? {}) as { wall?: string | null; shelf?: number | null };
  let wall = photo.wall || null;
  if (!wall) {
    const { data: w } = await db.rpc("wall_for_category", { cat: category });
    wall = (w as string | null) || "문학";
  }
  const title = decode(String(best.title ?? "")).trim();
  const { data: made, error: e2 } = await db.from("books").insert({
    title,
    author: best.author ? decode(String(best.author)).split(/[,(]/)[0].trim() : null,
    category, isbn,
    publisher: info?.publisher ?? (best.publisher ? decode(String(best.publisher)) : null),
    cover_url: info?.cover ?? (best.cover ? await bigCover(String(best.cover)) : null),
    published_year: info?.year ?? null,
    page_count: info?.pages ?? null,
    size_height: info?.sizeHeight ?? null,
    size_depth: info?.sizeDepth ?? null,
    wall,
    shelf: photo.shelf ?? null,
    spine_photo_id: c.photo_id ?? null,
    spine_box: c.spine_box ?? null,
    enrich_tried_at: new Date().toISOString(),
  }).select("id").single();
  if (e2) {
    if (e2.code === "23505") {   // 이미 꽂혀 있다 — 후보만 접는다
      await db.from("intake_candidates").update({ status: "버림" }).eq("id", c.id);
      return { dup: true, title };
    }
    return { fail: String(e2.message ?? e2), title };
  }
  await db.from("intake_candidates")
    .update({ status: "확정", resolved_book_id: made.id }).eq("id", c.id);
  return { id: made.id as string, title };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const ttb = Deno.env.get("ALADIN_TTB_KEY");
  if (!ttb) return reply({ error: "ALADIN_TTB_KEY 가 설정되지 않았습니다" }, 500);

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth) return reply({ error: "열쇠가 없습니다" }, 401);

  let body: { probe?: string; lookup?: string; limit?: number; book_id?: string; add_isbn?: string; isbn?: string; crate?: boolean; candidate_id?: string; query?: string } = {};
  try { body = await req.json(); } catch { /* 빈 몸통도 허용 */ }

  /* ── 궤짝 수동 검색 — 자동 확정(0.75)이 못 정한 후보를 사람이 살린다 ──
     사람이 글자를 고쳐 물었으므로 문턱을 0.5로 낮춘다. 그래도 서지는
     조회 API 로 완성해서 꽂는다 — 데이터가 더러워지는 길은 없다. */
  if (body.candidate_id && body.query) {
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: c, error: e0 } = await db.from("intake_candidates")
      .select("*, intake_photos(wall, shelf)")
      .eq("id", body.candidate_id).single();
    if (e0 || !c) return reply({ error: "후보를 찾지 못했습니다" }, 404);
    const q = String(body.query).trim();
    if (!q) return reply({ error: "검색어가 비었습니다" }, 400);

    let best = null, score = 0;
    const tries: Array<[string, string]> = [["Book", "Keyword"], ["Book", "Title"], ["Foreign", "Keyword"]];
    for (const [target, qt] of tries) {
      try {
        const r = await aladin(ttb, q, target, qt);
        const j = JSON.parse(r.text.replace(/;$/, ""));
        const p = pickBest(j.item ?? [], q);
        if (p.best && p.score > score) { best = p.best; score = p.score; }
        if (score >= 0.9) break;
      } catch { /* 다음 사다리로 */ }
    }
    if (!best || score < 0.5) {
      return reply({ 못정함: true, 말: "알라딘에서도 찾지 못했습니다 — 다른 표기로 적어 보세요" });
    }
    const r2 = await plantCandidate(db, ttb, c, best);
    if (r2.dup) return reply({ 겹침: true, 제목: r2.title });
    if (r2.fail) return reply({ error: "꽂지 못했습니다: " + r2.fail }, 500);
    return reply({ 확정: 1, 제목: r2.title, 점수: Math.round(score * 100) });
  }

  /* ── 궤짝을 알라딘에 묻는다 — 흐린 후보를 서지로 확정한다 ──
     확신이 낮아 궤짝에 담긴 책들: 글씨는 흐렸어도 책은 진짜다.
     읽어낸 글자로 알라딘을 검색해 강하게 일치하면(0.75 이상) 그 서지로
     꽂는다. 흐린 OCR + 알라딘 일치 = 사람이 하나씩 누르는 것보다 낫다.
     확정 못 하면 궤짝에 그대로 남는다 — 잃는 것이 없다. */
  if (body.crate) {
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const limit = Math.min(Number(body.limit ?? 20), 30);
    const { data: cands, error } = await db.from("intake_candidates")
      .select("*, intake_photos(wall, shelf)")
      .eq("status", "대기").order("created_at").limit(limit);
    if (error) return reply({ error: "궤짝을 읽지 못했습니다: " + error.message }, 500);
    if (!cands?.length) return reply({ 확정: 0, 겹침: 0, 못정함: 0, 남음: 0 });

    let ok = 0, dup = 0, skip = 0;
    const 확정목록: Array<Record<string, unknown>> = [];

    for (const c of cands) {
      const raw = String(c.raw_text ?? "").trim();
      if (!raw) { skip++; continue; }
      const guess = (c.candidates as Array<Record<string, unknown>> | null)?.[0] ?? {};
      const stripped = raw.replace(/[\s·-]+\d{1,3}$/, "").trim();

      let best = null, score = 0;
      const tries: Array<[string, string, string]> = [
        [[raw, guess.author].filter(Boolean).join(" "), "Book", "Keyword"],
        [stripped || raw, "Book", "Title"],
      ];
      for (const [q2, target, qt] of tries) {
        try {
          const r = await aladin(ttb, q2, target, qt);
          const j = JSON.parse(r.text.replace(/;$/, ""));
          const p = pickBest(j.item ?? [], raw);
          if (p.best && p.score > score) { best = p.best; score = p.score; }
          if (score >= 0.9) break;
        } catch { /* 다음 사다리로 */ }
      }
      if (!best || score < 0.75) { skip++; continue; }

      const r2 = await plantCandidate(db, ttb, c, best);
      if (r2.dup) { dup++; continue; }
      if (r2.fail) { skip++; continue; }
      ok++;
      확정목록.push({ 읽은것: raw, 알라딘: r2.title });
    }

    const { count } = await db.from("intake_candidates")
      .select("id", { count: "exact", head: true }).eq("status", "대기");
    return reply({ 확정: ok, 겹침: dup, 못정함: skip, 남음: count ?? 0, 확정목록 });
  }

  /* ── 서표의 ISBN 직접 조회 — 이미 꽂힌 책에 번호로 서지를 붙인다 ──
     제목 검색이 못 찾는 책의 마지막 길: 실물 뒤표지의 ISBN 을 사람이 적었다.
     번호가 곧 신원이므로 조회 결과를 그대로 채운다. 단, 제목은 여기서도
     갈아치우지 않는다 — 알라딘 제목을 알려만 주고 판단은 사람에게 남긴다. */
  if (body.book_id && body.isbn) {
    const isbn = String(body.isbn).replace(/[^0-9Xx]/g, "");
    if (isbn.length !== 13 && isbn.length !== 10) {
      return reply({ error: "ISBN 은 10자리나 13자리입니다: " + body.isbn }, 400);
    }
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const info = await lookupHard(ttb, isbn);
    if (!info?.title) {
      const down = await aladinDown(ttb);
      if (down) return reply({ error: "알라딘 API 가 지금 응답을 거부합니다 (" + down + ") — 하루 호출 한도(5,000건)를 다 썼으면 내일 다시 눌러 주세요. 번호는 저장해 두지 않으니 그대로 두면 됩니다" }, 429);
      return reply({ error: "알라딘·구글 도서 어디에도 없는 번호입니다 (" + isbn + ") — 번호를 다시 확인해 보세요" }, 404);
    }

    const patch: Record<string, unknown> = {
      isbn: info.isbn13 || isbn,
      enrich_tried_at: new Date().toISOString(),
    };
    if (info.pages) patch.page_count = info.pages;
    if (info.sizeHeight) patch.size_height = info.sizeHeight;
    if (info.sizeDepth) patch.size_depth = info.sizeDepth;
    if (info.publisher) patch.publisher = info.publisher;
    if (info.cover) patch.cover_url = info.cover;
    if (info.year) patch.published_year = info.year;
    if (info.category) patch.category = info.category;
    if (info.author) patch.author = info.author;   // 번호가 신원이다 — 지은이는 믿고 고친다

    const { error: e1 } = await db.from("books").update(patch).eq("id", body.book_id);
    if (e1) {
      // 다른 책이 이미 이 ISBN 을 갖고 있다 — 같은 책이 두 번 꽂힌 것이다
      if (e1.code === "23505") return reply({ 겹침: true, 제목: info.title });
      return reply({ error: "적지 못했습니다: " + e1.message }, 500);
    }
    return reply({ 채움: 1, 제목: info.title, 지은이: info.author, 쪽수: info.pages, 살펴볼것: [] });
  }

  /* ── 바코드 입고 — ISBN 하나로 책을 통째로 들인다 ──
     뒤표지 바코드(EAN-13)가 곧 ISBN13 이다. 조회해서 서지가 완성된 채로
     꽂는다. 벽은 DB 의 wall_for_category() 가 정한다 — 규칙을 또 만들지 않는다. */
  if (body.add_isbn) {
    const isbn = String(body.add_isbn).replace(/[^0-9Xx]/g, "");
    if (isbn.length !== 13 && isbn.length !== 10) {
      return reply({ error: "ISBN 이 아닙니다: " + body.add_isbn }, 400);
    }
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const info = await lookupHard(ttb, isbn);
    if (!info?.title) {
      const down = await aladinDown(ttb);
      if (down) return reply({ error: "알라딘 API 가 지금 응답을 거부합니다 (" + down + ") — 하루 호출 한도(5,000건)를 다 썼으면 내일 다시 시도해 주세요" }, 429);
      return reply({ error: "알라딘·구글 도서 모두에서 찾지 못했습니다 (" + isbn + ") — 작은 출판사 책은 없을 수 있습니다. 「사진에 없는 책은 손으로」로 꽂아 주세요" }, 404);
    }

    const category = info.category || "문학";
    const { data: wall } = await db.rpc("wall_for_category", { cat: category });
    const { error: e1 } = await db.from("books").insert({
      title: info.title,
      author: info.author,
      category,
      isbn: info.isbn13 || isbn,
      publisher: info.publisher,
      cover_url: info.cover,
      published_year: info.year,
      page_count: info.pages,
      size_height: info.sizeHeight,
      size_depth: info.sizeDepth,
      wall: wall || "문학",
      enrich_tried_at: new Date().toISOString(),
    });
    if (e1) {
      if (e1.code === "23505") return reply({ 겹침: true, 제목: info.title });
      return reply({ error: "꽂지 못했습니다: " + e1.message }, 500);
    }
    return reply({ 꽂음: true, 제목: info.title, 지은이: info.author, 쪽수: info.pages });
  }

  /* ── 조회 살펴보기 — ItemLookUp 응답 모양을 그대로 돌려준다 ──
     subInfo.itemPage 가 정말 오는지 실물로 확인할 때 쓴다. */
  if (body.lookup) {
    const params = new URLSearchParams({
      ttbkey: ttb, ItemId: body.lookup,
      ItemIdType: body.lookup.length === 13 ? "ISBN13" : "ISBN",
      output: "js", Version: "20131101",
    });
    const res = await fetch(`https://www.aladin.co.kr/ttb/api/ItemLookUp.aspx?${params}`);
    const text = await res.text();
    let shape: unknown = null;
    try {
      const j = JSON.parse(text.replace(/;$/, ""));
      shape = {
        첫항목열쇠: j.item?.[0] ? Object.keys(j.item[0]) : null,
        부가정보: j.item?.[0]?.subInfo ?? null,
        오류: j.errorMessage ?? null, 오류번호: j.errorCode ?? null,
      };
    } catch (e) {
      shape = { 파싱실패: String(e), 앞부분: text.slice(0, 500) };
    }
    return reply({ status: res.status, shape });
  }

  /* ── 살펴보기 모드 — 응답 모양을 그대로 돌려준다 ──
     실제 규격을 문서로 확인할 수 없어, 붙이기 전에 한 번 찍어본다. */
  if (body.probe) {
    const r = await aladin(ttb, body.probe);
    let shape: unknown = null;
    try {
      const j = JSON.parse(r.text.replace(/;$/, ""));
      shape = {
        위쪽열쇠: Object.keys(j),
        오류: j.errorMessage ?? null, 오류번호: j.errorCode ?? null,
        건수: j.totalResults,
        첫항목열쇠: j.item?.[0] ? Object.keys(j.item[0]) : null,
        첫항목: j.item?.[0] ?? null,
      };
    } catch (e) {
      shape = { 파싱실패: String(e), 앞부분: r.text.slice(0, 500) };
    }
    return reply({ status: r.status, shape });
  }

  /* ── 실제 채우기 ── */
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: auth } } },
  );

  const limit = Math.min(Number(body.limit ?? 20), 50);
  /* 빈 칸이 있고 아직 안 물어본 책만 고른다. 물어본 책에는 표식을 남겨
     알라딘이 모르는 책이 대기줄을 막지 않게 한다 — 표식이 없으면 자동
     반복이 같은 스무 권만 영원히 다시 묻는다.
     book_id 가 오면 그 한 권만 — 표식이 있어도 다시 묻는다 (서표의 단추). */
  let sel = db.from("books")
    .select("id, title, author, isbn, page_count, size_height, size_depth, publisher, cover_url, published_year");
  sel = body.book_id
    ? sel.eq("id", body.book_id)
    : sel.or("isbn.is.null,page_count.is.null,size_height.is.null")
        .is("enrich_tried_at", null)
        .order("created_at").limit(limit);
  const { data: books, error } = await sel;
  if (error) return reply({ error: "장서를 읽지 못했습니다: " + error.message }, 500);
  if (!books?.length) return reply({ 채움: 0, 남음: 0, 말: "채울 책이 없습니다" });

  /* 확실히 물어봤고 답이 없던 책에만 표식을 남긴다.
     통신이 잠깐 끊긴 것까지 표식하면 다시 물을 길이 없다. */
  const markTried = (id: string, extra: Record<string, unknown> = {}) =>
    db.from("books").update({ enrich_tried_at: new Date().toISOString(), ...extra }).eq("id", id);

  const changes: Array<Record<string, unknown>> = [];
  const suggests: Array<Record<string, unknown>> = [];
  let filled = 0, missed = 0, clashed = 0;

  for (const b of books) {
    /* ISBN 은 이미 아는 책 — 검색을 건너뛰고 조회로 빈 칸을 마저 채운다 */
    if (b.isbn) {
      const info = await aladinLookup(ttb, String(b.isbn));
      const extra: Record<string, unknown> = {};
      if (info?.pages) extra.page_count = info.pages;
      if (info?.sizeHeight) extra.size_height = info.sizeHeight;
      if (info?.sizeDepth) extra.size_depth = info.sizeDepth;
      if (info?.publisher && !b.publisher) extra.publisher = info.publisher;
      if (info?.cover && !b.cover_url) extra.cover_url = info.cover;
      if (info?.year && !b.published_year) extra.published_year = info.year;
      await markTried(b.id, extra);
      if (info) filled++; else missed++;
      continue;
    }

    /* 검색 사다리 — 한 번 못 찾았다고 포기하지 않는다.
       1) 국내도서, 제목+지은이 키워드
       2) 국내도서, 권수 뗀 제목만 (「13계단 029」→「13계단」)
       3) 외서 — ZERO K 나 High-Rise 는 국내도서 검색에 안 잡힌다
       4) 알라딘 웹사이트 검색 (ItemId 만 줍고 서지는 API 조회로) */
    const stripped = b.title.replace(/[\s·-]+\d{1,3}$/, "").trim();
    const ladder: Array<[string, string, string]> = [
      [[b.title, b.author].filter(Boolean).join(" "), "Book", "Keyword"],
      [stripped && stripped !== b.title ? stripped : b.title, "Book", "Title"],
      [[b.title, b.author].filter(Boolean).join(" "), "Foreign", "Keyword"],
    ];
    let found = null, score = 0, netFail = false;
    for (const [q2, target, qt] of ladder) {
      try {
        const r = await aladin(ttb, q2, target, qt);
        const j = JSON.parse(r.text.replace(/;$/, ""));
        const p = pickBest(j.item ?? [], b.title);
        if (p.best && p.score >= 0.5) { found = p.best; score = p.score; break; }
      } catch { netFail = true; }
    }

    /* API 가 끝내 모르면 사이트 검색 — 서지는 조회 API 가 준다 */
    let hit: Record<string, unknown> | null = null;
    if (found) {
      hit = {
        title: decode(String(found.title ?? "")).trim(),
        author: found.author ? decode(String(found.author)).split(/[,(]/)[0].trim() : null,
        isbn: found.isbn13 || found.isbn ? String(found.isbn13 || found.isbn) : null,
        publisher: found.publisher ? decode(String(found.publisher)) : null,
        cover: found.cover ? await bigCover(String(found.cover)) : null,
        year: /^\d{4}/.test(String(found.pubDate ?? "")) ? Number(String(found.pubDate).slice(0, 4)) : null,
        category: catOf(String(found.categoryName ?? "")),
        pages: null, sizeHeight: null, sizeDepth: null,
      };
      if (hit.isbn) {
        // 쪽수·크기는 조회 API 에만 있다 — ISBN 을 알았으니 한 번 더 묻는다
        const info = await aladinLookup(ttb, String(hit.isbn));
        if (info) { hit.pages = info.pages; hit.sizeHeight = info.sizeHeight; hit.sizeDepth = info.sizeDepth; }
      }
    } else {
      const web = await webFallback(ttb, stripped || b.title, b.author);
      if (web) {
        const i = web.info;
        hit = {
          title: i.title, author: i.author, isbn: i.isbn13,
          publisher: i.publisher, cover: i.cover, year: i.year,
          category: i.category, pages: i.pages,
          sizeHeight: i.sizeHeight, sizeDepth: i.sizeDepth,
        };
        score = web.score;
      }
    }

    if (!hit) {
      missed++;
      // 통신이 어긋났을 뿐이면 표식 없이 다음 차례를 기다린다
      if (!netFail) await markTried(b.id);
      continue;
    }

    const patch: Record<string, unknown> = {};
    if (hit.isbn) patch.isbn = hit.isbn;
    if (hit.pages) patch.page_count = hit.pages;
    if (hit.sizeHeight) patch.size_height = hit.sizeHeight;
    if (hit.sizeDepth) patch.size_depth = hit.sizeDepth;
    if (hit.publisher) patch.publisher = hit.publisher;
    if (hit.cover) patch.cover_url = hit.cover;
    if (hit.year) patch.published_year = hit.year;
    // 알라딘의 분류가 AI 의 짐작보다 정확하다 — 알아볼 수 있으면 바꿔 단다
    if (hit.category) patch.category = hit.category;

    /* 제목은 자동으로 갈아치우지 않는다.
       「죽음의 한 연구 상」을 검색하면 단권본 「죽음의 한 연구」가 잡힌다.
       닮았다고 고쳐 버리면 상·하 구분이 사라지고, 둘 다 같은 제목이 되어
       서로 부딪힌다. 잘못 읽힌 것 같으면 알려만 주고 판단은 사람에게 남긴다. */
    const aladinTitle = String(hit.title || "");
    const suggest = (score >= 0.72 && aladinTitle && norm(aladinTitle) !== norm(b.title))
      ? { 지금: b.title, 알라딘: aladinTitle } : null;

    // 지은이는 고친다 — 「박상룡」처럼 한 글자 틀린 것이 대부분이고,
    // 권 구분 같은 정보를 잃을 위험이 없다.
    let fixed = null;
    if (hit.author && score >= 0.72) {
      const a = String(hit.author);
      if (a && norm(a) !== norm(b.author || "")) {
        patch.author = a;
        fixed = { 제목: b.title, 지은이전: b.author || "(없음)", 지은이후: a };
      }
    }

    patch.enrich_tried_at = new Date().toISOString();
    const { error: e2 } = await db.from("books").update(patch).eq("id", b.id);
    if (e2) {
      // 고친 값이 이미 있는 책과 같아졌다 — 중복 색인이 막은 것이다.
      // 이 책은 몇 번을 물어도 같으니 표식만 남기고 넘어간다
      if (e2.code === "23505") { clashed++; await markTried(b.id); continue; }
      missed++;
      continue;
    }
    filled++;
    if (fixed) changes.push(fixed);
    if (suggest) suggests.push(suggest);
  }

  const { count } = await db.from("books")
    .select("id", { count: "exact", head: true })
    .or("isbn.is.null,page_count.is.null,size_height.is.null")
    .is("enrich_tried_at", null);

  return reply({
    채움: filled, 못찾음: missed, 겹침: clashed, 남음: count ?? 0,
    고침: changes, 살펴볼것: suggests,
  });
});
