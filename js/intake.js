/* 사진을 들이는 곳 — 책장 사진 업로드
 *
 * 4단계(책 등록 파이프라인)의 첫 조각. 여기서는 사진을 받아 보관만 한다.
 * 책등을 읽어내는 일은 Edge Function 이 맡을 다음 조각이다.
 *
 * 사진 한 장은 곧 위치 기록이다 — 어느 벽 몇 단을 찍었는지 함께 남겨야
 * 나중에 인식된 책들이 제자리를 찾는다.
 *
 * 주인에게만 보인다 (body.owner). 표본 화면에는 나타나지 않는다.
 */
(function () {
  const db = window.PostLibrosDB;
  if (!db) return;

  /* 원본을 얼마나 줄일지 —
     책등 글씨를 나중에 잘라 확대해 읽어야 할 수 있으므로 과하게 줄이지 않는다.
     3000px 를 넘을 때만 줄이고, 그 이하는 손대지 않는다. */
  const MAX_EDGE = 3000;
  const QUALITY = 0.88;
  const WALLS = ["역사", "문학", "과학", "예술사회", "종교"];
  /* 분류가 곧 벽이다 — Edge Function 의 wallFor, DB 의 wall_for_category 와 같은 규칙 */
  /* 인문·철학은 벽 이름이 따로 없다 — 예술과 사회의 벽을 함께 쓴다.
     (auth.js 의 WALL_OF 도 같은 표를 들고 있다) */
  const WALL_OF = {
    역사: "역사", 문학: "문학", 과학: "과학", 종교: "종교",
    예술: "예술사회", 사회: "예술사회", 인문: "예술사회", 철학: "예술사회",
  };
  /* 궤짝(app.js)도 같은 규칙으로 꽂아야 한다 — 규칙을 네 벌로 만들지 않는다 */
  window.PostLibrosWallOf = (cat) => WALL_OF[cat] || "문학";

  let queueBusy = false;

  /* ── 사진 줄이기 ──
     EXIF 회전을 무시하면 눕혀 찍은 사진이 돌아간 채 저장된다.
     createImageBitmap 의 imageOrientation 이 그걸 바로잡아 준다. */
  async function shrink(file) {
    if (!/^image\//.test(file.type)) throw new Error("사진만 들일 수 있습니다");
    let bmp;
    try {
      bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // 브라우저가 못 여는 형식(HEIC 등) — 원본 그대로 보낸다
      return file;
    }
    const long = Math.max(bmp.width, bmp.height);
    if (long <= MAX_EDGE) { bmp.close(); return file; }

    const k = MAX_EDGE / long;
    const cv = document.createElement("canvas");
    cv.width = Math.round(bmp.width * k);
    cv.height = Math.round(bmp.height * k);
    cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
    bmp.close();

    const blob = await new Promise((r) => cv.toBlob(r, "image/jpeg", QUALITY));
    return blob || file;
  }

  /* ── 화면 ── */
  const sec = document.createElement("section");
  sec.className = "intake";
  sec.id = "intake";
  sec.innerHTML = `
    <!-- 무엇부터 해야 하는지 매번 세어 보지 않아도 되게 —
         빈 칸을 숫자로 보여주고, 그 자리에서 바로 채우는 단추를 준다.
         순서는 값이 큰 것부터: 싼 것 먼저, 비싼 것 나중 -->
    <div class="health" id="in-health">
      <div class="crate-label">
        <b>서재의 건강 상태</b>
        <span id="hl-sub">세는 중…</span>
      </div>
      <div class="healthrows" id="hl-rows"></div>
    </div>

    <div class="crate-label">
      <b>사진을 들인다</b>
      <span>책장을 찍어 올리면 이 방에 쌓인다</span>
    </div>
    <div class="intake-where">
      <label>어느 벽
        <select id="in-wall">
          <option value="">아직 모름</option>
          ${WALLS.map((w) => `<option value="${w}">${w}</option>`).join("")}
        </select>
      </label>
      <label>몇 단
        <input type="number" id="in-shelf" min="1" max="12" placeholder="—">
      </label>
      <span class="intake-hint">비워 두면 책의 분류를 보고 자리를 정합니다 — 실제로 찍은 칸을 적어 두면 그것이 우선입니다</span>
    </div>
    <button type="button" class="dropzone" id="in-drop">
      <span class="dz-mark">▚</span>
      <b>사진을 여기 놓거나, 눌러서 고른다</b>
      <span class="dz-sub">3000px 를 넘는 사진만 줄여서 보관합니다 — 책등 글씨는 남깁니다</span>
    </button>
    <input type="file" id="in-file" accept="image/*" multiple hidden>
    <ul class="intake-queue" id="in-queue"></ul>

    <form class="byhand" id="in-byhand">
      <span class="byhand-lb">사진에 없는 책은 손으로</span>
      <input type="text" id="bh-title" placeholder="제목" aria-label="제목" required>
      <input type="text" id="bh-author" placeholder="지은이" aria-label="지은이">
      <select id="bh-cat" aria-label="분류">
        <option value="문학">문학</option>
        <option value="역사">역사</option>
        <option value="과학">과학</option>
        <option value="예술">예술</option>
        <option value="사회">사회</option>
        <option value="종교">종교</option>
      </select>
      <button type="submit" class="byhand-go">꽂는다</button>
      <span class="byhand-msg" id="bh-msg"></span>
    </form>

    <div class="barcode" id="in-barcode">
      <div class="enrich-head">
        <b>바코드로 들인다</b>
        <span>뒤표지의 바코드가 곧 ISBN 입니다 — 비추면 서지가 완성된 채로 꽂힙니다</span>
      </div>
      <div class="bc-row">
        <button type="button" class="enrich-go" id="bc-scan">카메라를 켠다</button>
        <input type="text" id="bc-isbn" inputmode="numeric" placeholder="또는 ISBN 을 적는다"
               aria-label="ISBN 직접 입력">
        <button type="button" class="enrich-go" id="bc-add">꽂는다</button>
      </div>
      <video id="bc-video" playsinline muted hidden></video>
      <div class="enrich-out" id="bc-out"></div>
    </div>

    <div class="enrich">
      <div class="enrich-head">
        <b>서지를 채운다</b>
        <span>알라딘에 물어 ISBN·출판사·표지·분류를 넣고 지은이 오탈자를 바로잡습니다</span>
      </div>
      <!-- 하루 호출 한도의 계기판 — 이 눈금을 넘기면 키가 막혀 하루를 잃는다 -->
      <div class="gauge" id="in-gauge" hidden>
        <span class="gauge-n" id="in-gauge-n"></span>
        <i><b id="in-gauge-bar"></b></i>
      </div>
      <button type="button" class="enrich-go" id="in-enrich">끝까지 채운다</button>
      <div class="enrich-out" id="in-enrich-out"></div>
    </div>

    <div class="enrich">
      <div class="enrich-head">
        <b>문학 벽을 갈래낸다</b>
        <span>열에 아홉이 문학 벽에 몰려 있습니다 — 소설·고전·에세이로 단을 가릅니다.
          ISBN 을 아는 책만 물으므로 권당 조회 한 번입니다</span>
      </div>
      <button type="button" class="enrich-go" id="in-genre">갈래를 받아온다</button>
      <div class="enrich-out" id="in-genre-out"></div>
    </div>

    <div class="enrich">
      <div class="enrich-head">
        <b>실물 책등을 되살린다</b>
        <span>인식이 남긴 자리 상자로 책장 사진에서 그 책등만 오려 붙입니다 —
          벽에 진짜 책등 사진이 걸립니다. 알라딘도 AI 도 부르지 않으니 비용은 없습니다</span>
      </div>
      <button type="button" class="enrich-go" id="in-spines">사진에서 책등을 오린다</button>
      <div class="enrich-out" id="in-spines-out"></div>
    </div>

    <div class="enrich">
      <div class="enrich-head">
        <b>이름 없는 책들</b>
        <span>지은이가 비어 있는 책만 모읍니다 — 대부분 알라딘이 한 번 놓친 책이니,
          아는 이름은 그냥 적는 편이 빠릅니다</span>
      </div>
      <div class="enrich-row">
        <button type="button" class="enrich-go" id="nm-load">이름 없는 책을 부른다</button>
        <button type="button" class="enrich-go" id="nm-askall" hidden>보이는 책을 모두 물어본다</button>
      </div>
      <div class="enrich-out" id="nm-out"></div>
      <div class="nameless" id="nm-list"></div>
    </div>

    <div class="enrich">
      <div class="enrich-head">
        <b>기록을 한꺼번에 짓는다</b>
        <span>방문자가 실제로 여는 순서대로 — 읽음, 읽는 중, 표지가 있어 진열장에 서는 책.
          한 번에 서른 권까지, 권마다 비용이 듭니다</span>
      </div>
      <button type="button" class="enrich-go" id="in-summarize">만나는 책부터 기록을 짓는다</button>
      <div class="enrich-out" id="in-summarize-out"></div>
    </div>

    <div class="enrich">
      <div class="enrich-head">
        <b>여백에 한 줄씩</b>
        <span>읽어 낸 책 중 여백이 빈 것만 불러 모읍니다 — 이 서재에서 AI 가 대신
          쓸 수 없는 유일한 칸입니다. 칸을 벗어나면 그 자리에서 저장됩니다</span>
      </div>
      <button type="button" class="enrich-go" id="mg-load">여백이 빈 책을 부른다</button>
      <div class="enrich-out" id="mg-out"></div>
      <div class="nameless" id="mg-list"></div>
    </div>

    <div class="enrich">
      <div class="enrich-head">
        <b>장서를 베껴 둔다</b>
        <span>장서를 한 곳에만 두지 않습니다 — 지금 꽂힌 그대로를 파일로 내려받습니다</span>
      </div>
      <button type="button" class="enrich-go" id="in-export">목록을 내려받는다 (CSV)</button>
      <div class="enrich-out" id="in-export-out"></div>
    </div>

    <div class="enrich">
      <div class="enrich-head">
        <b>목록을 되들인다</b>
        <span>내려받은 CSV 를 표계산에서 고쳐 다시 올리면, 아이디가 맞는 책을 그대로 고칩니다</span>
      </div>
      <div class="bc-row">
        <input type="file" id="in-import" accept=".csv,text/csv" hidden>
        <button type="button" class="enrich-go" id="in-import-pick">CSV 를 고른다</button>
        <button type="button" class="enrich-go" id="in-import-go" hidden>적용한다</button>
      </div>
      <div class="enrich-out" id="in-import-out"></div>
    </div>

    <div class="intake-shelf" id="in-shelfroll"></div>`;

  const el = (id) => document.getElementById(id);

  /* ── 올리기 ── */
  async function take(files) {
    const list = Array.from(files).filter((f) => /^image\//.test(f.type) || /\.heic$/i.test(f.name));
    if (!list.length) return;

    const wall = el("in-wall").value || null;
    const shelfRaw = el("in-shelf").value.trim();
    const shelf = shelfRaw ? Number(shelfRaw) : null;

    const q = el("in-queue");
    queueBusy = true;
    sec.classList.add("busy");

    for (const file of list) {
      const li = document.createElement("li");
      li.innerHTML = `<span class="qn"></span><span class="qs">줄이는 중…</span>`;
      li.querySelector(".qn").textContent = file.name;
      q.prepend(li);
      const status = li.querySelector(".qs");

      try {
        const blob = await shrink(file);
        status.textContent = "올리는 중…";
        await db.uploadIntakePhoto(blob, { wall, shelf });
        const saved = Math.max(0, file.size - blob.size);
        li.classList.add("done");
        status.textContent = saved > 0
          ? `들였다 · ${fmt(blob.size)} (${fmt(saved)} 줄임)`
          : `들였다 · ${fmt(blob.size)}`;
      } catch (err) {
        li.classList.add("bad");
        status.textContent = "실패 — " + (err.message || "알 수 없는 이유");
        console.error("[사진] 들이지 못했습니다:", err);
      }
    }

    queueBusy = false;
    sec.classList.remove("busy");
    await renderShelf();
  }

  /* 알라딘에서 온 글자를 화면에 넣기 전에 — 서지에는 <, & 가 섞여 있다 */
  function esc(s) {
    return String(s ?? "").replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function fmt(bytes) {
    if (bytes < 1024) return bytes + "B";
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + "KB";
    return (bytes / 1048576).toFixed(1) + "MB";
  }

  /* ── 들여놓은 사진들 ── */
  async function renderShelf() {
    const host = el("in-shelfroll");
    let photos;
    try {
      photos = await db.listIntakePhotos();
    } catch (err) {
      console.error("[사진] 목록을 읽지 못했습니다:", err);
      return;
    }
    if (!photos.length) {
      host.innerHTML = `<p class="intake-empty">아직 들인 사진이 없습니다.</p>`;
      return;
    }

    host.innerHTML = "";
    const grid = document.createElement("div");
    grid.className = "photogrid";
    host.appendChild(grid);

    const count = document.createElement("p");
    count.className = "intake-empty";
    count.textContent = `${photos.length}장 보관 중 — 아직 아무도 읽지 않았습니다`;
    host.appendChild(count);

    for (const p of photos) {
      const card = document.createElement("figure");
      card.className = "photocard";
      const where = [p.wall ? p.wall + "의 벽" : "벽 미정", p.shelf ? p.shelf + "단" : null]
        .filter(Boolean).join(" · ");
      const done = p.status === "완료";
      card.innerHTML = `
        <div class="ph"></div>
        <figcaption>${where}<span class="pst">${p.status}</span></figcaption>
        <button class="phdel" aria-label="이 사진을 버린다">버린다</button>
        <button class="phread${done ? " again" : ""}">${done ? "↻ 다시 읽는다" : "책등을 읽는다"}</button>
        <p class="phnote">${p.note ? p.note : ""}</p>`;
      grid.appendChild(card);

      card.querySelector(".phread").addEventListener("click", async (ev) => {
        const btn = ev.currentTarget;

        /* 예전에는 「같은 책이 또 꽂힙니다」라고 겁을 주었는데 그건 사실이 아니다 —
           함수가 이미 꽂힌 책을 열쇠로 걸러 내고(2026-09-02 코드로 확인),
           대신 없던 자리 상자를 소급해 채운다. 궤짝의 대기 후보도 지우고 새로
           담으므로 불어나지 않는다. 남는 값은 AI 호출 비용뿐이라, 겁이 아니라
           값을 알린다. */
        if (btn.classList.contains("again") && !btn.dataset.sure) {
          btn.dataset.sure = "1";
          btn.textContent = "한 번 더 — 비용이 듭니다";
          setTimeout(() => {
            if (!btn.dataset.sure) return;
            delete btn.dataset.sure;
            btn.textContent = "↻ 다시 읽는다";
          }, 4000);
          return;
        }
        delete btn.dataset.sure;
        btn.classList.remove("warn");
        btn.disabled = true;
        const note = card.querySelector(".phnote");
        note.textContent = "책등을 읽는 중… (수십 권이면 1분쯤 걸립니다)";
        const { data, error } = await db.recognizeSpines(p.id);
        btn.disabled = false;
        if (error) {
          note.textContent = "읽지 못했습니다 — " + (error.message || "알 수 없는 이유");
          console.error("[사진] 책등 읽기 실패:", error);
          return;
        }
        note.textContent = `${data.읽은권수}권을 읽어 ${data.꽂음}권을 꽂고 ${data.궤짝}권은 궤짝에 담았습니다`;
        // 새로 꽂힌 책이 서가에 보이도록 다시 그린다
        try { await window.PostLibrosRefresh?.(); } catch (e) { console.error(e); }
        await renderShelf();
        // 읽자마자 실물 책등도 오려 붙인다 — 자리 상자를 받은 책이 있으면
        try { await cropSpines(note); } catch (e) { console.error("[책등 조각]", e); }
      });

      // 비공개 버킷이라 서명된 주소를 받아 와야 보인다
      db.photoUrl(p.storage_path).then((url) => {
        card.querySelector(".ph").style.backgroundImage = `url("${url}")`;
      }).catch(() => card.querySelector(".ph").classList.add("nophoto"));

      card.querySelector(".phdel").addEventListener("click", async () => {
        card.classList.add("going");
        try {
          await db.removeIntakePhoto(p);
          await renderShelf();
        } catch (err) {
          card.classList.remove("going");
          console.error("[사진] 버리지 못했습니다:", err);
        }
      });
    }
  }

  /* ── 붙이기 ── */
  function mount() {
    const crate = document.getElementById("crate");
    if (!crate || !crate.parentNode) return;
    // 궤짝 뒤에 놓는다 (nextSibling 이 없으면 맨 뒤에 붙는다)
    crate.parentNode.insertBefore(sec, crate.nextSibling);

    const drop = el("in-drop");
    const picker = el("in-file");

    drop.addEventListener("click", () => picker.click());
    picker.addEventListener("change", () => {
      take(picker.files);
      picker.value = "";
    });

    ["dragenter", "dragover"].forEach((e) =>
      drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.add("over"); }));
    ["dragleave", "drop"].forEach((e) =>
      drop.addEventListener(e, () => drop.classList.remove("over")));
    drop.addEventListener("drop", (ev) => {
      ev.preventDefault();
      if (!queueBusy && ev.dataTransfer?.files?.length) take(ev.dataTransfer.files);
    });

    /* ── 실물 책등 오려 붙이기 ──
       인식이 준 자리 상자(0~1000 비율)로 책장 사진에서 그 책등만 오려
       작은 webp 로 저장한다. 서가는 이 조각을 진짜 책등으로 그린다.
       사진 한 장은 한 번만 내려받고, 그 안의 책들을 전부 오린다. */
    async function cropSpines(msgEl) {
      const list = await db.listUncroppedSpines();
      if (!list.length) return 0;
      if (msgEl) msgEl.textContent = `실물 책등을 오리는 중… 0 / ${list.length}`;

      // 사진별로 묶는다 — 큰 사진을 책마다 다시 받지 않도록
      const byPhoto = new Map();
      list.forEach((b) => {
        const path = b.intake_photos?.storage_path;
        if (!path) return;
        if (!byPhoto.has(path)) byPhoto.set(path, []);
        byPhoto.get(path).push(b);
      });

      let done = 0, failed = 0;
      for (const [path, books] of byPhoto) {
        let bmp;
        try {
          const url = await db.photoUrl(path);
          const blob = await (await fetch(url)).blob();
          bmp = await createImageBitmap(blob);
        } catch (e) { failed += books.length; console.error("[책등 조각] 사진 열기 실패:", e); continue; }

        for (const b of books) {
          try {
            const { x, y, w, h } = b.spine_box;
            // 상자 가장자리를 조금 넉넉히 — 모델의 상자가 딱 맞지 않을 수 있다
            const pad = 3; // 0~1000 기준
            const sx = Math.max(0, (x - pad)) / 1000 * bmp.width;
            const sy = Math.max(0, (y - pad)) / 1000 * bmp.height;
            const sw = Math.min(1000, w + pad * 2) / 1000 * bmp.width;
            const sh = Math.min(1000, h + pad * 2) / 1000 * bmp.height;
            const scale = Math.min(1, 260 / sh);   // 조각 높이 260px 이면 충분하다
            const cv = document.createElement("canvas");
            cv.width = Math.max(8, Math.round(sw * scale));
            cv.height = Math.max(24, Math.round(sh * scale));
            cv.getContext("2d").drawImage(bmp, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
            const piece = await new Promise((ok) => cv.toBlob(ok, "image/webp", 0.82));
            if (!piece) throw new Error("webp 변환 실패");
            await db.uploadSpineCrop(b.id, piece);
            done++;
          } catch (e) { failed++; console.error("[책등 조각]", e); }
          if (msgEl) msgEl.textContent = `실물 책등을 오리는 중… ${done + failed} / ${list.length}`;
        }
        bmp.close?.();
      }
      if (msgEl) {
        msgEl.textContent = `실물 책등 ${done}권을 오려 붙였습니다` + (failed ? ` · ${failed}권 실패` : "");
      }
      if (done) { try { await window.PostLibrosRefresh?.(); } catch (e) { console.error(e); } }
      return done;
    }
    window.PostLibrosCropSpines = cropSpines;

    /* ── 바코드 입고 ──
       모바일 크롬의 BarcodeDetector 로 EAN-13 을 읽는다 (978/979 = ISBN).
       한 권이 꽂히면 잠깐 알리고 계속 비춘다 — 선 채로 여러 권을 들일 수 있다.
       미지원 브라우저(사파리 등)에서는 손으로 적는 칸만 남는다. */
    let bcStream = null, bcTimer = null;
    const bcSeen = new Map();   // 같은 바코드를 연달아 읽지 않게 (isbn → 시각)

    async function addIsbn(isbn) {
      const out = el("bc-out");
      out.innerHTML = `<p class="enrich-msg">알라딘에 묻는 중… (${isbn})</p>`;
      try {
        const { data, error } = await db.addByIsbn(isbn);
        if (error || data?.error) throw new Error(data?.error || error.message);
        if (data.겹침) {
          out.innerHTML = `<p class="enrich-msg">이미 꽂혀 있습니다 — </p>`;
          out.querySelector("p").append(data.제목);
        } else {
          out.innerHTML = `<p class="enrich-msg good"></p>`;
          out.querySelector("p").textContent =
            `꽂았습니다 — ${data.제목}${data.지은이 ? " · " + data.지은이 : ""}${data.쪽수 ? " · " + data.쪽수 + "쪽" : ""}`;
        }
        await window.PostLibrosRefresh?.();
      } catch (err) {
        out.innerHTML = `<p class="enrich-msg bad"></p>`;
        out.querySelector("p").textContent = "꽂지 못했습니다 — " + (err.message || err);
      }
    }

    function stopScan() {
      clearInterval(bcTimer); bcTimer = null;
      bcStream?.getTracks().forEach((t) => t.stop()); bcStream = null;
      el("bc-video").hidden = true;
      el("bc-scan").textContent = "카메라를 켠다";
    }

    el("bc-scan").addEventListener("click", async () => {
      if (bcStream) { stopScan(); return; }
      const out = el("bc-out");
      if (!("BarcodeDetector" in window)) {
        out.innerHTML = `<p class="enrich-msg bad">이 브라우저는 바코드 읽기가 안 됩니다 — 옆 칸에 ISBN 을 적어 주세요.</p>`;
        return;
      }
      try {
        bcStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
      } catch {
        out.innerHTML = `<p class="enrich-msg bad">카메라를 열지 못했습니다 — 권한을 확인해 주세요.</p>`;
        return;
      }
      const video = el("bc-video");
      video.srcObject = bcStream;
      video.hidden = false;
      await video.play();
      el("bc-scan").textContent = "카메라를 끈다";
      out.innerHTML = `<p class="enrich-msg">뒤표지 바코드를 비춰 주세요…</p>`;
      const detector = new BarcodeDetector({ formats: ["ean_13"] });
      bcTimer = setInterval(async () => {
        if (!bcStream || video.readyState < 2) return;
        try {
          const codes = await detector.detect(video);
          for (const c of codes) {
            const v = c.rawValue;
            if (!/^97[89]\d{10}$/.test(v)) continue;          // ISBN 이 아닌 바코드
            const last = bcSeen.get(v) || 0;
            if (Date.now() - last < 8000) continue;            // 방금 읽은 책이다
            bcSeen.set(v, Date.now());
            await addIsbn(v);
          }
        } catch { /* 한 프레임 놓친 것뿐이다 */ }
      }, 350);
    });

    el("bc-add").addEventListener("click", () => {
      const v = el("bc-isbn").value.replace(/[^0-9Xx]/g, "");
      if (v.length !== 13 && v.length !== 10) {
        el("bc-out").innerHTML = `<p class="enrich-msg bad">ISBN 은 10자리나 13자리입니다.</p>`;
        return;
      }
      el("bc-isbn").value = "";
      addIsbn(v);
    });
    el("bc-isbn").addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); el("bc-add").click(); }
    });

    /* 베껴 두기 — 서재가 사라져도 목록은 손에 남게 한다.
       엑셀이 한글을 깨뜨리지 않도록 BOM 을 앞에 붙인다. */
    el("in-export").addEventListener("click", async () => {
      const btn = el("in-export"), out = el("in-export-out");
      btn.disabled = true;
      out.innerHTML = `<p class="enrich-msg">장서를 세는 중…</p>`;
      try {
        const rows = await db.syncBooks();
        // 아이디는 되들이기(수정 왕복)의 열쇠다 — 사람이 읽을 일은 없어 맨 뒤에 둔다
        const cols = ["title", "author", "category", "publisher", "isbn", "published_year",
                      "page_count", "size_height", "size_depth", "bookmark_page",
                      "read_status", "read_year", "series", "wall", "shelf", "slot", "acquired_on",
                      "memo", "cover_url", "id"];
        const head = ["제목","지은이","분류","펴낸곳","ISBN","펴낸해","쪽수","높이mm","등두께mm","갈피",
                      "읽음","읽은해","시리즈","벽","단","자리","입고","여백","표지","아이디"];
        const cell = (v) => {
          const s = v == null ? "" : String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const csv = "﻿" + [head.join(",")]
          .concat(rows.map((r) => cols.map((c) => cell(r[c])).join(","))).join("\r\n");
        const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
        const a = document.createElement("a");
        const d = new Date();
        const stamp = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`;
        a.href = url;
        a.download = `서가뒤의방-장서-${stamp}.csv`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        out.innerHTML = `<p class="enrich-msg good">${rows.length.toLocaleString()}권을 베껴 두었습니다.</p>`;
      } catch (err) {
        out.innerHTML = `<p class="enrich-msg bad"></p>`;
        out.querySelector("p").textContent = "베끼지 못했습니다 — " + (err.message || err);
      }
      btn.disabled = false;
    });

    /* 되들이기 — 내려받은 CSV 를 고쳐 올리면 아이디로 그 책을 찾아 고친다.
       아이디 없는 줄은 건드리지 않는다 (새 책은 사진·바코드·손입력으로).
       파일에 있는 열만 고친다 — 옛 CSV 에 없는 열을 지워 버리지 않기 위해서다.
       고르기와 적용을 나눈 것은 안전판이다: 몇 줄이 읽혔는지 보고 누른다. */
    const CSV_COL = {
      "제목": "title", "지은이": "author", "분류": "category", "펴낸곳": "publisher",
      "ISBN": "isbn", "펴낸해": "published_year", "쪽수": "page_count",
      "높이mm": "size_height", "등두께mm": "size_depth", "갈피": "bookmark_page",
      "읽음": "read_status", "읽은해": "read_year", "시리즈": "series", "벽": "wall", "단": "shelf",
      "자리": "slot", "입고": "acquired_on", "여백": "memo", "표지": "cover_url",
      "아이디": "id",
    };
    const CSV_NUM = new Set(["published_year", "page_count", "size_height",
                             "size_depth", "bookmark_page", "read_year", "shelf", "slot"]);

    function parseCSV(text) {
      const rows = []; let row = [], cell = "", inQ = false;
      text = text.replace(/^﻿/, "");   // 내보낼 때 붙인 BOM
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQ) {
          if (ch === '"') {
            if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false;
          } else cell += ch;
        } else if (ch === '"') inQ = true;
        else if (ch === ",") { row.push(cell); cell = ""; }
        else if (ch === "\n" || ch === "\r") {
          if (ch === "\r" && text[i + 1] === "\n") i++;
          row.push(cell); cell = "";
          if (row.some((c) => c !== "")) rows.push(row);
          row = [];
        } else cell += ch;
      }
      row.push(cell);
      if (row.some((c) => c !== "")) rows.push(row);
      return rows;
    }

    let importRows = null;   // 고른 파일에서 만든 [책id, 고칠 것] 목록
    el("in-import-pick").addEventListener("click", () => el("in-import").click());
    el("in-import").addEventListener("change", async () => {
      const out = el("in-import-out"), go = el("in-import-go");
      const file = el("in-import").files?.[0];
      el("in-import").value = "";
      importRows = null; go.hidden = true;
      if (!file) return;
      try {
        const rows = parseCSV(await file.text());
        if (rows.length < 2) throw new Error("줄이 없습니다");
        const cols = rows[0].map((h) => CSV_COL[h.trim()] || null);
        const idAt = cols.indexOf("id");
        if (idAt < 0) throw new Error("「아이디」 열이 없습니다 — 새로 내려받은 CSV 를 쓰세요");
        let noId = 0;
        importRows = [];
        for (const r of rows.slice(1)) {
          const id = (r[idAt] || "").trim();
          if (!id) { noId++; continue; }
          const patch = {};
          cols.forEach((c, i) => {
            if (!c || c === "id") return;
            const raw = (r[i] ?? "").trim();
            if (CSV_NUM.has(c)) {
              const n = raw === "" ? null : Number(raw);
              patch[c] = Number.isFinite(n) ? n : null;
            } else if (c === "read_status") {
              // 상태는 세 값뿐이다 — 이상한 값으로 DB 제약에 부딪히지 않게 거른다
              if (["읽음", "읽는 중", "안 읽음"].includes(raw)) patch[c] = raw;
            } else {
              patch[c] = raw === "" ? null : raw;
            }
          });
          if (Object.keys(patch).length) importRows.push([id, patch]);
        }
        if (!importRows.length) throw new Error("고칠 줄이 없습니다");
        out.innerHTML = `<p class="enrich-msg"></p>`;
        out.querySelector("p").textContent =
          `${importRows.length.toLocaleString()}줄을 읽었습니다`
          + (noId ? ` (아이디 없는 ${noId}줄은 건너뜁니다)` : "")
          + " — 「적용한다」를 누르면 그대로 고칩니다.";
        go.hidden = false;
      } catch (err) {
        out.innerHTML = `<p class="enrich-msg bad"></p>`;
        out.querySelector("p").textContent = "읽지 못했습니다 — " + (err.message || err);
      }
    });
    el("in-import-go").addEventListener("click", async () => {
      const out = el("in-import-out"), go = el("in-import-go");
      if (!importRows?.length) return;
      go.disabled = true;
      let ok = 0, dup = 0, bad = 0;
      for (let i = 0; i < importRows.length; i++) {
        go.textContent = `고치는 중… ${i + 1} / ${importRows.length}`;
        const [id, patch] = importRows[i];
        try { await db.updateBook(id, patch); ok++; }
        catch (err) {
          // 제목·지은이를 고치다 이미 있는 책과 같아졌다 — 그 줄만 접는다
          if (String(err.code || "") === "23505" || String(err.message || "").includes("23505")) dup++;
          else { bad++; console.error("[되들이기] 못 고쳤습니다:", id, err); }
        }
      }
      importRows = null;
      go.hidden = true; go.disabled = false; go.textContent = "적용한다";
      out.innerHTML = `<p class="enrich-msg ${bad ? "bad" : "good"}"></p>`;
      out.querySelector("p").textContent =
        `${ok.toLocaleString()}권을 고쳤습니다`
        + (dup ? ` · ${dup}권은 다른 책과 겹쳐 접었습니다` : "")
        + (bad ? ` · ${bad}권은 실패했습니다` : "");
      await window.PostLibrosRefresh?.();
    });

    /* 기록 일괄 짓기 — 읽음 책 중 기록 없는 것만 골라 서른 권까지.
       권마다 AI 비용이 들므로 상한을 걸고, 언제든 멈출 수 있다.
       이미 있는 기록은 함수가 그대로 돌려주므로 두 번 물어도 돈이 두 번 들지 않지만,
       애초에 없는 것만 추려 보내 헛걸음을 줄인다. */
    let sumStop = false;
    el("in-summarize").addEventListener("click", async () => {
      const btn = el("in-summarize"), out = el("in-summarize-out");
      if (btn.dataset.running) { sumStop = true; btn.textContent = "멈추는 중…"; return; }
      btn.dataset.running = "1";
      sumStop = false;
      out.innerHTML = `<p class="enrich-msg">읽은 책을 세는 중…</p>`;
      try {
        const [rows, haveIds] = await Promise.all([
          db.syncBooks(),
          db.listSummarizedIds(),
        ]);
        const have = new Set(haveIds);
        /* 방문자가 실제로 여는 서표부터 채운다.
           읽음 책이 가장 먼저 열리고(읽은 책만 거름망·회고·리듬이 다 그리로 간다),
           그다음이 읽는 중, 그다음이 표지가 있어 진열장에 설 수 있는 책이다.
           표지도 없고 읽지도 않은 책은 아무도 만나지 않으므로 맨 뒤다. */
        const rank = (r) =>
          r.read_status === "읽음" ? 0 :
          r.read_status === "읽는 중" ? 1 :
          r.cover_url ? 2 : 3;
        const queue = rows
          .filter((r) => !have.has(r.id) && rank(r) < 3)
          .sort((a, b) => rank(a) - rank(b) || (a.title || "").localeCompare(b.title || "", "ko"));
        const todo = queue.slice(0, 30);
        const left = queue.length - todo.length;
        if (!todo.length) {
          out.innerHTML = `<p class="enrich-msg good">방문자가 만나는 책의 기록이 모두 있습니다.</p>`;
        } else {
          btn.textContent = "멈춘다";
          let ok = 0, bad = 0;
          for (let i = 0; i < todo.length; i++) {
            if (sumStop) break;
            out.innerHTML = `<p class="enrich-msg"></p>`;
            out.querySelector("p").textContent =
              `짓는 중… ${i + 1} / ${todo.length} — 「${todo[i].title}」`;
            const { data, error } = await db.summarizeBook(todo[i].id);
            if (error || data?.error) { bad++; console.error("[기록] 못 지었습니다:", todo[i].title, error || data?.error); }
            else ok++;
          }
          out.innerHTML = `<p class="enrich-msg ${bad ? "bad" : "good"}"></p>`;
          out.querySelector("p").textContent =
            `${ok}권의 기록을 지었습니다`
            + (bad ? ` · ${bad}권은 실패했습니다` : "")
            + (left > 0 ? ` · 아직 ${left}권이 남았습니다 — 한 번 더 누르면 이어 짓습니다` : "");
        }
      } catch (err) {
        out.innerHTML = `<p class="enrich-msg bad"></p>`;
        out.querySelector("p").textContent = "짓지 못했습니다 — " + (err.message || err);
      }
      delete btn.dataset.running;
      btn.textContent = "읽은 책의 기록을 짓는다";
    });

    /* ── 실물 책등 되살리기 ──
       사진 인식은 자리 상자를 남겼는데 오려 붙이는 일이 한 번도 돌지 않은 책들이
       그대로 남아 있다. 사진과 상자만 있으면 되므로 아무 API 도 부르지 않는다. */
    el("in-spines").addEventListener("click", async () => {
      const btn = el("in-spines"), out = el("in-spines-out");
      if (btn.dataset.running) return;
      btn.dataset.running = "1"; btn.disabled = true;
      out.innerHTML = `<p class="enrich-msg">사진을 여는 중…</p>`;
      const msg = out.querySelector(".enrich-msg");
      try {
        const n = await cropSpines(msg);
        if (!n && msg.textContent === "사진을 여는 중…") {
          /* 오릴 것이 0개일 때 「이미 다 오렸습니다」라고 하면 거짓말이 된다 —
             실제로는 자리 상자를 가진 책이 한 권도 없는 경우가 대부분이다
             (상자를 받기 전 코드로 읽은 옛 사진들). 무엇을 해야 하는지 말한다. */
          msg.textContent = "오릴 자리가 하나도 없습니다 — 위의 사진에서 「↻ 다시 읽는다」를 "
            + "누르면 자리를 소급해 채웁니다 (이미 꽂힌 책은 다시 안 꽂힙니다)";
        }
      } catch (e) {
        msg.className = "enrich-msg bad";
        msg.textContent = "오리지 못했습니다: " + (e?.message || e);
      }
      btn.disabled = false; delete btn.dataset.running;
    });

    /* ── 갈래 채우기 ──────────────────────────────────────────
       한 번 누르면 남은 것이 없을 때까지 마흔 권씩 돌고, 다시 누르면 멈춘다.
       권당 조회 1회라 서지 채우기보다 싸지만, 그래도 계기판은 함께 본다. */
    let genreStop = false;
    el("in-genre").addEventListener("click", async () => {
      const btn = el("in-genre"), out = el("in-genre-out");
      if (btn.dataset.running) { genreStop = true; btn.textContent = "멈추는 중…"; return; }
      btn.dataset.running = "1"; btn.textContent = "멈춘다"; genreStop = false;
      let 얻음 = 0, 없음 = 0, 회 = 0, 마지막남음 = -1;
      const 모음 = {};
      const say = (t, cls = "") => {
        out.innerHTML = `<p class="enrich-msg ${cls}"></p>`;
        const names = Object.entries(모음).sort((a, b2) => b2[1] - a[1])
          .map(([k, v]) => `${k} ${v}`).join(" · ");
        out.querySelector("p").textContent = t + (names ? ` — ${names}` : "");
      };
      say("알라딘에 묻는 중…");
      while (!genreStop) {
        회++;
        const { data, error } = await db.fillGenres(40);
        if (error || data?.error) {
          say("갈래를 받다 멈췄습니다 — " + (data?.error || error.message)
            + ` (여기까지 ${얻음}권)`, "bad");
          break;
        }
        얻음 += data.갈래 || 0;
        없음 += data.없음 || 0;
        Object.entries(data.갈래수 || {}).forEach(([k, v]) => { 모음[k] = (모음[k] || 0) + v; });
        // 돌았는데 남은 수가 그대로다 — 헛돌지 않고 멈춘다
        if (data.남음 === 마지막남음) {
          say(`더 나아가지 못해 멈췄습니다 — ${얻음}권에 갈래를 달았습니다`, "bad");
          break;
        }
        마지막남음 = data.남음;
        await window.PostLibrosRefresh?.();
        await drawGauge();
        if (!data.남음) { say(`갈래를 다 달았습니다 — ${얻음}권`, "good"); break; }
        say(`${회}번째 — ${얻음}권에 갈래 · 갈래 없음 ${없음} · 아직 ${data.남음}권`);
      }
      if (genreStop) say(`멈췄습니다 — ${얻음}권에 갈래를 달았습니다`, "good");
      delete btn.dataset.running;
      btn.textContent = "갈래를 받아온다";
    });

    /* ── 이름 없는 책들 ───────────────────────────────────────
       지은이가 비어 있는 책은 「지은이 미상」으로 서가에 선다. 고치려면
       서표를 한 권씩 열어야 했는데, 그러면 예순 권을 예순 번 여닫아야 한다.
       한 자리에 모아 놓고 — 아는 이름은 그냥 적고, 모르는 것만 알라딘에
       묻는다. 묻는 것은 권당 호출을 쓰므로 한 번에 스무 권까지만. */
    let nmRows = [];
    async function askOne(row) {
      const { b, el: box, say, ask, inp } = row;
      ask.disabled = true;
      say.textContent = "묻는 중…";
      box.classList.remove("done", "miss");
      try {
        const { data, error } = await db.enrichBook(b.id);
        if (error || data?.error) throw new Error(data?.error || error.message);
        // 서지 채우기는 지은이를 고치면 「고침」에 적어 돌려준다
        const fixed = (data.고침 || [])[0];
        const name = fixed?.지은이후 || null;
        if (name) {
          inp.value = name;
          box.classList.add("done");
          say.textContent = "찾았습니다";
        } else {
          box.classList.add("miss");
          say.textContent = data.채움 ? "서지는 채웠지만 지은이는 못 얻었습니다" : "못 찾았습니다";
        }
      } catch (err) {
        box.classList.add("miss");
        say.textContent = String(err.message || err).slice(0, 60);
      }
      ask.disabled = false;
      drawGauge();
    }
    async function saveName(row) {
      const { b, el: box, say, inp } = row;
      const v = inp.value.trim();
      if (!v || v === (b.author || "")) return;
      try {
        await db.updateBook(b.id, { author: v });
        b.author = v;
        box.classList.add("done");
        say.textContent = "적었습니다";
        await window.PostLibrosRefresh?.();
      } catch (err) {
        box.classList.add("miss");
        say.textContent = "적지 못했습니다";
        console.error("[이름 없는 책] 적지 못했습니다:", err);
      }
    }
    /* ── 여백에 한 줄씩 ──
       읽었는데 아무 말도 남기지 않은 책들. 한 권씩 서표를 열어 적으려면
       스물여섯 번을 오가야 하므로, 한 화면에 늘어놓고 적게 한다. */
    el("mg-load").addEventListener("click", async () => {
      const out = el("mg-out"), host = el("mg-list");
      out.innerHTML = `<p class="enrich-msg">읽은 책을 세는 중…</p>`;
      host.innerHTML = "";
      let books = [];
      try {
        const all = await db.syncBooks();
        books = all.filter((b) => b.read_status === "읽음" && !(b.memo && b.memo.trim()));
      } catch (err) {
        out.innerHTML = `<p class="enrich-msg bad"></p>`;
        out.querySelector("p").textContent = "부르지 못했습니다 — " + (err.message || err);
        return;
      }
      if (!books.length) {
        out.innerHTML = `<p class="enrich-msg good">읽은 책마다 여백에 한 줄이 있습니다.</p>`;
        return;
      }
      out.innerHTML = `<p class="enrich-msg"></p>`;
      out.querySelector("p").textContent =
        `${books.length.toLocaleString()}권 — 한 줄이면 됩니다. 자리를 옮기면 저장됩니다`;
      books.forEach((b) => {
        const box = document.createElement("div");
        box.className = "nmrow mgrow";
        box.innerHTML = `<b></b>
          <input type="text" placeholder="무엇이 남았는지 · 누구에게 권할지" aria-label="여백의 기록">
          <span class="nmsay"></span>`;
        box.querySelector("b").textContent = b.title + (b.author ? ` — ${b.author}` : "");
        const input = box.querySelector("input");
        const say = box.querySelector(".nmsay");
        input.addEventListener("blur", async () => {
          const memo = input.value.trim();
          if (!memo || memo === (b.memo || "")) return;
          say.textContent = "적는 중…";
          try {
            await db.updateBook(b.id, { memo });
            b.memo = memo;
            say.textContent = "적었습니다";
            box.classList.add("done");
            await window.PostLibrosRefresh?.();
          } catch (err) {
            say.textContent = "적지 못했습니다 — " + (err.message || err);
          }
        });
        host.appendChild(box);
      });
    });

    el("nm-load").addEventListener("click", async () => {
      const out = el("nm-out"), host = el("nm-list");
      out.innerHTML = `<p class="enrich-msg">이름 없는 책을 세는 중…</p>`;
      host.innerHTML = "";
      nmRows = [];
      let books = [];
      try { books = await db.listAuthorless(200); }
      catch (err) {
        out.innerHTML = `<p class="enrich-msg bad"></p>`;
        out.querySelector("p").textContent = "부르지 못했습니다 — " + (err.message || err);
        return;
      }
      if (!books.length) {
        out.innerHTML = `<p class="enrich-msg good">모든 책에 지은이가 있습니다.</p>`;
        el("nm-askall").hidden = true;
        return;
      }
      out.innerHTML = `<p class="enrich-msg"></p>`;
      out.querySelector("p").textContent =
        `${books.length.toLocaleString()}권 — 아는 이름은 적고 자리를 옮기면 저장됩니다`;
      el("nm-askall").hidden = false;
      books.forEach((b) => {
        const box = document.createElement("div");
        box.className = "nmrow";
        box.innerHTML = `<b></b>
          <input type="text" placeholder="지은이" aria-label="지은이">
          <button type="button" class="nmask">알라딘에 묻는다</button>
          <span class="nmsay"></span>`;
        box.querySelector("b").textContent = b.title;
        const row = {
          b, el: box,
          inp: box.querySelector("input"),
          ask: box.querySelector(".nmask"),
          say: box.querySelector(".nmsay"),
        };
        row.inp.value = b.author || "";
        row.ask.addEventListener("click", () => askOne(row));
        row.inp.addEventListener("change", () => saveName(row));
        row.inp.addEventListener("keydown", (e) => {
          if (e.key === "Enter") { e.preventDefault(); row.inp.blur(); }
        });
        nmRows.push(row);
        host.appendChild(box);
      });
    });
    let nmStop = false;
    el("nm-askall").addEventListener("click", async () => {
      const btn = el("nm-askall"), out = el("nm-out");
      if (btn.dataset.running) { nmStop = true; btn.textContent = "멈추는 중…"; return; }
      btn.dataset.running = "1"; btn.textContent = "멈춘다"; nmStop = false;
      // 아직 이름이 없는 줄만, 한 번에 스무 권까지 — 호출을 아낀다
      const todo = nmRows.filter((r) => !r.inp.value.trim()).slice(0, 20);
      for (let i = 0; i < todo.length; i++) {
        if (nmStop) break;
        out.innerHTML = `<p class="enrich-msg"></p>`;
        out.querySelector("p").textContent =
          `묻는 중… ${i + 1} / ${todo.length} — 「${todo[i].b.title}」`;
        await askOne(todo[i]);
      }
      const got = todo.filter((r) => r.inp.value.trim()).length;
      const left = nmRows.filter((r) => !r.inp.value.trim()).length;
      out.innerHTML = `<p class="enrich-msg ${got ? "good" : "bad"}"></p>`;
      out.querySelector("p").textContent =
        `${got}권의 이름을 찾았습니다`
        + (left ? ` · 아직 ${left}권 남음 — 한 번 더 누르면 이어 묻습니다` : "");
      if (got) await window.PostLibrosRefresh?.();
      delete btn.dataset.running;
      btn.textContent = "보이는 책을 모두 물어본다";
    });

    /* ── 알라딘 계기판 ────────────────────────────────────────
       하루 호출 한도는 5,000건이고, 넘기면 키가 통째로 막혀 그날 하루의
       서지 채우기가 전부 죽는다 (2026-09-01 에 한 번 겪었다). 그런데 남은
       여유를 알려 주는 창구가 없어, 얼마나 썼는지 모르는 채로 계속 누르게
       된다. 오늘 물어본 권수로 호출 수를 어림해 눈금으로 세운다.
       — 다만 권당 호출 수는 회차마다 다르다(조회 1회 + 사다리 1~3회, 사이트·구글
       까지 내려가면 더). 그래서 눈금은 「최소 이만큼은 썼다」는 바닥값일 뿐이고,
       진짜 답은 알라딘에게 직접 묻는다. 어림이 여유롭다고 말하는데 실제로는
       막혀 있는 일이 실제로 있었다 (2026-09-01: 어림 1,198 / 실제 차단). */
    const DAY_CAP = 5000, CALLS_PER_BOOK = 2.5;
    let aladinBlocked = false;
    async function drawGauge(ask = false) {
      const box = el("in-gauge"), num = el("in-gauge-n"), bar = el("in-gauge-bar");
      if (!box) return false;
      let tried = 0;
      try { tried = await db.countTriedToday(); }
      catch { box.hidden = true; return false; }
      const calls = Math.round(tried * CALLS_PER_BOOK);
      const pct = Math.min(100, calls / DAY_CAP * 100);
      // 알라딘에게 직접 묻는 것은 호출 한 번을 쓴다 — 열 때와 회차 끝에만
      if (ask) {
        try {
          const { alive, why } = await db.aladinAlive();
          aladinBlocked = !alive;
          box.dataset.why = why || "";
        } catch { /* 못 물었으면 판단을 보류한다 */ }
      }
      box.hidden = false;
      box.classList.toggle("warn", aladinBlocked || pct >= 80);
      num.textContent =
        `오늘 ${tried.toLocaleString()}권 물어봄 · 호출 최소 ${calls.toLocaleString()}회 (한도 ${DAY_CAP.toLocaleString()})`
        + (aladinBlocked
          ? ` · 알라딘이 막혔습니다${box.dataset.why ? ` — ${box.dataset.why}` : ""}`
          : "");
      bar.style.width = (aladinBlocked ? 100 : pct).toFixed(1) + "%";
      [el("in-enrich"), el("in-genre")].forEach((btn) => {
        if (!btn || btn.dataset.running) return;
        // 막혔으면 단추를 잠근다 — 더 눌러 봐야 헛돌기만 한다
        btn.disabled = aladinBlocked;
        btn.title = aladinBlocked
          ? "알라딘이 지금 응답을 거부합니다 — 자정(한국 시간)이 지나면 대개 풀립니다"
          : "";
      });
      return aladinBlocked;
    }
    drawGauge(true);

    /* ── 서재의 건강 상태 ──────────────────────────────────
       1년 뒤에 돌아왔을 때 「무엇부터 하지」를 매번 세어 보지 않아도 되게.
       빈 칸을 숫자로 세우고, 줄마다 그것을 채우는 자리로 데려다준다.
       순서는 값이 큰 것부터가 아니라 **싼 것 먼저**다 — 알라딘 하루 한도가
       있어서, 비싼 회차를 먼저 돌리면 싼 회차가 그날 못 돈다. */
    async function drawHealth() {
      const rows = el("hl-rows"), sub = el("hl-sub");
      if (!rows) return;
      let h;
      try { h = await db.healthCounts(); }
      catch (e) { sub.textContent = "세지 못했습니다 — " + (e?.message || e); return; }

      const pct = (a, b) => (b ? Math.round(a / b * 100) : 0);
      const 할일 = [
        {
          nm: "갈래", 있음: h.갈래, 전체: h.전체,
          말: "문학 벽의 단을 가르는 값입니다 — 없으면 483권이 이름표 없는 한 덩어리로 섭니다",
          값: "알라딘 조회 권당 1회 — 가장 쌉니다", 어디: "in-genre",
        },
        {
          nm: "서지", 있음: h.서지, 전체: h.전체,
          말: "ISBN·쪽수·크기·표지·펴낸곳. 표지도 판형 지도도 여기서 나옵니다",
          값: "알라딘 조회 권당 2~3회", 어디: "in-enrich",
        },
        {
          nm: "지은이", 있음: h.전체 - h.이름없음, 전체: h.전체,
          말: "서가에 「지은이 미상」으로 서 있는 책들 — 방문자가 보는 얼굴입니다",
          값: "아는 이름은 손으로 적는 편이 빠릅니다", 어디: "nm-load",
        },
        {
          nm: "실물 책등", 있음: h.책등조각, 전체: h.전체,
          말: h.오릴것
            ? `자리 상자를 받은 ${h.오릴것}권이 오려지기를 기다립니다`
            : `자리 상자가 한 권도 없습니다 — 사진 ${h.사진}장을 다시 읽어야 생깁니다`,
          값: h.오릴것 ? "비용 없음 — 사진과 상자만 씁니다" : "AI 호출, 사진당",
          어디: h.오릴것 ? "in-spines" : "in-shelfroll",
        },
        {
          nm: "기록", 있음: h.기록, 전체: h.전체,
          말: "방문자가 서표를 열었을 때 읽을 것이 있는지",
          값: "AI 호출, 권당", 어디: "in-summarize",
        },
        {
          nm: "이음의 까닭", 있음: h.까닭, 전체: h.이음,
          말: h.이음
            ? "화살표에 한마디가 붙어야 항로도가 항로도가 됩니다 — 서표의 이음 줄에서"
            : "아직 이어 둔 책이 없습니다",
          값: "사람만 쓸 수 있습니다", 어디: null,
        },
        {
          nm: "여백의 메모", 있음: h.메모, 전체: h.읽음,
          말: h.읽고메모없음
            ? `읽은 책 ${h.읽음}권 중 ${h.읽고메모없음}권에 아직 한 줄도 없습니다 — 이 서재에서 AI 가 대신 못 쓰는 유일한 칸입니다`
            : "읽은 책마다 한 줄이 있습니다",
          값: "사람만 쓸 수 있습니다", 어디: "mg-load",
        },
      ];

      const 빈칸 = 할일.filter((t) => t.있음 < t.전체);
      sub.textContent = 빈칸.length
        ? `${h.전체.toLocaleString()}권 · 채울 곳 ${빈칸.length}군데 — 위에서부터 하시면 됩니다`
        : `${h.전체.toLocaleString()}권 · 빈 칸이 없습니다`;

      rows.innerHTML = "";
      할일.forEach((t) => {
        const p = pct(t.있음, t.전체);
        const row = document.createElement("div");
        row.className = "hlrow" + (t.있음 >= t.전체 ? " done" : p < 25 ? " thin" : "");
        row.innerHTML = `
          <div class="hlname"><b></b><span class="hlnum"></span></div>
          <i class="hlbar"><b style="width:${p}%"></b></i>
          <p class="hlsay"></p>
          <p class="hlcost"></p>`;
        row.querySelector("b").textContent = t.nm;
        row.querySelector(".hlnum").textContent =
          `${t.있음.toLocaleString()} / ${t.전체.toLocaleString()} · ${p}%`;
        row.querySelector(".hlsay").textContent = t.말;
        row.querySelector(".hlcost").textContent = t.값;
        if (t.어디 && t.있음 < t.전체) {
          const go = document.createElement("button");
          go.type = "button";
          go.className = "hlgo";
          go.textContent = "여기서 채운다 →";
          go.addEventListener("click", () => {
            const target = el(t.어디) || el("intake");
            target.scrollIntoView({ behavior: "smooth", block: "center" });
            // 어느 단추를 누르라는 것인지 잠깐 빛나게 한다
            target.classList.add("pointed");
            setTimeout(() => target.classList.remove("pointed"), 2400);
            if (typeof target.focus === "function") target.focus({ preventScroll: true });
          });
          row.appendChild(go);
        }
        rows.appendChild(row);
      });
    }
    drawHealth();
    window.PostLibrosHealth = drawHealth;
    /* 어떤 회차든 끝나면 서가를 다시 싣는다 — 그 길목 하나만 잡으면
       단추마다 「끝났으니 다시 세라」를 적어 넣지 않아도 된다 */
    const 원래새로고침 = window.PostLibrosRefresh;
    window.PostLibrosRefresh = async (...a) => {
      const r = await 원래새로고침?.(...a);
      drawHealth().catch(() => {});
      return r;
    };

    /* 서지 채우기 — 알라딘에 물어 빈 칸을 메운다.
       장서 전체를 스무 권씩 수십 번 누르게 할 수는 없다. 한 번 누르면
       남은 것이 없을 때까지 스스로 돌고, 언제든 멈출 수 있다. */
    let enrichStop = false;
    el("in-enrich").addEventListener("click", async () => {
      const btn = el("in-enrich"), out = el("in-enrich-out");
      if (btn.dataset.running) { enrichStop = true; btn.textContent = "멈추는 중…"; return; }

      btn.dataset.running = "1";
      btn.textContent = "멈춘다";
      enrichStop = false;
      let 채움 = 0, 못찾음 = 0, 겹침 = 0, 회 = 0;
      const 고침 = [], 살펴볼것 = [];

      const draw = (head, cls = "") => {
        const lines = [`<p class="enrich-msg ${cls}"></p>`];
        if (고침.length) {
          lines.push(`<p class="enrich-msg">바로잡은 지은이</p><ul class="enrich-list">` +
            고침.map((c) => `<li>${esc(c.제목)} — ${esc(c.지은이전)} → <b>${esc(c.지은이후)}</b></li>`).join("") + `</ul>`);
        }
        if (살펴볼것.length) {
          lines.push(`<p class="enrich-msg">제목이 조금 다릅니다 — 맞는지 보고 서표에서 고치세요</p><ul class="enrich-list">` +
            살펴볼것.map((s) => `<li>${esc(s.지금)} <i>(알라딘: ${esc(s.알라딘)})</i></li>`).join("") + `</ul>`);
        }
        out.innerHTML = lines.join("");
        out.querySelector("p").textContent = head;
      };

      draw("알라딘에 묻는 중… (스무 권에 1분쯤)");
      let lastRemain = -1;
      while (!enrichStop) {
        회++;
        const { data, error } = await db.enrichBooks(20);
        if (error || data?.error) {
          draw("채우다 멈췄습니다 — " + (data?.error || error.message)
               + ` (여기까지 ${채움}권)`, "bad");
          break;
        }
        // 돌았는데 줄지 않았다 — 통신이 계속 어긋나는 것이니 헛돌지 않는다
        if (data.남음 === lastRemain && !data.채움) {
          draw(`앞으로 나아가지 못해 멈췄습니다 — ${채움}권 채움 · ${data.남음}권 남음. 잠시 뒤 다시 눌러 보세요.`, "bad");
          break;
        }
        lastRemain = data.남음;
        채움 += data.채움; 못찾음 += data.못찾음; 겹침 += data.겹침;
        고침.push(...(data.고침 || []));
        살펴볼것.push(...(data.살펴볼것 || []));
        await window.PostLibrosRefresh?.();
        // 회차마다 알라딘에게 직접 묻는다 — 막히는 순간 스스로 멈춘다
        if (await drawGauge(true)) {
          draw(`알라딘이 응답을 거부하기 시작했습니다 — 여기까지 ${채움}권. 자정(한국 시간)이 지나면 이어서 채울 수 있습니다.`, "bad");
          break;
        }
        if (!data.남음) { draw(`다 채웠습니다 — ${채움}권 · 못 찾음 ${못찾음} · 겹침 ${겹침}`, "good"); break; }
        draw(`${회}번째 — 지금까지 ${채움}권 · 못 찾음 ${못찾음} · 겹침 ${겹침} · 아직 ${data.남음}권 남음`);
        if (enrichStop) { draw(`멈췄습니다 — ${채움}권 채움 · 아직 ${data.남음}권 남음`, "good"); break; }
      }

      delete btn.dataset.running;
      btn.textContent = "끝까지 채운다";
      drawGauge(true);
    });

    /* 손으로 한 권 — AI 가 놓쳤거나 사진에 없는 책 */
    el("in-byhand").addEventListener("submit", async (e) => {
      e.preventDefault();
      const title = el("bh-title").value.trim();
      if (!title) return;
      const author = el("bh-author").value.trim();
      const category = el("bh-cat").value;
      const msg = el("bh-msg");
      const go = e.target.querySelector(".byhand-go");

      go.disabled = true;
      msg.textContent = "꽂는 중…";
      msg.className = "byhand-msg";
      try {
        await db.addBook({
          title, author: author || null, category,
          wall: WALL_OF[category] || "문학",
        });
        el("bh-title").value = "";
        el("bh-author").value = "";
        msg.textContent = "꽂았습니다.";
        msg.className = "byhand-msg good";
        await window.PostLibrosRefresh?.();
      } catch (err) {
        // 23505 = 이미 같은 책이 있다 (DB 가 막는다)
        const dup = err.code === "23505" || /duplicate|unique/i.test(err.message || "");
        msg.textContent = dup ? "이미 꽂혀 있는 책입니다." : "꽂지 못했습니다 — " + (err.message || err);
        msg.className = "byhand-msg bad";
      } finally {
        go.disabled = false;
      }
    });

    // 주인이 들어온 뒤에야 사진 목록을 읽을 수 있다
    db.client.auth.onAuthStateChange((_e, session) => {
      if (session?.user) renderShelf();
    });
    db.currentUser().then((u) => { if (u) renderShelf(); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
