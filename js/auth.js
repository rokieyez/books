/* 열쇠 — 로그인과 세션
 *
 * 메일 링크만 쓰면 사이트 주소가 바뀔 때마다(로컬 ↔ 배포) 링크가 엉뚱한 데로 간다.
 * 그래서 링크와 6자리 코드를 둘 다 받는다. 코드는 리디렉션이 없어 어디서든 통한다.
 */
(function () {
  const db = window.PostLibrosDB;
  const el = (id) => document.getElementById(id);

  /* ── 화면 조각 ── */
  const keyBtn = document.createElement("button");
  keyBtn.className = "keybtn";
  keyBtn.id = "keybtn";
  keyBtn.textContent = "열쇠";
  keyBtn.title = "이 서재의 주인이라면 열쇠를 청하세요";

  const gate = document.createElement("div");
  gate.className = "gate";
  gate.id = "gate";
  gate.hidden = true;
  gate.setAttribute("role", "dialog");
  gate.setAttribute("aria-label", "열쇠를 청한다");
  gate.innerHTML = `
    <button class="close" id="gate-close" aria-label="닫기">×</button>
    <span class="mark">Clavis</span>
    <h3>주인의 열쇠</h3>
    <p class="gate-sub" id="gate-sub">이 서재는 한 사람만 씁니다 — 새로 드는 문은 없습니다.<br>등록된 주인의 메일로 열쇠를 보냅니다. 메일 속 링크를 누르면 열립니다.</p>
    <form id="gate-form-mail" autocomplete="on">
      <input type="email" id="gate-email" placeholder="주인의 메일 주소" aria-label="주인의 메일 주소" required autocomplete="email">
      <button type="submit" class="gate-go" id="gate-send">열쇠를 보낸다</button>
    </form>
    <p class="gate-alt" id="gate-alt" hidden>링크가 열리지 않을 때만 — 메일에 여섯 자리가 함께 왔다면 여기 적으세요</p>
    <form id="gate-form-code" hidden autocomplete="off">
      <input type="text" id="gate-code" placeholder="여섯 자리" aria-label="메일로 받은 여섯 자리 코드"
             inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code">
      <button type="submit" class="gate-go" id="gate-verify">문을 연다</button>
    </form>
    <p class="gate-msg" id="gate-msg" hidden></p>`;

  const veil = el("veil");
  let pendingEmail = "";

  function openGate() {
    gate.hidden = false;
    veil.classList.add("show");
    setTimeout(() => el("gate-email").focus(), 60);
  }
  function closeGate() {
    gate.hidden = true;
    veil.classList.remove("show");
  }
  function say(text, tone) {
    const m = el("gate-msg");
    m.hidden = false;
    m.textContent = text;
    m.className = "gate-msg" + (tone ? " " + tone : "");
  }

  /* ── 서재를 표본에서 진짜 장서로 바꾼다 ── */
  async function loadRealLibrary() {
    const books = await db.listBooks({ limit: 2000 });
    const byWall = {
      "역사": [], "문학": [], "과학": [], "예술사회": [],
    };
    books.forEach((b) => {
      const key = (b.category === "예술" || b.category === "사회") ? "예술사회" : b.category;
      (byWall[key] || byWall["문학"]).push(shapeForShelf(b));
    });

    WALLS.forEach((w) => {
      if (w.cat === "archive") return;
      const shelf = byWall[w.cat] || [];
      w.books = shelf;
      w.n = shelf.length;
      w.read = shelf.length
        ? Math.round(shelf.filter((x) => x.st === "읽음").length / shelf.length * 100)
        : 0;
      w.featured = shelf.slice(0, 10);
      w.latchIdx = shelf.length ? Math.min(28, shelf.length - 1) : -1;
    });

    renderWalls();
    return books.length;
  }

  /* 책등의 크기와 색은 DB 에 없다 — 제목에서 결정적으로 만들어 항상 같은 모습이 되게 한다 */
  const CLOTH = ["#5C3A22", "#6E2A1E", "#2E4630", "#28323E", "#4A2E3A", "#77522A", "#3A3A30"];
  function shapeForShelf(b) {
    let h = 0;
    for (let i = 0; i < b.title.length; i++) h = (h * 31 + b.title.charCodeAt(i)) >>> 0;
    return {
      id: b.id,
      t: b.title,
      a: b.author || "지은이 미상",
      cat: b.category || "문학",
      c: b.spine_color || CLOTH[h % CLOTH.length],
      h: 78 + (h % 40),
      w2: 17 + ((h >> 5) % 9),
      year: b.acquired_on ? Number(b.acquired_on.slice(0, 4)) : null,
      st: b.read_status,
      loc: [b.wall, b.shelf ? b.shelf + "단" : null].filter(Boolean).join(" ") || "자리 미정",
      paper: (h >> 9) % 6 === 0,
      lean: (h >> 12) % 19 === 0,
      folio: (h >> 15) % 12 === 0,
    };
  }

  /* ── 세션 상태를 화면에 반영 ── */
  async function reflect(user) {
    const mark = document.querySelector(".topbar .mark");
    if (user) {
      keyBtn.textContent = "나간다";
      keyBtn.title = user.email + " 로 들어와 있습니다";
      keyBtn.classList.add("in");
      document.body.classList.add("owner");
      try {
        const n = await loadRealLibrary();
        say("", "");
        closeGate();
        if (n === 0) {
          mark.setAttribute("title", "아직 꽂힌 책이 없습니다 — 궤짝에 책을 넣어 시작하세요");
        }
      } catch (err) {
        console.error("[서재] 장서를 불러오지 못했습니다:", err);
      }
    } else {
      keyBtn.textContent = "열쇠";
      keyBtn.classList.remove("in");
      document.body.classList.remove("owner");
    }
  }

  /* ── 붙이기 ── */
  function mount() {
    const bar = document.querySelector(".topbar .inner");
    if (!bar) return;
    bar.appendChild(keyBtn);
    document.body.appendChild(gate);

    keyBtn.addEventListener("click", async () => {
      const user = db ? await db.currentUser() : null;
      if (user) {
        await db.signOut();
        location.reload();
      } else if (db) {
        openGate();
      } else {
        say("Supabase 연결이 없어 지금은 들어갈 수 없습니다.", "bad");
      }
    });
    el("gate-close").addEventListener("click", closeGate);
    veil.addEventListener("click", closeGate);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !gate.hidden) closeGate();
    });

    el("gate-form-mail").addEventListener("submit", async (e) => {
      e.preventDefault();
      pendingEmail = el("gate-email").value.trim();
      el("gate-send").disabled = true;
      say("열쇠를 보내는 중…");
      const { error } = await db.signIn(pendingEmail);
      el("gate-send").disabled = false;
      if (error) {
        // 등록되지 않은 주소면 Supabase 가 가입 거절로 답한다 — 이 서재의 주인이 아니라는 뜻이다
        const notOwner = error.code === "otp_disabled" ||
          /signup|not allowed|disabled/i.test(error.message || "");
        say(notOwner
          ? "이 서재의 주인이 아닙니다 — 열쇠는 등록된 주소로만 갑니다."
          : "열쇠를 보내지 못했습니다: " + error.message, "bad");
        return;
      }
      // 메일 폼은 남겨 둔다 — 안 오면 다시 보내야 한다
      el("gate-alt").hidden = false;
      el("gate-form-code").hidden = false;
      say(pendingEmail + " 으로 보냈습니다. 메일 속 링크를 누르면 열립니다.", "good");
    });

    el("gate-form-code").addEventListener("submit", async (e) => {
      e.preventDefault();
      const token = el("gate-code").value.trim();
      el("gate-verify").disabled = true;
      say("문을 여는 중…");
      const { error } = await db.client.auth.verifyOtp({
        email: pendingEmail, token, type: "email",
      });
      el("gate-verify").disabled = false;
      if (error) {
        say("맞지 않는 코드입니다. 메일에 온 여섯 자리를 다시 확인하세요.", "bad");
        return;
      }
      // 세션이 생기면 onAuthStateChange 가 화면을 바꾼다
    });

    if (!db) return;
    db.client.auth.onAuthStateChange((_evt, session) => reflect(session?.user ?? null));
    db.currentUser().then(reflect);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
