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
  const WALL_OF = { 역사: "역사", 문학: "문학", 과학: "과학", 예술: "예술사회", 사회: "예술사회", 종교: "종교" };
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
      <button type="button" class="enrich-go" id="in-enrich">끝까지 채운다</button>
      <div class="enrich-out" id="in-enrich-out"></div>
    </div>

    <div class="enrich">
      <div class="enrich-head">
        <b>기록을 한꺼번에 짓는다</b>
        <span>읽음으로 표시한 책 중 기록이 없는 것만 — 한 번에 서른 권까지, 권마다 비용이 듭니다</span>
      </div>
      <button type="button" class="enrich-go" id="in-summarize">읽은 책의 기록을 짓는다</button>
      <div class="enrich-out" id="in-summarize-out"></div>
    </div>

    <div class="enrich">
      <div class="enrich-head">
        <b>장서를 베껴 둔다</b>
        <span>1,300권을 한 곳에만 두지 않습니다 — 지금 꽂힌 그대로를 파일로 내려받습니다</span>
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

        /* 이미 읽은 사진을 다시 읽으면 같은 책이 한 번 더 꽂힌다.
           되돌리기가 없으므로 한 번 더 묻는다 — 실수로 눌렀을 때
           빠져나갈 자리를 준다. */
        if (btn.classList.contains("again") && !btn.dataset.sure) {
          btn.dataset.sure = "1";
          btn.classList.add("warn");
          btn.textContent = "정말? 같은 책이 또 꽂힙니다";
          setTimeout(() => {
            if (!btn.dataset.sure) return;
            delete btn.dataset.sure;
            btn.classList.remove("warn");
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
        const rows = await db.listBooks({ limit: 5000 });
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
          db.listBooks({ limit: 5000 }),
          db.listSummarizedIds(),
        ]);
        const have = new Set(haveIds);
        const todo = rows.filter((r) => r.read_status === "읽음" && !have.has(r.id)).slice(0, 30);
        const left = rows.filter((r) => r.read_status === "읽음" && !have.has(r.id)).length - todo.length;
        if (!todo.length) {
          out.innerHTML = `<p class="enrich-msg good">읽음 책의 기록이 모두 있습니다.</p>`;
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

    /* 서지 채우기 — 알라딘에 물어 빈 칸을 메운다.
       1,300권을 스무 권씩 예순다섯 번 누르게 할 수는 없다. 한 번 누르면
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
        if (!data.남음) { draw(`다 채웠습니다 — ${채움}권 · 못 찾음 ${못찾음} · 겹침 ${겹침}`, "good"); break; }
        draw(`${회}번째 — 지금까지 ${채움}권 · 못 찾음 ${못찾음} · 겹침 ${겹침} · 아직 ${data.남음}권 남음`);
        if (enrichStop) { draw(`멈췄습니다 — ${채움}권 채움 · 아직 ${data.남음}권 남음`, "good"); break; }
      }

      delete btn.dataset.running;
      btn.textContent = "끝까지 채운다";
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
