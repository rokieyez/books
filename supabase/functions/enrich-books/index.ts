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
  if (/사회|정치|경제|경영|법|교육|자기계발|인문학|철학|종교/.test(p)) return "사회";
  return null;   // 알아볼 수 없으면 원래 분류를 그대로 둔다
}

async function aladin(key: string, query: string) {
  const params = new URLSearchParams({
    ttbkey: key,
    Query: query,
    QueryType: "Keyword",
    MaxResults: "5",
    start: "1",
    SearchTarget: "Book",
    output: "js",
    Version: "20131101",
  });
  const url = `https://www.aladin.co.kr/ttb/api/ItemSearch.aspx?${params}`;
  const res = await fetch(url);
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const ttb = Deno.env.get("ALADIN_TTB_KEY");
  if (!ttb) return reply({ error: "ALADIN_TTB_KEY 가 설정되지 않았습니다" }, 500);

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth) return reply({ error: "열쇠가 없습니다" }, 401);

  let body: { probe?: string; limit?: number } = {};
  try { body = await req.json(); } catch { /* 빈 몸통도 허용 */ }

  /* ── 살펴보기 모드 — 응답 모양을 그대로 돌려준다 ──
     실제 규격을 문서로 확인할 수 없어, 붙이기 전에 한 번 찍어본다. */
  if (body.probe) {
    const r = await aladin(ttb, body.probe);
    let shape: unknown = null;
    try {
      const j = JSON.parse(r.text.replace(/;$/, ""));
      shape = {
        위쪽열쇠: Object.keys(j),
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
  const { data: books, error } = await db
    .from("books").select("id, title, author, isbn")
    .is("isbn", null).order("created_at").limit(limit);
  if (error) return reply({ error: "장서를 읽지 못했습니다: " + error.message }, 500);
  if (!books?.length) return reply({ 채움: 0, 남음: 0, 말: "채울 책이 없습니다" });

  const changes: Array<Record<string, unknown>> = [];
  const suggests: Array<Record<string, unknown>> = [];
  let filled = 0, missed = 0, clashed = 0;

  for (const b of books) {
    const q = [b.title, b.author].filter(Boolean).join(" ");
    let found;
    try {
      const r = await aladin(ttb, q);
      const j = JSON.parse(r.text.replace(/;$/, ""));
      found = (j.item ?? [])[0];
    } catch {
      missed++;
      continue;
    }
    if (!found) { missed++; continue; }

    const sim = similar(b.title, String(found.title ?? ""));
    // 전혀 다른 책이 잡힌 것이다 — 건드리지 않는다
    if (sim < 0.5) { missed++; continue; }

    const patch: Record<string, unknown> = {};
    if (found.isbn13 || found.isbn) patch.isbn = String(found.isbn13 || found.isbn);
    if (found.publisher) patch.publisher = decode(String(found.publisher));
    if (found.cover) patch.cover_url = String(found.cover);
    const yr = String(found.pubDate ?? "").slice(0, 4);
    if (/^\d{4}$/.test(yr)) patch.published_year = Number(yr);

    // 알라딘의 분류가 AI 의 짐작보다 정확하다 — 알아볼 수 있으면 바꿔 단다
    const cat = catOf(String(found.categoryName ?? ""));
    if (cat) patch.category = cat;

    /* 제목은 자동으로 갈아치우지 않는다.
       「죽음의 한 연구 상」을 검색하면 단권본 「죽음의 한 연구」가 잡힌다.
       닮았다고 고쳐 버리면 상·하 구분이 사라지고, 둘 다 같은 제목이 되어
       서로 부딪힌다. 잘못 읽힌 것 같으면 알려만 주고 판단은 사람에게 남긴다. */
    const aladinTitle = decode(String(found.title ?? "")).trim();
    const suggest = (sim >= 0.72 && sim < 1 && aladinTitle && norm(aladinTitle) !== norm(b.title))
      ? { 지금: b.title, 알라딘: aladinTitle } : null;

    // 지은이는 고친다 — 「박상룡」처럼 한 글자 틀린 것이 대부분이고,
    // 권 구분 같은 정보를 잃을 위험이 없다.
    let fixed = null;
    if (found.author && sim >= 0.72) {
      const a = decode(String(found.author)).split(/[,(]/)[0].trim();
      if (a && norm(a) !== norm(b.author || "")) {
        patch.author = a;
        fixed = { 제목: b.title, 지은이전: b.author || "(없음)", 지은이후: a };
      }
    }

    const { error: e2 } = await db.from("books").update(patch).eq("id", b.id);
    if (e2) {
      // 고친 제목이 이미 있는 책과 같아졌다 — 중복 색인이 막은 것이다
      if (e2.code === "23505") { clashed++; continue; }
      missed++;
      continue;
    }
    filled++;
    if (fixed) changes.push(fixed);
    if (suggest) suggests.push(suggest);
  }

  const { count } = await db.from("books")
    .select("id", { count: "exact", head: true }).is("isbn", null);

  return reply({
    채움: filled, 못찾음: missed, 겹침: clashed, 남음: count ?? 0,
    고침: changes, 살펴볼것: suggests,
  });
});
