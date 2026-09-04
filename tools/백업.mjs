/* 집을 통째로 밖에 내어 둔다 — rokiz.net 의 백업
 *
 * 왜 필요한가:
 *   글과 코드는 GitHub 에 두 벌로 있다. 없는 것은 **장서 자체**다 —
 *   544권과 기록·요약·이음은 오로지 Supabase 안에만 산다. 매일 04:17 에
 *   `backup_snapshots` 로 스냅샷이 뜨지만 그것도 같은 집 안이다.
 *   Supabase 가 잠들거나 지워지면 스냅샷도 함께 사라진다.
 *   백업은 **다른 집으로 나가야** 백업이다.
 *
 * 무엇을 담나:
 *   db/       공개로 읽히는 표 전부를 JSON 그대로 (books·notes·기록·요약·이음)
 *   장서.csv  사람이 표계산으로 열어 볼 수 있는 한 벌 (표계산이 UTF-8 을
 *             알아보도록 BOM 을 붙인다 — 없으면 엑셀에서 한글이 깨진다)
 *   git/      두 저장소의 번들 — 히스토리까지 한 파일에 담긴다.
 *             되살리기: git clone <이름>.bundle <폴더>
 *   적바림.md  이 백업이 무엇을 담고 무엇을 못 담았는지
 *
 * 무엇을 못 담나 (공개 열쇠로는 닿지 않는다 — RLS 가 주인만 내준다):
 *   intake_photos · intake_candidates · backup_snapshots · intake 버킷의 사진
 *   → 주인이 로그인한 채로 받아야 한다. 자세한 것은 적바림.md 에 적힌다.
 *
 * 쓰는 법:
 *   node tools/백업.mjs              백업/<날짜>/ 에 담는다
 *   node tools/백업.mjs --곳 <경로>   다른 곳에 담는다 (바깥 디스크로 옮길 때)
 *
 * 담은 곳은 .gitignore 에 걸려 있다 — 백업을 공개 저장소에 밀어 올리지 않는다.
 */
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const 돌리기 = promisify(execFile);
const 뿌리 = join(dirname(fileURLToPath(import.meta.url)), "..");
const 집 = join(뿌리, "..", "rokieyez.github.io");

/* 접속 정보는 js/config.js 한 곳에서만 읽는다 — 값을 두 곳에 적지 않는다 */
const 설정 = await (async () => {
  const 글 = await readFile(join(뿌리, "js/config.js"), "utf8");
  const url = /supabaseUrl:\s*"([^"]+)"/.exec(글)?.[1];
  const key = /supabaseKey:\s*"([^"]+)"/.exec(글)?.[1];
  if (!url || !key) throw new Error("js/config.js 에서 접속 정보를 읽지 못했습니다");
  return { url, key };
})();

const 오늘 = new Date();
const 날짜 = new Date(오늘.getTime() - 오늘.getTimezoneOffset() * 60000)
  .toISOString().slice(0, 19).replace("T", " ");
const 폴더이름 = 날짜.slice(0, 10);

const 곳자리 = process.argv.indexOf("--곳");
const 곳 = 곳자리 > -1 && process.argv[곳자리 + 1]
  ? resolve(process.argv[곳자리 + 1])
  : join(뿌리, "백업", 폴더이름);

await mkdir(join(곳, "db"), { recursive: true });
await mkdir(join(곳, "git"), { recursive: true });

/* ── 표를 통째로 받는다 ──────────────────────────────────────────
   PostgREST 는 한 번에 돌려주는 줄 수에 상한(1,000)이 있다. `.limit(2000)`
   이라 적어도 조용히 잘리므로, 상한을 짐작하지 않고 한 쪽씩 끝까지 읽는다 —
   서재가 커져도 이 도구는 그대로 산다. (js/db.js 의 listBooks 와 같은 규칙) */
const 머리 = { apikey: 설정.key, Authorization: `Bearer ${설정.key}` };

