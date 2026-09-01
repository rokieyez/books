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
  const WALLS = ["역사", "문학", "과학", "예술사회"];
  /* 분류가 곧 벽이다 — Edge Function 의 wallFor, DB 의 wall_for_category 와 같은 규칙 */
  const WALL_OF = { 역사: "역사", 문학: "문학", 과학: "과학", 예술: "예술사회", 사회: "예술사회" };

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
      </select>
      <button type="submit" class="byhand-go">꽂는다</button>
      <span class="byhand-msg" id="bh-msg"></span>
    </form>

    <div class="enrich">
      <div class="enrich-head">
        <b>서지를 채운다</b>
        <span>알라딘에 물어 ISBN·출판사·표지·분류를 넣고 지은이 오탈자를 바로잡습니다</span>
      </div>
      <button type="button" class="enrich-go" id="in-enrich">20권씩 채운다</button>
      <div class="enrich-out" id="in-enrich-out"></div>
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

    /* 서지 채우기 — 알라딘에 물어 빈 칸을 메운다 */
    el("in-enrich").addEventListener("click", async () => {
      const btn = el("in-enrich"), out = el("in-enrich-out");
      btn.disabled = true;
      out.innerHTML = `<p class="enrich-msg">알라딘에 묻는 중… (20권이면 1분쯤)</p>`;
      const { data, error } = await db.enrichBooks(20);
      btn.disabled = false;

      if (error || data?.error) {
        out.innerHTML = `<p class="enrich-msg bad"></p>`;
        out.querySelector("p").textContent = "채우지 못했습니다 — " + (data?.error || error.message);
        return;
      }

      const lines = [`<p class="enrich-msg good">${data.채움}권을 채웠습니다 · 못 찾음 ${data.못찾음} · 겹침 ${data.겹침} · 아직 ${data.남음}권 남음</p>`];
      if (data.고침?.length) {
        lines.push(`<p class="enrich-msg">바로잡은 지은이</p><ul class="enrich-list">` +
          data.고침.map((c) => `<li>${esc(c.제목)} — ${esc(c.지은이전)} → <b>${esc(c.지은이후)}</b></li>`).join("") + `</ul>`);
      }
      if (data.살펴볼것?.length) {
        lines.push(`<p class="enrich-msg">제목이 조금 다릅니다 — 맞는지 보고 서표에서 고치세요</p><ul class="enrich-list">` +
          data.살펴볼것.map((s) => `<li>${esc(s.지금)} <i>(알라딘: ${esc(s.알라딘)})</i></li>`).join("") + `</ul>`);
      }
      out.innerHTML = lines.join("");
      await window.PostLibrosRefresh?.();
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
