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
      <span class="intake-hint">한 번에 여러 장 — 같은 칸을 찍은 사진끼리 올리면 정리가 쉽습니다</span>
    </div>
    <button type="button" class="dropzone" id="in-drop">
      <span class="dz-mark">▚</span>
      <b>사진을 여기 놓거나, 눌러서 고른다</b>
      <span class="dz-sub">3000px 를 넘는 사진만 줄여서 보관합니다 — 책등 글씨는 남깁니다</span>
    </button>
    <input type="file" id="in-file" accept="image/*" multiple hidden>
    <ul class="intake-queue" id="in-queue"></ul>
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
        <button class="phread">${done ? "다시 읽는다" : "책등을 읽는다"}</button>
        <p class="phnote">${p.note ? p.note : ""}</p>`;
      grid.appendChild(card);

      card.querySelector(".phread").addEventListener("click", async (ev) => {
        const btn = ev.currentTarget;
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