async function 표받기(이름, 차례) {
  const 쪽 = 500;
  const 모두 = [];
  for (let 부터 = 0; ; 부터 += 쪽) {
    const r = await fetch(`${설정.url}/rest/v1/${이름}?select=*&order=${차례}`, {
      headers: { ...머리, Range: `${부터}-${부터 + 쪽 - 1}` },
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new Error(`${이름} — ${r.status} ${await r.text()}`);
    const 온것 = await r.json();
    모두.push(...온것);
    if (온것.length < 쪽) break;
  }
  return 모두;
}

/* 공개로 읽히는 표 — RLS 의 select 가 anon 도 통과시키는 것들.
   여기 없는 표는 주인만 볼 수 있어 이 도구가 닿지 못한다 (적바림에 적는다).
   차례는 **그 표의 기본키**다 — 쪽을 나눠 읽으려면 흔들리지 않는 차례가
   있어야 한다. 모든 표가 id 를 갖지는 않는다: book_summaries 는 book_id 가,
   archive_book_links 는 두 칸이 함께 기본키다 (id 로 적었다가 400 을 받았다). */
const 공개표 = [
  ["books", "id"],
  ["notes", "id"],
  ["archive_items", "id"],
  ["book_summaries", "book_id"],
  ["book_links", "id"],
  ["archive_book_links", "archive_item_id,book_id"],
];

const 담은것 = [];
for (const [이름, 차례] of 공개표) {
  try {
    const 줄 = await 표받기(이름, 차례);
    const 글 = JSON.stringify(줄, null, 2);
    await writeFile(join(곳, "db", `${이름}.json`), 글, "utf8");
    담은것.push({ 이름, 줄수: 줄.length, 바이트: Buffer.byteLength(글) });
    console.log(`  ${이름.padEnd(20)} ${String(줄.length).padStart(5)}줄`);
  } catch (e) {
    담은것.push({ 이름, 줄수: null, 탈: e.message });
    console.log(`  ${이름.padEnd(20)} 받지 못했습니다 — ${e.message}`);
  }
}

/* ── 사람이 열어 볼 한 벌 ──────────────────────────────────────── */
const 장서 = JSON.parse(await readFile(join(곳, "db", "books.json"), "utf8"));
const 칸 = ["title", "author", "category", "genre", "publisher", "published_year",
  "isbn", "page_count", "read_status", "read_year", "acquired_on",
  "wall", "shelf", "slot", "series", "memo", "cover_url", "id"];
const 셀 = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
// BOM — 이것이 없으면 엑셀이 UTF-8 을 못 알아보고 한글이 깨진다
const csv = "﻿" + [칸.join(","), ...장서.map((b) => 칸.map((k) => 셀(b[k])).join(","))].join("\n");
await writeFile(join(곳, "장서.csv"), csv, "utf8");
console.log(`  장서.csv             ${장서.length}줄`);

/* ── 저장소 둘을 통째로 ────────────────────────────────────────────
   번들 하나에 히스토리가 다 들어간다. GitHub 이 사라져도 여기서 되살린다. */
const 번들 = [];
for (const [이름, 자리] of [["서재-post-libros", 뿌리], ["집-rokieyez.github.io", 집]]) {
  try {
    const 길 = join(곳, "git", `${이름}.bundle`);
    await 돌리기("git", ["-C", 자리, "bundle", "create", 길, "--all"]);
    const { stdout } = await 돌리기("git", ["-C", 자리, "rev-parse", "--short", "HEAD"]);
    const 크기 = (await import("node:fs/promises")).stat
      ? (await (await import("node:fs/promises")).stat(길)).size : 0;
    번들.push({ 이름, 머리: stdout.trim(), 크기 });
    console.log(`  ${이름.padEnd(24)} ${(크기 / 1048576).toFixed(1)}MB (${stdout.trim()})`);
  } catch (e) {
    번들.push({ 이름, 탈: e.message });
    console.log(`  ${이름.padEnd(24)} 묶지 못했습니다 — ${e.message}`);
  }
}

/* ── 적바림 ─────────────────────────────────────────────────────── */
const 적바림 = `# rokiz.net 백업 — ${날짜}

\`node tools/백업.mjs\` 가 지었습니다. 이 폴더는 \`.gitignore\` 에 걸려 있습니다
— 백업을 공개 저장소에 밀어 올리지 않습니다.

## 담긴 것

| 무엇 | 줄수 |
|---|---|
${담은것.map((t) => `| \`db/${t.이름}.json\` | ${t.줄수 ?? `**받지 못함** — ${t.탈}`} |`).join("\n")}
| \`장서.csv\` | ${장서.length} (표계산으로 열어 보는 한 벌) |
${번들.map((b) => `| \`git/${b.이름}.bundle\` | ${b.탈 ? `**묶지 못함** — ${b.탈}` : `${(b.크기 / 1048576).toFixed(1)}MB · ${b.머리}`} |`).join("\n")}

## 담기지 못한 것

공개 열쇠로는 닿지 않습니다 — RLS 가 주인에게만 내줍니다. 이 도구는 열쇠를
갖지 않으므로(가지면 저장소에 비밀이 들어옵니다) 아래는 주인이 로그인한 채로
받아야 합니다.

| 무엇 | 어떻게 받나 |
|---|---|
| \`intake_photos\` · \`intake_candidates\` | 사진과 궤짝의 내력. Supabase 대시보드 → Table Editor → CSV 내려받기 |
| \`backup_snapshots\` | 장서의 날짜별 스냅샷. **\`books\` 가 여기 담겼으니 겹칩니다** — 지난 30일의 변화를 되짚을 때만 필요합니다 |
| intake 버킷의 책장 사진 | 서재의 작업대(주인 로그인) 또는 대시보드 → Storage → intake |

## 되살리는 법

**저장소** — 번들 하나가 곧 저장소입니다.

\`\`\`bash
git clone git/서재-post-libros.bundle post-libros
git clone git/집-rokieyez.github.io.bundle rokieyez.github.io
\`\`\`

**장서** — \`db/books.json\` 을 그대로 되넣습니다. \`id\` 가 있으므로 이음
(\`book_links\`)과 요약(\`book_summaries\`)도 그대로 붙습니다. 되넣는 순서는
\`books\` → \`book_summaries\` → \`book_links\` → \`archive_items\` 입니다
(뒤의 것들이 앞의 \`id\` 를 가리킵니다).

서재의 작업대에는 CSV 를 되들이는 자리가 이미 있습니다 —
「목록을 되들인다」에 \`장서.csv\` 를 물리면 \`id\` 가 맞는 책을 그대로 고칩니다.
아주 빈 서재에 처음부터 채울 때는 \`db/books.json\` 쪽이 곧습니다
(CSV 는 칸을 골라 담았고, JSON 은 표 그대로입니다).
`;
await writeFile(join(곳, "적바림.md"), 적바림, "utf8");

console.log(`\n집을 밖에 내어 두었습니다 → ${곳}`);
console.log("담기지 못한 것(주인만 볼 수 있는 표·사진)은 적바림.md 에 적혀 있습니다.");
