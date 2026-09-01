/* 책등을 읽는다 — 책장 사진 한 장에서 여러 권을 알아본다
 *
 * 왜 브라우저가 아니라 여기서 하는가:
 *   Anthropic 키를 브라우저에 두면 누구나 가져다 쓴다. 키는 이 안에서만 산다.
 *
 * 누가 부를 수 있는가:
 *   로그인한 사람만(verify_jwt). 게다가 그 사람의 토큰으로 DB를 보므로
 *   RLS 가 그대로 적용된다 — 남의 사진을 넘겨도 조회되지 않는다.
 *   service_role 키는 쓰지 않는다. 쓰는 순간 이 함수가 모든 잠금을 지나간다.
 *
 * 확신이 서면 벽에 꽂고, 갈리면 궤짝에 담는다.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const MODEL = Deno.env.get("RECOGNIZE_MODEL") ?? "claude-sonnet-5";
// 이 선 위는 바로 꽂고, 아래는 궤짝으로 보낸다
const SURE = Number(Deno.env.get("RECOGNIZE_THRESHOLD") ?? "0.85");

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

/* 모델이 자유롭게 쓴 글을 파싱하는 것보다, 도구 모양을 정해 주고
   그 자리에 채워 넣게 하는 편이 훨씬 덜 깨진다. */
const TOOL = {
  name: "record_spines",
  description: "사진에서 알아본 책들을 왼쪽부터 차례대로 기록한다",
  input_schema: {
    type: "object",
    properties: {
      books: {
        type: "array",
        description: "왼쪽에서 오른쪽 순서. 글자가 보이지 않는 책은 넣지 않는다.",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "책등에 적힌 제목 그대로" },
            author: { type: "string", description: "보이지 않으면 빈 문자열" },
            volume: { type: "string", description: "전집의 권 번호. 없으면 빈 문자열" },
            category: {
              type: "string",
              enum: ["역사", "문학", "과학", "예술", "사회", "종교"],
              description: "제목으로 미루어 짐작한 분류",
            },
            spine_color: { type: "string", description: "책등 바탕색 (#RRGGBB)" },
            confidence: {
              type: "number",
              description: "0~1. 글자가 또렷하고 제목이 확실할수록 1에 가깝게.",
            },
            box: {
              type: "object",
              description:
                "이 책등이 사진에서 차지하는 자리. 사진 전체를 가로세로 0~1000 으로 보고, x·y 는 왼쪽 위 모서리, w·h 는 너비·높이.",
              properties: {
                x: { type: "number" },
                y: { type: "number" },
                w: { type: "number" },
                h: { type: "number" },
              },
              required: ["x", "y", "w", "h"],
            },
          },
          required: ["title", "author", "volume", "category", "spine_color", "confidence", "box"],
        },
      },
    },
    required: ["books"],
  },
};

