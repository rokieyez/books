/* 열쇠 — 로그인과 세션
 *
 * 평소에는 비밀번호로 들어온다. 메일함을 열 필요가 없다.
 *
 * 메일 링크는 지우지 말 것 — 예비 수단이다. 신규 가입을 잠가 두었기 때문에
 * 비밀번호를 잊으면 다시 만들 길이 없고, 그때 들어올 유일한 문이 이것이다.
 * 비밀번호는 들어와 있는 동안에만 정할 수 있으므로 처음 한 번도 이 문을 쓴다.
 *
 * 문은 셋 중 하나를 보여준다: 로그인 / 메일 보낸 뒤 / 들어와 있음.
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
    <p class="gate-sub" id="gate-sub">이 서재는 한 사람만 씁니다 — 새로 드는 문은 없습니다.</p>

    <form id="gate-form-pw" class="pwform" autocomplete="on">
      <input type="email" id="gate-email" placeholder="주인의 메일 주소" aria-label="주인의 메일 주소" required autocomplete="email">
      <input type="password" id="gate-pw" placeholder="비밀번호" aria-label="비밀번호" autocomplete="current-password">
      <button type="submit" class="gate-go" id="gate-in">들어간다</button>
    </form>

    <p class="gate-alt" id="gate-ask">비밀번호를 아직 정하지 않았거나 잊었다면 —
      <button type="button" class="linkish" id="gate-usemail">메일로 열쇠를 받는다</button></p>

    <p class="gate-alt" id="gate-alt-code" hidden>링크가 열리지 않을 때만 — 메일에 여섯 자리가 함께 왔다면 여기 적으세요</p>
    <form id="gate-form-code" hidden autocomplete="off">
      <input type="text" id="gate-code" placeholder="여섯 자리" aria-label="메일로 받은 여섯 자리 코드"
             inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code">
      <button type="submit" class="gate-go" id="gate-verify">문을 연다</button>
    </form>

    <div id="gate-account" hidden>
      <p class="gate-who" id="gate-who"></p>
      <form id="gate-form-newpw" class="pwform" autocomplete="on">
        <input type="password" id="gate-newpw" placeholder="새 비밀번호 (8자 이상)" aria-label="새 비밀번호"
               autocomplete="new-password" minlength="8">
        <button type="submit" class="gate-go" id="gate-setpw">이 비밀번호로 정한다</button>
      </form>
      <p class="gate-alt">이제부터 메일함을 열지 않고 이 비밀번호로 들어옵니다.</p>
      <button type="button" class="gate-out" id="gate-out">나간다</button>
    </div>

    <p class="gate-msg" id="gate-msg" hidden></p>`;

  const veil = el("veil");
  let pendingEmail = "";
  /* 지금 들어와 있는 사람. onAuthStateChange 가 갱신한다.
     단추를 누를 때마다 서버에 물으면, 그 요청이 늦거나 실패할 때
     아무 일도 일어나지 않고 이유도 보이지 않는다 — 그래서 기억해 둔다. */
  let sessionUser = null;

  /* 문이 보여줄 세 가지 모습 */
  function showState(state) {
    const login = state === "login";
    const mailed = state === "mailed";
    const inside = state === "inside";

    el("gate-sub").hidden = inside;
    el("gate-form-pw").hidden = !login && !mailed;
    el("gate-ask").hidden = !login;
    el("gate-alt-code").hidden = !mailed;
    el("gate-form-code").hidden = !mailed;
    el("gate-account").hidden = !inside;
    gate.querySelector("h3").textContent = inside ? "들어와 있습니다" : "주인의 열쇠";
  }

  function openGate(state) {
    showState(state);
    gate.hidden = false;
    veil.classList.add("show");
    const first = state === "inside" ? "gate-newpw" : "gate-email";
    setTimeout(() => el(first).focus(), 60);
  }
  function closeGate() {
    gate.hidden = true;
    veil.classList.remove("show");
    el("gate-msg").hidden = true;
  }
  function say(text, tone) {
    const m = el("gate-msg");
    m.hidden = false;
    m.textContent = text;
    m.className = "gate-msg" + (tone ? " " + tone : "");
  }

  /* ── 서재를 표본에서 진짜 장서로 바꾼다 ── */
  async function loadRealLibrary() {
    // 쪽 단위로 끝까지 읽는다 — 상한은 db.js 의 기본값(5,000)에 맡긴다
    const books = await db.listBooks();

    // 실물 책등 조각의 서명 주소 — 비공개 버킷이라 한 번에 받아 둔다
    let spineSigned = new Map();
    try {
      spineSigned = await db.signSpineUrls(books.map((b) => b.spine_url).filter(Boolean));
    } catch (e) { console.error("[서재] 책등 조각 주소를 받지 못했습니다:", e); }

    const byWall = {
      "역사": [], "문학": [], "과학": [], "예술사회": [], "종교": [],
    };
    const WALL_OF = {
      역사: "역사", 문학: "문학", 과학: "과학", 종교: "종교",
      예술: "예술사회", 사회: "예술사회", 인문: "예술사회", 철학: "예술사회",
    };
    books.forEach((b) => {
      // 자리(wall)를 적어 두었으면 그것이 우선이다 — 서표에서 옮긴 자리가
      // 화면에도 보여야 한다. 없으면 분류가 벽을 정한다 (원래 규칙).
      // 분류 이름이 벽 이름과 늘 같지는 않다 — 예술·사회·인문·철학은 한 벽을 쓴다.
      // 표에 없는 분류를 그냥 두면 아래 fallback 이 조용히 문학 벽으로 보낸다.
      const catWall = WALL_OF[b.category] || b.category;
      const key = b.wall || catWall;
      (byWall[key] || byWall["문학"]).push(shapeForShelf(b, spineSigned));
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

    // 기록의 벽도 실제 기록으로 갈아끼운다 (없으면 빈 벽)
    try {
      const items = await db.listArchive();
      LEAVES.length = 0;
      // renderWalls 는 설명을 l.x 에서 읽는다
      items.forEach((it) => LEAVES.push({
        id: it.id, tp: it.kind, t: it.title,
        x: (it.body || it.url || "").slice(0, 80),
      }));
      const wall = WALLS.find((w) => w.cat === "archive");
      if (wall) wall.n = LEAVES.length;
    } catch (err) {
      console.error("[서재] 기록을 불러오지 못했습니다:", err);
    }

    // 궤짝은 주인의 작업대 — 방문자 화면에는 없다 (RLS 도 막지만 헛걸음을 않는다)
    if (sessionUser) {
      try {
        window.PostLibrosRenderCrate?.(await db.listPending());
      } catch (err) {
        console.error("[서재] 궤짝을 불러오지 못했습니다:", err);
      }
    }

    // 진짜 장서가 도착했으니 기다리던 상태를 푼다
    document.body.classList.remove("waking");
    // 서가만 다시 그리면 상단의 셈과 책상에 옛 숫자가 남는다
    (window.PostLibrosRenderAll || renderWalls)();
    // `#book/<id>` 로 들어온 사람은 그 책의 서표가 열린 채로 서재를 만난다
    try { window.PostLibrosOpenHash?.(); } catch (e) { console.warn("[주소]", e); }
    return books.length;
  }

  /* 책등을 읽고 나면 서가를 다시 그려야 한다 — intake.js 가 부른다 */
  window.PostLibrosRefresh = loadRealLibrary;

  /* 책등의 크기와 색은 되도록 실물을 따른다.
     - 키: 알라딘이 알려준 실제 높이(mm)가 있으면 그것을 (0.52px/mm, 70~130px).
       사륙판 188mm ≈ 98px, 신국판 225mm ≈ 117px, 문고판 148mm ≈ 77px.
     - 두께: 실제 등두께(mm)가 있으면 그것을 (1.1px/mm), 없으면 쪽수로 어림,
       그것도 없으면 제목 해시로 물러난다 — 항상 같은 모습이 되도록 결정적으로. */
  const CLOTH = ["#5C3A22", "#6E2A1E", "#2E4630", "#28323E", "#4A2E3A", "#77522A", "#3A3A30"];
  function shapeForShelf(b, spineSigned) {
    let h = 0;
    for (let i = 0; i < b.title.length; i++) h = (h * 31 + b.title.charCodeAt(i)) >>> 0;
    // 사진에서 오려 낸 실물 책등 — 있으면 그것이 곧 이 책의 얼굴이다
    const spineImg = (b.spine_url && spineSigned?.get(b.spine_url)) || null;
    const boxRatio = (spineImg && b.spine_box && b.spine_box.h > 0)
      ? b.spine_box.w / b.spine_box.h : null;
    return {
      spineImg,
      boxRatio,
      id: b.id,
      t: b.title,
      a: b.author || "지은이 미상",
      cat: b.category || "문학",
      c: b.spine_color || CLOTH[h % CLOTH.length],
      h: b.size_height
        ? Math.max(70, Math.min(130, Math.round(b.size_height * 0.52)))
        : 78 + (h % 40),
      // 실물 조각이 있으면 폭은 사진 속 비율을 따른다 — 조각이 일그러지지 않게
      w2: boxRatio
        ? Math.max(10, Math.min(48, Math.round(
            (b.size_height ? Math.max(70, Math.min(130, Math.round(b.size_height * 0.52))) : 78 + (h % 40)) * boxRatio)))
        : b.size_depth
        ? Math.max(12, Math.min(36, Math.round(b.size_depth * 1.1)))
        : b.page_count
        ? Math.max(13, Math.min(34, Math.round(8 + b.page_count / 28)))
        : 17 + ((h >> 5) % 9),
      pages: b.page_count || null,
      bookmark: b.bookmark_page || null,
      bookmarkAt: b.bookmark_at || null,
      isbn: b.isbn || null,
      pub: b.publisher || null,
      year: b.acquired_on ? Number(b.acquired_on.slice(0, 4)) : null,
      acquired: b.acquired_on || null,
      // 이 책을 만난 사진 — 서표에서 원본 책장 사진을 연다 (주인만)
      photoId: b.spine_photo_id || null,
      // 실물 치수(mm) 그대로 — 판형 지도가 쓴다. 책등 픽셀은 이미 변환된 값이라 못 쓴다
      mmH: b.size_height || null,
      mmD: b.size_depth || null,
      pubYear: b.published_year || null,
      readYear: b.read_year || null,
      series: b.series || null,
      // 이 책에서 시작하는 길의 이름 — 있으면 현관에 걸린다
      pathName: b.path_name || null,
      // 문학 벽의 단을 가르는 갈래 — 「―」는 갈래가 없다고 이미 확인한 표식이다
      genre: b.genre && b.genre !== "―" ? b.genre : null,
      st: b.read_status,
      // 서표에서 고칠 때 쓰는 원본 값들 — 화면용 loc 만으로는 되돌릴 수 없다
      wall: b.wall || null,
      shelfNo: b.shelf ?? null,
      memo: b.memo || "",
      cover: b.cover_url || null,
      loc: [b.wall, b.shelf ? b.shelf + "단" : null].filter(Boolean).join(" ") || "자리 미정",
      paper: (h >> 9) % 6 === 0,
      lean: (h >> 12) % 19 === 0,
      folio: (h >> 15) % 12 === 0,
    };
  }

  /* ── 작업대를 늦게 싣는다 ──────────────────────────────
     js/intake.js 는 51KB 인데 오로지 주인의 것이다 (사진 들이기·궤짝·백업).
     예전에는 index.html 이 모두에게 내려보냈다 — 첫 화면 짐 368KB 중
     칠분의 일을, 방문자는 결코 열 수 없는 화면에 쓰고 있었다.
     주인이 확인된 뒤 한 번만 부른다. intake.js 는 readyState 를 보고
     스스로 mount 하므로, 늦게 와도 그대로 붙는다. */
  let workbenchAsked = false;
  function loadWorkbench() {
    if (workbenchAsked) return;
    workbenchAsked = true;
    const s = document.createElement("script");
    s.src = "js/intake.js";
    s.onerror = () => {
      workbenchAsked = false;   // 다음 울림에 다시 시도할 수 있게
      console.error("[작업대] js/intake.js 를 싣지 못했습니다");
    };
    document.body.appendChild(s);
  }

  /* ── 세션 상태를 화면에 반영 ── */
  /* 마지막으로 장서를 실어 온 사람 — 같은 사람이면 다시 싣지 않는다.
     onAuthStateChange 는 토큰이 갱신될 때마다(한 시간에 한 번쯤) 울리는데,
     그때마다 서가를 통째로 다시 그리면 보던 화면이 벌컥 뒤집힌다. */
  let loadedFor = null;

  async function reflect(user) {
    const mark = document.querySelector(".topbar .mark");
    sessionUser = user ?? null;
    if (user) {
      keyBtn.textContent = "서재";
      keyBtn.title = user.email + " 로 들어와 있습니다";
      keyBtn.classList.add("in");
      document.body.classList.add("owner");
      loadWorkbench();   // 작업대는 주인이 들어온 뒤에야 내려온다
      el("gate-who").textContent = user.email;
      if (loadedFor === user.id) return;   // 토큰 갱신일 뿐 — 서가는 그대로 둔다
      try {
        loadedFor = user.id;
        const n = await loadRealLibrary();
        // 비밀번호를 정하는 중이라면 닫지 않는다 — 방금 띄운 안내가 사라진다
        // (setPassword 도 USER_UPDATED 로 여기까지 온다)
        if (el("gate-account").hidden) closeGate();
        if (n === 0) {
          mark.setAttribute("title", "아직 꽂힌 책이 없습니다 — 궤짝에 책을 넣어 시작하세요");
        }
      } catch (err) {
        loadedFor = null;   // 못 실었다 — 다음 울림에 다시 싣는다
        console.error("[서재] 장서를 불러오지 못했습니다:", err);
      }
    } else {
      loadedFor = null;
      keyBtn.textContent = "열쇠";
      keyBtn.classList.remove("in");
      document.body.classList.remove("owner");
      // 여기서는 표본을 그리지 않는다. onAuthStateChange 는 세션을 읽는
      // 도중에도 null 로 한 번 울릴 수 있어서, 그 소리에 표본을 그리면
      // 새로고침할 때마다 남의 책이 스친다. 판정은 아래 mount 에서
      // 딱 한 번 내린다.
    }
  }

  /* ── 붙이기 ── */
  function mount() {
    const bar = document.querySelector(".topbar .inner");
    if (!bar) return;
    bar.appendChild(keyBtn);
    document.body.appendChild(gate);

    keyBtn.addEventListener("click", () => {
      if (!db) { say("Supabase 연결이 없어 지금은 들어갈 수 없습니다.", "bad"); return; }
      // 들어와 있으면 곧장 내보내지 않는다 — 비밀번호를 정하는 자리이기도 하다
      try {
        openGate(sessionUser ? "inside" : "login");
      } catch (err) {
        // 문이 안 열리면 최소한 이유는 남긴다
        console.error("[열쇠] 문을 열지 못했습니다:", err);
        gate.hidden = false;
        veil.classList.add("show");
        say("문을 여는 중 문제가 생겼습니다: " + (err.message || err), "bad");
      }
    });

    el("gate-out").addEventListener("click", async () => {
      el("gate-out").disabled = true;
      say("나가는 중…");
      // signOut 은 시간제한이 걸려 있어 반드시 돌아온다 (막히면 저장된 세션을 직접 지운다)
      try { await db.signOut(); } catch (err) { console.error("[열쇠] 나가기:", err); }
      location.reload();
    });
    el("gate-close").addEventListener("click", closeGate);
    veil.addEventListener("click", closeGate);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !gate.hidden) closeGate();
    });

    /* ── 평소의 문: 비밀번호 ── */
    el("gate-form-pw").addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = el("gate-email").value.trim();
      const pw = el("gate-pw").value;
      if (!pw) { say("비밀번호를 적으세요. 아직 정하지 않았다면 아래에서 메일로 받으세요.", "bad"); return; }
      el("gate-in").disabled = true;
      say("문을 여는 중…");
      const { error } = await db.signInWithPassword(email, pw);
      el("gate-in").disabled = false;
      if (error) {
        say("메일 주소나 비밀번호가 맞지 않습니다.", "bad");
        return;
      }
      // 세션이 생기면 onAuthStateChange 가 화면을 바꾼다
    });

    /* ── 예비의 문: 메일 링크 ── */
    el("gate-usemail").addEventListener("click", async () => {
      pendingEmail = el("gate-email").value.trim();
      if (!pendingEmail) {
        say("먼저 메일 주소를 적으세요.", "bad");
        el("gate-email").focus();
        return;
      }
      el("gate-usemail").disabled = true;
      say("열쇠를 보내는 중…");
      const { error } = await db.signIn(pendingEmail);
      el("gate-usemail").disabled = false;
      if (error) {
        // 등록되지 않은 주소면 Supabase 가 가입 거절로 답한다 — 이 서재의 주인이 아니라는 뜻이다
        const notOwner = error.code === "otp_disabled" ||
          /signup|not allowed|disabled/i.test(error.message || "");
        // 기본 메일 서비스는 시간당 몇 통뿐이다 — 원문 그대로 두면 무슨 말인지 알 수 없다
        const tooMany = error.status === 429 ||
          /rate limit/i.test(error.message || "");
        say(notOwner
          ? "이 서재의 주인이 아닙니다 — 열쇠는 등록된 주소로만 갑니다."
          : tooMany
          ? "메일을 너무 자주 보냈습니다. 한 시간쯤 뒤에 다시 청하세요 — 이미 들어와 있는 기기가 있다면 거기서 비밀번호를 정하는 편이 빠릅니다."
          : "열쇠를 보내지 못했습니다: " + error.message, "bad");
        return;
      }
      showState("mailed");
      say(pendingEmail + " 으로 보냈습니다. 메일 속 링크를 누르면 열립니다.", "good");
    });

    /* ── 비밀번호 정하기 (들어와 있을 때만) ── */
    el("gate-form-newpw").addEventListener("submit", async (e) => {
      e.preventDefault();
      const pw = el("gate-newpw").value;
      if (pw.length < 8) { say("여덟 자 이상으로 정하세요.", "bad"); return; }
      el("gate-setpw").disabled = true;
      say("비밀번호를 새기는 중…");
      const { error } = await db.setPassword(pw);
      el("gate-setpw").disabled = false;
      if (error) {
        say("정하지 못했습니다: " + error.message, "bad");
        return;
      }
      el("gate-newpw").value = "";
      say("정해졌습니다. 다음부터는 이 비밀번호로 들어오세요.", "good");
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

    /* 서재는 공개다 — 세션 확인을 기다리지 않고 곧장 장서를 싣는다.
       주인이 들어오면 reflect 가 궤짝까지 실어 한 번 더 그린다.
       끝내 못 실으면(통신 장애 등) 빈 벽이라도 보여준다 — 「여는 중」에
       영원히 갇히는 것이 최악이다. */
    loadRealLibrary().catch((err) => {
      // 까닭을 함께 넘긴다 — 화면이 「비어 있음」과 「못 열었음」을 구별해야 한다
      window.PostLibrosShowEmpty?.(err || new Error("알 수 없는 이유"));
    });
    db.currentUser().then(reflect).catch((err) => {
      console.error("[열쇠] 세션을 확인하지 못했습니다:", err);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
