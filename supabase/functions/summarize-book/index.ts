/* 책 한 권의 기록을 짓는다 — 열어본 책에만
 *
 * 미리 만들어 두지 않는다. 1,300권을 미리 요약하면 대부분 읽히지 않을 글에
 * 돈을 쓰게 된다. 처음 펼치는 순간에만 짓고, 그 뒤로는 저장된 것을 읽는다.
 *
 * 이미 있으면 다시 짓지 않는다 — 화면에서 두 번 눌러도 한 번만 든다.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const MODEL = Deno.env.get("SUMMARIZE_MODEL") ?? "claude-sonnet-5";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return reply({ error: "ANTHROPIC_API_KEY 가 설정되지 않았습니다" }, 500);

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth) return reply({ error: "열쇠가 없습니다" }, 401);

  let book_id: string | undefined;
  try {
    ({ book_id } = await req.json());
  } catch {
    return reply({ error: "book_id 를 보내주세요" }, 400);
  }
  if (!book_id) return reply({ error: "book_id 를 보내주세요" }, 400);

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: auth } } },
  );

  const { data: book, error: e1 } = await db
    .from("books").select("id, title, author, publisher, published_year, category, isbn, page_count")
    .eq("id", book_id).single();
  if (e1 || !book) return reply({ error: "그런 책이 없습니다" }, 404);

  // 이미 지어 둔 기록이 있으면 그것을 준다 — 돈이 두 번 들지 않게
  const { data: had } = await db
    .from("book_summaries").select("summary, model, generated_at")
    .eq("book_id", book_id).maybeSingle();
  if (had) return reply({ ...had, 새로지음: false });

  // ISBN·쪽수까지 주면 어느 판본인지 못박힌다 — 동명이서를 헷갈리지 않게
  const who = [book.author, book.publisher].filter(Boolean).join(" · ");
  const facts = [
    book.published_year ? `${book.published_year}년` : null,
    book.page_count ? `${book.page_count}쪽` : null,
    book.isbn ? `ISBN ${book.isbn}` : null,
  ].filter(Boolean).join(" · ");
  const prompt = `「${book.title}」${who ? ` (${who})` : ""}${facts ? ` — ${facts}` : ""}

이 책을 아직 읽지 않은 서재 주인에게 소개하는 짧은 글을 써주세요.

- 세 문단 안팎, 전체 400자 내외의 한국어.
- 무슨 책인지, 무엇을 다루는지, 어떤 사람이 읽으면 좋을지.
- 줄거리를 끝까지 밝히지 마세요. 결말은 남겨 둡니다.
- 과장된 광고 문구를 쓰지 마세요. 차분하게 씁니다.
- **이 책을 정확히 알지 못한다면, 아는 척하지 말고 첫 줄에
  "이 책은 확실히 알지 못합니다."라고 적고 제목에서 짐작되는 바만 조심스럽게 적으세요.**
  지어낸 줄거리는 없느니만 못합니다.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1200,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    return reply({ error: "기록을 짓지 못했습니다", detail: detail.slice(0, 300) }, 502);
  }

  const out = await res.json();
  const summary = (out.content ?? [])
    .filter((c: { type: string }) => c.type === "text")
    .map((c: { text: string }) => c.text).join("\n").trim();

  if (!summary) return reply({ error: "빈 기록이 돌아왔습니다" }, 502);

  // 같은 순간에 두 번 눌렸다면 먼저 들어간 것을 남긴다
  const { error: e2 } = await db.from("book_summaries")
    .upsert({ book_id, summary, model: MODEL }, { onConflict: "book_id", ignoreDuplicates: true });
  if (e2) return reply({ error: "기록을 남기지 못했습니다: " + e2.message }, 500);

  return reply({ summary, model: MODEL, generated_at: new Date().toISOString(), 새로지음: true });
});