const PROMPT = `이 사진은 개인 서재의 책장을 찍은 것입니다. 책등에 적힌 글자를 읽어 어떤 책들이 꽂혀 있는지 알아보세요.

지침:
- 왼쪽에서 오른쪽 순서로 기록합니다.
- 제목은 책등에 적힌 그대로 옮깁니다. 아는 책이라고 해서 정식 서명으로 고쳐 쓰지 마세요.
- 글자가 흐리거나 일부만 보이면 보이는 만큼만 적고 confidence 를 낮게 주세요.
- 전집이라면 권 번호를 volume 에 따로 적습니다. 제목에 이미 권 표시가 들어 있으면 volume 은 비워 둡니다.
- 책이 아닌 물건(액자, 소품 등)은 넣지 않습니다.
- 글자가 전혀 보이지 않는 책은 넣지 않습니다.
- 추측으로 지어내지 마세요. 확실하지 않으면 confidence 를 낮추는 것이 낫습니다.
- box 에는 그 책등 하나가 차지하는 자리를 적습니다 (0~1000 비율 좌표).
  옆 책이 섞이지 않게 그 책등만 타이트하게 잡되, 위아래는 책 전체 높이를 담습니다.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return reply({ error: "ANTHROPIC_API_KEY 가 설정되지 않았습니다 (Edge Functions 비밀값에 넣으세요)" }, 500);
  }

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth) return reply({ error: "열쇠가 없습니다" }, 401);

  let photo_id: string | undefined;
  try {
    ({ photo_id } = await req.json());
  } catch {
    return reply({ error: "photo_id 를 보내주세요" }, 400);
  }
  if (!photo_id) return reply({ error: "photo_id 를 보내주세요" }, 400);

  // 부른 사람의 토큰 그대로 — 이 함수는 그 사람이 볼 수 있는 것만 본다
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: auth } } },
  );

  const { data: photo, error: e1 } = await db
    .from("intake_photos").select("*").eq("id", photo_id).single();
  if (e1 || !photo) return reply({ error: "그런 사진이 없습니다" }, 404);

  const { data: file, error: e2 } = await db.storage.from("intake").download(photo.storage_path);
  if (e2 || !file) return reply({ error: "사진을 열지 못했습니다" }, 404);

  const bytes = new Uint8Array(await file.arrayBuffer());
  // btoa 는 한 번에 큰 배열을 못 받는다 — 조각내어 옮긴다
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  const b64 = btoa(bin);
  const mediaType = file.type && file.type.startsWith("image/") ? file.type : "image/jpeg";

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8000,
      tools: [TOOL],
      tool_choice: { type: "tool", name: "record_spines" },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } },
          { type: "text", text: PROMPT },
        ],
      }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    await db.from("intake_photos").update({ status: "실패", note: detail.slice(0, 400) }).eq("id", photo_id);
    return reply({ error: "책등을 읽지 못했습니다", detail: detail.slice(0, 400) }, 502);
  }

  const out = await res.json();
  const use = out.content?.find((c: { type: string }) => c.type === "tool_use");
  const books: Array<Record<string, unknown>> = use?.input?.books ?? [];

  /* 이미 꽂혀 있는 책은 다시 꽂지 않는다.
     DB 에도 같은 규칙의 유일 색인이 걸려 있어 어느 길로 들어와도 막히지만,
     여기서 먼저 걸러야 "이미 있음 12권" 처럼 사정을 말해줄 수 있다.
     열쇠 만드는 법은 DB 쪽 dedup_key 와 똑같아야 한다. */
  const keyOf = (t: string, a: string) =>
    `${t}|${a}`.toLowerCase().replace(/[^0-9a-z가-힣]/g, "");

  const { data: owned } = await db.from("books").select("id, title, author, wall, spine_box");
  const already = new Set((owned ?? []).map((b) => keyOf(b.title ?? "", b.author ?? "")));
  // 이미 꽂힌 책의 자리 소급용 — 열쇠로 id 와 자리 유무를 찾는다
  const ownedByKey = new Map(
    (owned ?? []).map((b) => [keyOf(b.title ?? "", b.author ?? ""), { id: b.id, hasBox: !!b.spine_box }]),
  );

  // 벽마다 몇 권이 있는지 세어 두면 새 책이 앉을 자리를 이어서 매길 수 있다
  const filled = new Map<string, number>();
  (owned ?? []).forEach((b) => {
    if (b.wall) filled.set(b.wall, (filled.get(b.wall) ?? 0) + 1);
  });

  const wallFor = (cat: string) =>
    cat === "역사" ? "역사"
    : cat === "과학" ? "과학"
    : (cat === "예술" || cat === "사회") ? "예술사회"
    : cat === "종교" ? "종교"
    : "문학";

  const shelved: Array<Record<string, unknown>> = [];
  const doubtful: Array<Record<string, unknown>> = [];
  const backfills: Array<{ id: string; box: Record<string, number> }> = [];
  let dup = 0;

  /* 모델이 준 자리 상자를 검사한다 — 0~1000 비율, 폭·높이가 말이 되는지 */
  const boxOf = (b: Record<string, unknown>) => {
    const raw = b.box as Record<string, unknown> | undefined;
    if (!raw) return null;
    const x = Number(raw.x), y = Number(raw.y), w = Number(raw.w), h = Number(raw.h);
    if (![x, y, w, h].every(Number.isFinite)) return null;
    if (w <= 0 || h <= 0 || x < 0 || y < 0 || x + w > 1000 || y + h > 1000) return null;
    return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
  };

  books.forEach((b) => {
    const title = String(b.title ?? "").trim();
    if (!title) return;
    const conf = Number(b.confidence ?? 0);
    const vol = String(b.volume ?? "").trim();
    /* 권 번호가 제목에 이미 들어 있으면 또 붙이지 않는다.
       AI 가 「죽음의 한 연구 상」을 읽고 volume 에도 "상"을 적어 주는 일이
       있어, 그대로 이으면 「죽음의 한 연구 상 상」이 된다 (실제로 세 권이
       그렇게 꽂혔다, 2026-09-01). */
    const volTail = vol
      ? new RegExp("(^|[\\s·-])" + vol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$").test(title)
      : false;
    const full = vol && !volTail ? `${title} ${vol}` : title;
    const author = String(b.author ?? "").trim();
    const cat = String(b.category ?? "문학");
    const box = boxOf(b);

    // 같은 사진 안에 두 번 나온 것도 한 번만 센다.
    // 이미 꽂힌 책이라면 — 자리 상자가 없을 때 소급해 채운다 (「다시 읽는다」의 보람)
    const key = keyOf(full, author);
    if (already.has(key)) {
      dup++;
      const prev = ownedByKey.get(key);
      if (prev && !prev.hasBox && box) backfills.push({ id: prev.id, box });
      return;
    }
    already.add(key);

    if (conf >= SURE) {
      // 사진에 적어 둔 자리가 있으면 그것이 우선이다 — 실제로 찍은 자리가 더 정확하다
      const wall = photo.wall || wallFor(cat);
      const n = filled.get(wall) ?? 0;
      filled.set(wall, n + 1);
      shelved.push({
        title: full,
        author: author || null,
        category: cat,
        spine_color: /^#[0-9a-fA-F]{6}$/.test(String(b.spine_color)) ? b.spine_color : null,
        wall,
        shelf: photo.shelf ?? Math.floor(n / 30) + 1,
        slot: (n % 30) + 1,
        spine_photo_id: photo_id,
        spine_box: box,
      });
    } else {
      doubtful.push({
        photo_id,
        raw_text: full,
        confidence: conf,
        candidates: [{ title: full, author, category: cat }],
        spine_box: box,
      });
    }
  });

  // 자리 소급 — 이미 꽂힌 책에 사진 속 자리를 붙인다
  for (const f of backfills) {
    await db.from("books")
      .update({ spine_photo_id: photo_id, spine_box: f.box })
      .eq("id", f.id).is("spine_box", null);
  }

  let put = 0;
  if (shelved.length) {
    const { data, error } = await db.from("books").insert(shelved).select("id");
    // 23505 = 유일 색인 위반. 앞에서 걸렀는데도 걸렸다면 다른 창에서 동시에
    // 넣은 것이다 — 실패가 아니라 이미 있다는 뜻이므로 그렇게 센다.
    if (error && error.code !== "23505") {
      return reply({ error: "꽂지 못했습니다: " + error.message }, 500);
    }
    if (error) dup += shelved.length;
    else put = data?.length ?? shelved.length;
  }
  /* 「다시 읽는다」를 안전하게 만든다 — 같은 사진의 아직 손대지 않은 후보는
     지우고 새로 담는다. 확정·버림은 사람이 내린 판단이므로 건드리지 않는다.
     이게 없으면 사진을 두 번 읽을 때마다 궤짝이 통째로 불어난다. */
  await db.from("intake_candidates")
    .delete().eq("photo_id", photo_id).eq("status", "대기");
  if (doubtful.length) {
    const { error } = await db.from("intake_candidates").insert(doubtful);
    if (error) return reply({ error: "궤짝에 담지 못했습니다: " + error.message }, 500);
  }
  await db.from("intake_photos").update({
    status: "완료",
    detected_count: books.length,
    note: `꽂음 ${put} · 궤짝 ${doubtful.length}${dup ? ` · 이미 있음 ${dup}` : ""}`,
  }).eq("id", photo_id);

  return reply({
    읽은권수: books.length,
    꽂음: put,
    궤짝: doubtful.length,
    이미있음: dup,
    책들: shelved.map((b) => b.title),
  });
});
