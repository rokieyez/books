/* 화면 렌더와 상호작용 */
/* ── 벽 렌더 ──────────────────────────────────────────── */
  function q() { return $("q").value.trim().toLowerCase(); }
  function anyOpen() { return !!document.querySelector(".wallsec.open"); }
  function syncBodyClass() { document.body.classList.toggle("door-open", anyOpen()); }

  /* 기록의 벽에 무언가를 들이는 자리 — 주인에게만 보인다.
     검색에 걸리지 않는 방이라는 세계관은 그대로 두고, 넣는 길만 연다. */
  function archiveForm() {
    const box = document.createElement("form");
    box.className = "leafadd";
    box.innerHTML = `
      <div class="leafadd-row">
        <select id="lf-kind" aria-label="종류">
          <option value="문서">문서</option>
          <option value="링크">링크</option>
          <option value="사진">사진</option>
        </select>
        <input type="text" id="lf-title" placeholder="제목" aria-label="제목" required>
      </div>
      <textarea id="lf-body" rows="2" placeholder="내용, 또는 주소(https://…)" aria-label="내용"></textarea>
      <div class="leafadd-row">
        <input type="text" id="lf-tags" placeholder="꼬리표 — 쉼표로 나눠서" aria-label="꼬리표">
        <button type="submit" class="leafadd-go">들인다</button>
      </div>
      <p class="leafadd-msg" id="lf-msg" hidden></p>`;

    box.addEventListener("submit", async (e) => {
      e.preventDefault();
      const kind = box.querySelector("#lf-kind").value;
      const title = box.querySelector("#lf-title").value.trim();
      const body = box.querySelector("#lf-body").value.trim();
      const tags = box.querySelector("#lf-tags").value
        .split(",").map(s => s.trim()).filter(Boolean);
      const msg = box.querySelector("#lf-msg");
      if (!title) return;

      const go = box.querySelector(".leafadd-go");
      go.disabled = true;
      msg.hidden = false;
      msg.textContent = "들이는 중…";
      try {
        // 주소처럼 생겼으면 url 칸에 넣는다 — 나중에 눌러 열 수 있게
        const isUrl = /^https?:\/\//i.test(body);
        await window.PostLibrosDB.addArchiveItem({
          kind, title, tags,
          body: isUrl ? null : (body || null),
          url: isUrl ? body : null,
        });
        box.reset();
        msg.textContent = "들였습니다.";
        await window.PostLibrosRefresh?.();
      } catch (err) {
        msg.textContent = "들이지 못했습니다 — " + (err.message || err);
        console.error("[기록] 들이지 못했습니다:", err);
      } finally {
        go.disabled = false;
      }
    });
    return box;
  }

  const wallEls = [];
  /* 키 순서 — 실물 높이 자료가 쌓이면 진짜 서가처럼 정돈해 볼 수 있다.
     새로고침해도 유지되도록 기억해 두되, 못 읽는 환경이면 그냥 꺼진 채로 산다. */
  let sortHeight = false;
  try { sortHeight = localStorage.getItem("pl-heightsort") === "1"; } catch { /* 사생활 모드 등 */ }

  /* 읽은 책만 걷는 길 — 스무 권 남짓이 이 서재에서 실제로 통과한 책이고,
     나머지는 아직 기다리는 책이다. 아무 데나 눌러 보는 사람은 대개 기다리는
     쪽을 만나므로, 통과한 쪽으로 가는 문을 따로 낸다.
     검색과 같은 층위의 거름망이라 모든 보기에 함께 걸린다. */
  let stFilter = null;                        /* "읽음" | "읽는 중" | null */
  const stPass = (b) => !stFilter || b.st === stFilter;
  /* 검색어와 거름망을 함께 통과해야 보인다 — 벽의 응답 수도 이 규칙을 쓴다 */
  /* 곁가지 거름망 — 「기록 있는 책만」·「표지 있는 것만」.
     읽음 거름망(stFilter)과 겹쳐 걸린다. 이것도 passes 하나를 통해야
     벽의 응답 수·표지·목록·항로도가 전부 같은 것을 본다. */
  let onlySummary = false, onlyCover = false;
  const sidePass = (b) =>
    (!onlySummary || summarized.has(b.id)) && (!onlyCover || !!b.cover);
  function passes(b) { return stPass(b) && sidePass(b) && (!q() || matchBook(b, q())); }
  function sifting() { return !!(q() || stFilter || onlySummary || onlyCover); }

  /* 벽 하나의 세 단을 어떻게 채울지 정한다.
     기본은 앞에서부터 스물둘씩 — 벽이 곧 한 갈래이므로 나눌 이유가 없다.
     다만 한 벽이 서재의 절반을 넘게 삼키면(문학이 그렇다) 그 벽만은
     갈래별로 단을 가른다. 갈래를 아는 책이 열 권도 안 되면 이름표를 달
     자격이 없으므로 그냥 예전처럼 스물둘씩 끊는다. */
  const SHELF_CAP = 22, SHELF_ROWS = 3;
  function shelfLines(shelved, w) {
    const flat = () => Array.from({ length: SHELF_ROWS }, (_, s) => ({
      label: null, books: shelved.slice(s * SHELF_CAP, (s + 1) * SHELF_CAP),
    }));
    const total = allBooks().length;
    // 서재의 40%를 넘게 가진 벽만 — 다른 벽은 나눌 만큼 두껍지 않다
    if (!total || (w.books?.length || 0) / total < 0.4) return flat();
    const known = shelved.filter((b) => b.genre);
    if (known.length < 10) return flat();

    const byGenre = new Map();
    known.forEach((b) => {
      if (!byGenre.has(b.genre)) byGenre.set(b.genre, []);
      byGenre.get(b.genre).push(b);
    });
    const tops = [...byGenre.entries()]
      .sort((x, y) => y[1].length - x[1].length)
      .slice(0, SHELF_ROWS);
    if (!tops.length) return flat();

    const lines = tops.map(([name, list]) => ({
      label: `${name} ${list.length.toLocaleString()}권`,
      books: list.slice(0, SHELF_CAP),
    }));
    // 남는 단이 있으면 갈래를 모르는 책들이 채운다 — 빈 널빤지를 두지 않는다
    if (lines.length < SHELF_ROWS) {
      const rest = shelved.filter((b) => !b.genre);
      if (rest.length) {
        lines.push({
          label: `아직 갈래를 모르는 ${rest.length.toLocaleString()}권`,
          books: rest.slice(0, SHELF_CAP),
        });
      }
    }
    return lines;
  }

  function renderWalls() {
    const host = $("walls"); host.innerHTML = "";
    wallEls.length = 0;
    syncBodyClass();
    const owner = document.body.classList.contains("owner");
    WALLS.forEach((w) => {
      /* 기록의 벽이 0엽인 채로 서 있으면, 방문자에게는 다섯째 벽이
         「눌러도 아무것도 없는 방」이 된다. 아직 아무것도 안 들인 동안에는
         방문자 화면에서 접어 둔다 — 주인에게는 늘 보인다(들일 자리니까). */
      if (w.cat === "archive" && !owner && !LEAVES.length) return;
      const sec = document.createElement("section");
      sec.className = "wallsec";
      wallEls.push({ el: sec, w });
      const hits = (w.cat !== "archive" && sifting())
        ? w.books.filter(passes).length : null;
      w.hits = hits;
      if (hits === 0) sec.style.opacity = ".4"; /* 검색에 응답 없는 벽은 어두워진다 */
      sec.innerHTML = `<div class="sec-label"><b></b><span class="desc"></span><span class="hits"></span></div>`;
      sec.querySelector("b").textContent = w.nm;
      sec.querySelector(".desc").textContent = w.desc;
      sec.querySelector(".hits").textContent =
        w.cat === "archive" ? `기록 ${w.n}엽` :
        (hits !== null ? `${hits}권 응답` : `${w.n}권`);
      const box = document.createElement("div"); box.className = "panelbox";

      const room = document.createElement("div"); room.className = "room";
      const lampEl = document.createElement("div"); lampEl.className = "roomlamp"; room.appendChild(lampEl);
      const frameEl = document.createElement("div"); frameEl.className = "wallframe"; room.appendChild(frameEl);
      if (w.cat === "archive") {
        room.insertAdjacentHTML("beforeend",
          `<h4>기록의 방</h4><p class="roomsub">책이 아닌 것들 — 문서, 사진, 링크</p>
           <div class="roommeta"><span>기록 ${LEAVES.length}엽</span><span>이 방은 검색에 걸리지 않는다</span></div>`);
        if (!LEAVES.length) {
          room.insertAdjacentHTML("beforeend",
            `<p class="statempty">아직 아무것도 들이지 않았습니다 — 문서·사진·링크가 여기 쌓입니다.
             <br><small>비어 있는 동안 이 벽은 방문자에게 보이지 않습니다.</small></p>`);
        }
        LEAVES.forEach(l => {
          const el = document.createElement("div"); el.className = "leafrow";
          el.innerHTML = `<span class="tp">${l.tp}</span><b></b><p></p>`;
          el.querySelector("b").textContent = l.t;
          el.querySelector("p").textContent = l.x;
          if (l.id && document.body.classList.contains("owner")) {
            const del = document.createElement("button");
            del.className = "leafdel";
            del.textContent = "버린다";
            del.setAttribute("aria-label", l.t + " 버리기");
            del.addEventListener("click", async (e) => {
              e.stopPropagation();
              if (!del.dataset.sure) {
                del.dataset.sure = "1";
                del.textContent = "정말?";
                setTimeout(() => {
                  if (!del.dataset.sure) return;
                  delete del.dataset.sure; del.textContent = "버린다";
                }, 3000);
                return;
              }
              try {
                await window.PostLibrosDB.removeArchiveItem(l.id);
                await window.PostLibrosRefresh?.();
              } catch (err) { console.error("[기록] 버리지 못했습니다:", err); }
            });
            el.appendChild(del);
          }
          room.appendChild(el);
        });
        if (document.body.classList.contains("owner")) room.appendChild(archiveForm());
      } else {
        room.insertAdjacentHTML("beforeend",
          `<h4>${w.nm} 뒤의 방</h4><p class="roomsub">이 벽의 안쪽 — 아껴 읽는 책들이 여기 산다</p>
           <div class="roommeta">
             <span>${w.n}권</span>
             <span class="meter">읽음 ${w.read}% <i><b style="width:${w.read}%"></b></i></span>
           </div>`);
        const inner = document.createElement("div"); inner.className = "innershelf";
        const line = document.createElement("div"); line.className = "shelfline";
        w.featured.forEach(b => {
          const el = document.createElement("button");
          el.className = "tome" + (b.paper ? " paper" : "");
          el.style.cssText = `background-color:${b.c};height:${Math.round(b.h*.85)}px;width:${Math.max(17, b.w2)}px;font-size:10.5px;`;
          if (b.spineImg) {
            el.classList.add("realspine");
            el.style.backgroundImage = `url("${b.spineImg}")`;
          } else {
            el.textContent = b.t;
          }
          el.title = `${b.t} — ${b.a}`;
          el.addEventListener("click", () => openExlibris(b, w));
          line.appendChild(el);
        });
        inner.appendChild(line);
        const pk = document.createElement("div"); pk.className = "plank"; inner.appendChild(pk);
        room.appendChild(inner);
        w.featured.slice(0, 6).forEach(b => {
          const el = document.createElement("button"); el.className = "bookplate";
          el.innerHTML = `<span class="sw" style="background:${b.c}"></span><b></b><span></span>`;
          el.querySelector("b").textContent = b.t;
          el.querySelector("span:last-child").textContent = b.a;
          el.addEventListener("click", () => openExlibris(b, w));
          room.appendChild(el);
        });
      }
      const shut = document.createElement("button"); shut.className = "shut";
      shut.textContent = "문을 닫는다";
      shut.addEventListener("click", () => { sec.classList.remove("open"); syncBodyClass(); });
      room.appendChild(shut);
      box.appendChild(room);

      const panel = document.createElement("div"); panel.className = "panel";
      const openDoor = () => { sec.classList.add("open"); syncBodyClass(); };
      if (w.cat === "archive") {
        /* 제목 없는 어두운 책들 — 문의 위장 */
        const prng = makeRng(999);
        for (let s = 0; s < 3; s++) {
          const line = document.createElement("div"); line.className = "shelfline";
          for (let k = 0; k < 22; k++) {
            const el = document.createElement("button"); el.className = "tome";
            const latch = s === 1 && k === 11;
            if (latch) el.classList.add("latch");
            el.style.cssText = `background-color:${latch ? "#77522A" : "#2E2418"};height:${80+Math.floor(prng()*30)}px;width:${13+Math.floor(prng()*10)}px;`;
            el.title = latch ? "…이 책만 튀어나와 있다" : "제목 없는 책";
            if (latch) {
              el.addEventListener("mouseenter", () => box.classList.add("leak"));
              el.addEventListener("mouseleave", () => box.classList.remove("leak"));
              el.addEventListener("focus", () => box.classList.add("leak"));
              el.addEventListener("blur", () => box.classList.remove("leak"));
            }
            el.addEventListener("click", (e) => { e.stopPropagation(); box.classList.remove("leak"); if (latch) openDoor(); });
            line.appendChild(el);
          }
          panel.appendChild(line);
          const pk = document.createElement("div"); pk.className = "plank"; panel.appendChild(pk);
        }
      } else {
        /* 벽에는 66권만 그려진다. 검색 중이면 응답한 책을 앞으로 끌어와
           찾는 책이 보이지 않는 뒷줄에 묻히지 않게 한다. */
        // 키 순서일 때는 실물 높이(없으면 어림값)로 줄을 세운다 — 검색 앞줄 규칙이 우선
        const base = sortHeight
          ? [...w.books].sort((x, y) => y.h - x.h || y.w2 - x.w2)
          : w.books;
        const shelved = sifting()
          ? [...base.filter(passes), ...base.filter(b => !passes(b))]
          : base;
        /* 걸쇠(비뚤어진 책)는 진짜 책의 자리를 빼앗지 않고 사이에 끼어든다 —
           예전에는 그 자리의 책 한 권이 서가에서 열 수 없게 가려졌다 */
        const makeLatch = () => {
          const el = document.createElement("button"); el.className = "tome latch";
          el.style.cssText = `background-color:#8A5A2E;height:${88 + (w.latchIdx % 20)}px;width:19px;`;
          el.title = "…이 책이 조금 이상하다";
          el.addEventListener("mouseenter", () => box.classList.add("leak"));
          el.addEventListener("mouseleave", () => box.classList.remove("leak"));
          el.addEventListener("focus", () => box.classList.add("leak"));
          el.addEventListener("blur", () => box.classList.remove("leak"));
          el.addEventListener("click", (e) => {
            e.stopPropagation(); box.classList.remove("leak"); openDoor();
          });
          return el;
        };
        /* 단을 어떻게 가를 것인가.
           보통은 그냥 스물둘씩 세 줄이다. 그런데 문학 벽에는 장서의 열에
           아홉이 몰려 있어, 한 줄이 무엇을 모아 둔 줄인지 말할 수 없다.
           갈래(genre)를 아는 책이 넉넉히 쌓이면 그 벽만 단을 갈래로 가른다 —
           소설 한 단, 고전 한 단, 에세이 한 단. 널빤지에 이름표가 붙는다. */
        /* 아직 한 권도 없는 벽 — 빈 널빤지 셋만 세워 두면 화면이 고장 난
           것처럼 보인다. 비어 있다는 사실을 말로 적어 둔다. */
        if (!w.books.length) {
          const none = document.createElement("p");
          none.className = "wallempty";
          /* 「비어 있습니다」로 끝내면 서재가 고장 난 것처럼 읽힌다.
             지금 책이 실제로 어디 모여 있는지까지 말해 준다. */
          const big = WALLS.filter((x) => x.cat !== "archive" && x.books?.length)
            .sort((a, x) => x.books.length - a.books.length)[0];
          none.textContent = "이 벽은 아직 비어 있습니다 — 문은 그대로 열립니다"
            + (big ? ` · 지금은 ${big.nm}에 ${big.books.length.toLocaleString()}권이 모여 있습니다` : "");
          panel.appendChild(none);
          // 걸쇠는 책등 사이에 끼어 있으므로, 책이 없으면 문고리도 사라진다.
          // 빈 벽에도 열 길을 남긴다
          const line = document.createElement("div");
          line.className = "shelfline";
          line.appendChild(makeLatch());
          panel.appendChild(line);
          const pk = document.createElement("div"); pk.className = "plank";
          panel.appendChild(pk);
        }
        const lines = w.books.length ? shelfLines(shelved, w) : [];
        lines.forEach(({ label, books }, s) => {
          const line = document.createElement("div"); line.className = "shelfline";
          books.forEach((b, k) => {
            const idx = s*22 + k;
            if (idx === w.latchIdx) line.appendChild(makeLatch());
            const el = document.createElement("button"); el.className = "tome";
            if (b.paper) el.classList.add("paper");
            if (b.lean) el.classList.add("lean");
            if (b.folio) el.classList.add("folio");
            if (sifting() && !passes(b)) el.classList.add("dim");
            // 들인 지 한 해가 넘도록 안 읽은 책에는 먼지가 앉는다 —
            // 오래 기다린 책이 눈에 띄어야 언젠가 뽑힌다
            const dusty = b.st === "안 읽음" && b.year
              && (new Date().getFullYear() - b.year) >= 1;
            if (dusty) el.classList.add("dusty");
            el.style.cssText = `background-color:${b.c};height:${b.h}px;width:${b.w2}px;`;
            // 사진에서 오려 낸 실물 책등이 있으면 그것을 입는다 — 글자는 그림 안에 이미 있다
            if (b.spineImg) {
              el.classList.add("realspine");
              el.style.backgroundImage = `url("${b.spineImg}")`;
            } else {
              el.textContent = b.t;
            }
            el.title = `${b.t} — ${b.a}` + (dusty ? " · 오래 기다린 책" : "");
            el.addEventListener("click", (e) => {
              e.stopPropagation();
              openExlibris(b, w);
            });
            line.appendChild(el);
          });
          panel.appendChild(line);
          const pk = document.createElement("div"); pk.className = "plank";
          if (label) {
            pk.classList.add("labeled");
            const tag = document.createElement("span");
            tag.className = "planklabel";
            tag.textContent = label;
            pk.appendChild(tag);
          }
          panel.appendChild(pk);
        });
      }
      box.appendChild(panel);
      sec.appendChild(box);
      host.appendChild(sec);
    });
    observeWalls();
    layoutLadder();
  }

  /* 스크롤 리빌 — 검색 중이거나 모션 최소화 설정이면 건너뛴다 */
  const noMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let wallIO = null;
  function observeWalls() {
    if (wallIO) wallIO.disconnect();
    if (noMotion || q() || !("IntersectionObserver" in window)) return;
    wallIO = new IntersectionObserver((entries) => {
      entries.forEach(en => {
        if (en.isIntersecting) {
          en.target.classList.remove("pre");
          en.target.classList.add("lit");
          wallIO.unobserve(en.target);
        }
      });
    }, { rootMargin: "0px 0px -8% 0px" });
    document.querySelectorAll(".wallsec").forEach((sec, i) => {
      const r = sec.getBoundingClientRect();
      if (r.top > innerHeight * .92) { sec.classList.add("pre"); wallIO.observe(sec); }
    });
  }
  /* ── 보기 전환: 서가 / 표지 / 목록 / 통계 ─────────────── */
  let curView = "walls";
  /* 궤짝 — 확신이 갈려 사람 손을 기다리는 책들.
     표본 화면에는 예시가 들어 있지만, 주인으로 들어오면 실제 후보로 갈아끼운다. */
  function renderCrate(list) {
    const box = document.querySelector(".cratebox");
    const label = $("crate-count");
    box.innerHTML = "";

    if (!list.length) {
      label.textContent = "비어 있음";
      // 마지막 확정으로 궤짝이 다 비었어도 결과 문구는 한 번 보여준다
      const msg = renderCrate._msg
        ? `<p class="note">${renderCrate._msg}</p>` : "";
      renderCrate._msg = null;
      box.innerHTML = msg
        + `<p class="note">궤짝이 비어 있습니다 — 확신이 갈리는 책이 생기면 여기 담깁니다.</p>`;
      return;
    }
    label.textContent = `${list.length}권 · 꽂을 곳을 정해주세요`;
    const note = document.createElement("p");
    note.className = "note";
    note.textContent = "책등은 읽었지만 어느 책인지 갈립니다 — 하나를 골라주세요.";
    box.appendChild(note);

    // 방금 한꺼번에 꽂은 결과 — 다시 그려도 한 번은 보여준다
    if (renderCrate._msg) {
      note.textContent = renderCrate._msg;
      renderCrate._msg = null;
    }

    /* 후보를 책으로 바꾼다 — 사진에 적어 둔 벽·단이 우선, 없으면 분류로 */
    const bookOf = (c, cand) => {
      const category = cand.category || "문학";
      const photo = c.intake_photos || {};
      return {
        title: cand.title, author: cand.author || null, category,
        wall: photo.wall || window.PostLibrosWallOf?.(category) || "문학",
        shelf: photo.shelf ?? null,
        // 궤짝에서 꽂아도 사진 속 자리를 잃지 않는다 — 실물 책등을 오릴 재료
        spine_photo_id: c.photo_id || null,
        spine_box: c.spine_box || null,
      };
    };

    /* 후보가 하나뿐인 책은 고를 것이 없다 — 실제 사진에서 궤짝의 거의 전부가
       이랬다 (85권 중 85권). 하나씩 누르게 하지 않고 한꺼번에 꽂는다.
       확신이 아주 낮은 것(0.6 미만)은 띠지·오독일 수 있어 손에 남긴다. */
    const easy = list.filter((c) =>
      (c.candidates || []).length === 1 && Number(c.confidence ?? 0) >= 0.6);
    if (easy.length > 1) {
      const bulk = document.createElement("button");
      bulk.className = "crate-bulk";
      bulk.textContent = `믿을 만한 ${easy.length}권을 한꺼번에 꽂는다 — 후보가 하나뿐인 책들`;
      bulk.addEventListener("click", async () => {
        bulk.disabled = true;
        let ok = 0, dup = 0, bad = 0;
        for (let i = 0; i < easy.length; i++) {
          bulk.textContent = `꽂는 중… ${i + 1} / ${easy.length}`;
          try {
            const r = await window.PostLibrosDB.resolveCandidate(
              easy[i].id, bookOf(easy[i], easy[i].candidates[0]));
            if (r?.dup) dup++; else ok++;
          } catch (err) { bad++; console.error("[궤짝] 꽂지 못했습니다:", err); }
        }
        renderCrate._msg = `${ok}권을 꽂았습니다`
          + (dup ? ` · 이미 꽂혀 있던 ${dup}권은 접었습니다` : "")
          + (bad ? ` · ${bad}권은 실패했습니다 — 남아 있습니다` : "")
          // 이 길로 꽂힌 책은 제목뿐이다 — 서지는 들이기의 채우기가 잇는다
          + (ok ? " · 서지는 사진 들이기의 「끝까지 채운다」로 채워집니다" : "");
        await window.PostLibrosRefresh?.();
        // 꽂힌 책들의 실물 책등을 이어서 오려 붙인다
        try { await window.PostLibrosCropSpines?.(); } catch (e) { console.error(e); }
      });
      box.appendChild(bulk);
    }

    /* 확신이 낮은 후보는 알라딘에 물어 확정한다 — 흐린 글씨라도 책은 진짜다.
       읽어낸 글자로 검색해 강하게 일치하면(0.75 이상) 알라딘 서지로 꽂는다.
       서버(Edge Function)가 20권씩 돌므로, 남은 것이 없어질 때까지 되돈다.
       못 정한 책은 대기로 남아 되돌아오므로, 진행이 없으면(확정+겹침 0) 멈춘다. */
    const hard = list.filter((c) => Number(c.confidence ?? 0) < 0.6);
    if (hard.length && window.PostLibrosDB?.confirmCrate) {
      const ask = document.createElement("button");
      ask.className = "crate-bulk";
      const idle = `알라딘에 물어 확정한다 — 흐린 ${hard.length}권`;
      ask.textContent = idle;
      ask.addEventListener("click", async () => {
        if (ask.dataset.running) { ask.dataset.stop = "1"; ask.textContent = "멈추는 중…"; return; }
        ask.dataset.running = "1";
        delete ask.dataset.stop;
        let sumOk = 0, sumDup = 0;
        try {
          for (let round = 1; round <= 20; round++) {
            ask.textContent = `묻는 중… ${round}번째 스무 권 (누르면 멈춥니다)`;
            const { data, error } = await window.PostLibrosDB.confirmCrate(20);
            if (error || data?.error) {
              renderCrate._msg = "묻지 못했습니다: " + (error?.message || data?.error);
              break;
            }
            sumOk += data?.확정 ?? 0;
            sumDup += data?.겹침 ?? 0;
            // 확정도 겹침도 없으면 남은 것은 전부 알라딘도 모르는 책 — 더 물어도 같다
            if (!(data?.확정 || data?.겹침) || !(data?.남음 > 0)) break;
            if (ask.dataset.stop) break;
          }
          renderCrate._msg = sumOk || sumDup
            ? `알라딘이 ${sumOk}권을 확정했습니다`
              + (sumDup ? ` · 이미 꽂혀 있던 ${sumDup}권은 접었습니다` : "")
              + " · 남은 것은 알라딘도 갈피를 못 잡은 책입니다"
            : "알라딘도 확정하지 못했습니다 — 남은 책은 손으로 골라주세요";
        } finally {
          delete ask.dataset.running;
          delete ask.dataset.stop;
          await window.PostLibrosRefresh?.();
          // 확정된 책들의 실물 책등을 이어서 오려 붙인다
          try { await window.PostLibrosCropSpines?.(); } catch (e) { console.error(e); }
        }
      });
      box.appendChild(ask);
    }

    list.forEach((c) => {
      const item = document.createElement("div");
      item.className = "crateitem";
      if (c.id) item.dataset.cid = c.id;   // 나중에 책등 조각을 곁들일 자리표
      const guess = document.createElement("span");
      guess.className = "guess";
      guess.textContent = `"${c.raw_text || "읽지 못함"}"`;
      // 확신도를 희미하게 — 얼마나 흐린 글씨였는지 알면 판단이 쉽다
      const conf = Number(c.confidence ?? 0);
      if (conf) {
        const cf = document.createElement("i");
        cf.className = "guessconf";
        cf.textContent = `확신 ${Math.round(conf * 100)}%`;
        guess.appendChild(cf);
      }
      const cands = document.createElement("div");
      cands.className = "cands";
      (c.candidates || []).forEach((cand) => {
        const btn = document.createElement("button");
        btn.className = "cand";
        btn.textContent = [cand.title, cand.author].filter(Boolean).join(" — ");
        btn.addEventListener("click", async () => {
          btn.disabled = true;
          try {
            const r = await window.PostLibrosDB.resolveCandidate(c.id, bookOf(c, cand));
            if (r?.dup) renderCrate._msg = "이미 꽂혀 있던 책이라 접었습니다 — 다른 사진에 두 번 찍힌 것입니다.";
            item.classList.add("resolved");
            await window.PostLibrosRefresh?.();
          } catch (err) {
            btn.disabled = false;
            console.error("[궤짝] 꽂지 못했습니다:", err);
          }
        });
        cands.appendChild(btn);
      });
      // 전부 틀렸을 때 — 책을 만들지 않고 궤짝에서 내린다
      const drop = document.createElement("button");
      drop.className = "cand drop";
      drop.textContent = "이 중에 없다 — 버린다";
      drop.addEventListener("click", async () => {
        if (!drop.dataset.sure) {
          drop.dataset.sure = "1";
          drop.textContent = "정말 버립니까?";
          setTimeout(() => {
            if (!drop.dataset.sure) return;
            delete drop.dataset.sure; drop.textContent = "이 중에 없다 — 버린다";
          }, 3000);
          return;
        }
        drop.disabled = true;
        try {
          await window.PostLibrosDB.dismissCandidate(c.id);
          item.classList.add("resolved");
          await window.PostLibrosRefresh?.();
        } catch (err) {
          drop.disabled = false;
          console.error("[궤짝] 버리지 못했습니다:", err);
        }
      });
      cands.appendChild(drop);
      // 알라딘도 자동으로는 못 정한 책 — 사람이 글자를 고쳐 다시 묻는다
      if (c.id && window.PostLibrosDB?.confirmCandidate) {
        const ask = document.createElement("div");
        ask.className = "candask";
        const inp = document.createElement("input");
        inp.type = "text";
        inp.value = c.raw_text || "";
        inp.setAttribute("aria-label", "알라딘에 물을 제목 — 고쳐서 다시 검색");
        const go = document.createElement("button");
        go.type = "button";
        go.className = "cand";
        go.textContent = "고쳐 묻는다";
        const fire = async () => {
          const q2 = inp.value.trim();
          if (!q2) return;
          go.disabled = true; inp.disabled = true;
          go.textContent = "묻는 중…";
          try {
            const { data, error } = await window.PostLibrosDB.confirmCandidate(c.id, q2);
            if (error || data?.error) throw new Error(data?.error || error.message);
            if (data.못정함) {
              go.textContent = "다시 묻는다";
              go.disabled = false; inp.disabled = false;
              guess.title = data.말;
              const note2 = document.createElement("i");
              note2.className = "guessconf";
              note2.textContent = data.말;
              guess.appendChild(note2);
              return;
            }
            renderCrate._msg = data.겹침
              ? `이미 꽂혀 있던 책이라 접었습니다 — ${data.제목}`
              : `알라딘이 확정했습니다 — ${data.제목}`;
            item.classList.add("resolved");
            await window.PostLibrosRefresh?.();
            try { await window.PostLibrosCropSpines?.(); } catch (e) { console.error(e); }
          } catch (err) {
            go.textContent = "다시 묻는다";
            go.disabled = false; inp.disabled = false;
            console.error("[궤짝] 검색으로 못 꽂았습니다:", err);
          }
        };
        go.addEventListener("click", fire);
        inp.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") { ev.preventDefault(); fire(); }
        });
        ask.append(inp, go);
        cands.appendChild(ask);
      }
      item.append(guess, cands);
      box.appendChild(item);
    });

    // 흐린 글자는 사람 눈이 최고다 — 사진 속 그 책등을 곁들여 보여준다
    decorateCrate(list, box).catch((e) => console.warn("[궤짝] 책등 조각을 못 붙였습니다:", e));
  }
  window.PostLibrosRenderCrate = renderCrate;

  /* 궤짝 항목마다 원본 사진에서 그 책등만 오려 곁들인다.
     자리 상자(spine_box, 0~1000 비율)와 사진 경로가 있을 때만.
     사진 한 장에 후보가 여럿이라, 서명 주소와 그림은 장마다 한 번만 받는다. */
  async function decorateCrate(list, box) {
    const db = window.PostLibrosDB;
    if (!db?.photoUrl) return;
    const withBox = list.filter((c) => c.spine_box && c.intake_photos?.storage_path && c.id);
    if (!withBox.length) return;

    const urls = new Map();
    for (const path of new Set(withBox.map((c) => c.intake_photos.storage_path))) {
      try { urls.set(path, await db.photoUrl(path)); }
      catch (e) { console.warn("[궤짝] 사진 열쇠를 못 받았습니다:", e); }
    }
    const imgs = new Map();
    const loadImg = (url) => new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = rej;
      im.src = url;
    });

    for (const c of withBox) {
      const el = box.querySelector(`.crateitem[data-cid="${c.id}"]`);
      if (!el) continue;   // 그새 화면이 다시 그려졌다
      const url = urls.get(c.intake_photos.storage_path);
      if (!url) continue;
      let im = imgs.get(url);
      if (!im) {
        try { im = await loadImg(url); imgs.set(url, im); } catch { continue; }
      }
      const bx = c.spine_box;
      const sx = bx.x / 1000 * im.naturalWidth, sy = bx.y / 1000 * im.naturalHeight;
      const sw = bx.w / 1000 * im.naturalWidth, sh = bx.h / 1000 * im.naturalHeight;
      if (sw < 2 || sh < 2) continue;
      const H = 96, W = Math.max(14, Math.min(64, Math.round(sw / sh * H)));
      const cv = document.createElement("canvas");
      cv.className = "cratecrop";
      cv.width = W * 2; cv.height = H * 2;   // 레티나에서도 글자가 뭉개지지 않게
      cv.style.width = W + "px"; cv.style.height = H + "px";
      cv.title = "사진 속 그 책등";
      cv.setAttribute("role", "img");
      cv.setAttribute("aria-label", "사진에서 오려 낸 책등 — " + (c.raw_text || "제목 미상"));
      cv.getContext("2d").drawImage(im, sx, sy, sw, sh, 0, 0, W * 2, H * 2);
      el.prepend(cv);
      el.classList.add("hascrop");
    }
  }

  /* 상단의 입고 수 — 표본이든 실제 장서든 지금 꽂혀 있는 만큼만 말한다.
     정해진 목표치는 없다: 서재는 계속 자라고, 일부만 옮겨 둘 수도 있다.
     막대는 목표 대비가 아니라 읽음 비율이다 — 상한 없이도 늘 의미가 있다. */
  function renderCensus() {
    // 벽이 스스로 밝힌 권수를 더한다. 화면에 그리는 책등은 그중 일부라
    // 그린 개수를 세면 벽 이름표(287권 …)와 어긋난다.
    const shelves = WALLS.filter(w => w.cat !== "archive");
    const n = shelves.reduce((s, w) => s + (w.n || 0), 0);
    const readPct = n
      ? shelves.reduce((s, w) => s + (w.n || 0) * (w.read || 0), 0) / n
      : 0;
    const num = $("census-n"), bar = $("census-bar");
    if (!num) return;
    const done = shelves.reduce((s, w) => s + (w.books || []).filter(b => b.st === "읽음").length, 0);
    num.textContent = stFilter ? `읽은 ${done.toLocaleString()}권`
      : n ? `${n.toLocaleString()}권 입고` : "아직 비어 있음";
    if (bar) bar.style.width = readPct.toFixed(1) + "%";
    const box = $("census");
    if (box) {
      box.setAttribute("aria-pressed", stFilter ? "true" : "false");
      box.title = !n ? ""
        : stFilter ? "누르면 서재 전체로 돌아갑니다"
          : `읽음 ${Math.round(readPct)}% — 누르면 읽어 낸 ${done.toLocaleString()}권만 남습니다`;
    }
    // 같은 문이 두 자리에 있다 — 위쪽 막대(넓은 화면)와 현관의 단추(좁은 화면)
    const rp = $("readpath");
    if (rp) {
      rp.setAttribute("aria-pressed", stFilter ? "true" : "false");
      rp.textContent = stFilter ? `읽은 ${done.toLocaleString()}권` : "읽은 책만";
      rp.hidden = !done;
    }
  }
  /* ── 현관의 첫 문장 ─────────────────────────────────────
     처음 들어온 사람이 만나는 문장이 「이 서재의 벽은 전부 책이다」로 끝나면
     여기가 살아 있는 서재인지 알 길이 없다. 오늘의 셈을 그대로 말한다.
     좁은 화면에서는 위쪽 셈 막대가 숨으므로, 이 줄이 그 자리를 대신한다. */
  function renderFoyerLine() {
    const el = $("foyerline");
    if (!el) return;
    const books = allBooks();
    if (!books.length) { el.textContent = ""; return; }
    const done = books.filter((b) => b.st === "읽음").length;
    const bits = [`${books.length.toLocaleString()}권이 서 있고, 그중 ${done.toLocaleString()}권을 읽어 냈습니다`];
    if (summarized.size) bits.push(`기록 ${summarized.size}편`);
    if (LINK_N) bits.push(`이음 ${LINK_N}개`);
    el.textContent = bits.join(" · ") + ".";
  }
  let LINK_N = 0;

  /* ── 지금 펼쳐 둔 책 ────────────────────────────────────
     읽는 중인 책은 책상 위에 쌓이는데, 책상은 벽 넷을 지나야 나온다.
     한 권이라도 있으면 현관에 걸어 둔다 — 이 서재가 지금 살아 있다는 표. */
  function renderNowOpen() {
    const btn = $("nowopen");
    if (!btn) return;
    const now = allBooks().filter((b) => b.st === "읽는 중");
    if (!now.length) { btn.hidden = true; return; }
    const b = now[0];
    btn.hidden = false;
    const at = b.bookmark ? ` · ${b.bookmark}쪽에 갈피` : "";
    btn.textContent = `지금 펼쳐 둔 책 — 「${b.t}」${at}`
      + (now.length > 1 ? ` 외 ${now.length - 1}권` : "");
    btn.onclick = () => openExlibris(b, bookWall(b));
  }

  /* ── 기록이 있는 책 ─────────────────────────────────────
     AI 가 지어 둔 기록은 서표를 열어야만 보인다. 520권 중 여섯 권뿐이라
     방문자가 우연히 만날 확률이 없다 — 서가·목록·표지에 표를 달고 걸러 낸다. */
  let summarized = new Set(), summariesAsked = false;
  async function loadSummarized() {
    const db = window.PostLibrosDB;
    if (summariesAsked || !db?.listSummarizedIds) return;
    summariesAsked = true;
    try {
      summarized = new Set(await db.listSummarizedIds());
      if (summarized.size) renderAll();   // 표식과 거름망이 이제야 그려진다
    } catch (e) { console.warn("[기록] 목록을 읽지 못했습니다:", e); }
  }

  /* 거름망을 켜고 끈다 — 모든 보기가 같은 규칙을 쓰므로 다시 그리기만 하면 된다 */
  function toggleReadPath() {
    stFilter = stFilter ? null : "읽음";
    if (curView === "walls") {
      // 벽은 접힌 채로 다시 그려지므로, 걸러 낸 결과가 보이도록 목록으로 안내한다
      const any = allBooks().some((b) => b.st === "읽음");
      if (stFilter && any) setView("list");
    }
    renderAll();
  }
  $("census")?.addEventListener("click", toggleReadPath);
  $("readpath")?.addEventListener("click", toggleReadPath);

  /* 곁가지 거름망 두 개 — 켜면 벽까지 함께 걸린다 */
  function syncSideBtns() {
    const s = $("sumonly"), c = $("coveronly");
    if (s) {
      s.hidden = !summarized.size;
      s.setAttribute("aria-pressed", onlySummary ? "true" : "false");
      s.textContent = onlySummary ? `기록 ${summarized.size}권` : "기록 있는 책만";
    }
    if (c) {
      const n = allBooks().filter((b) => b.cover).length;
      c.hidden = !n || n === allBooks().length;
      c.setAttribute("aria-pressed", onlyCover ? "true" : "false");
      c.textContent = onlyCover ? `표지 ${n.toLocaleString()}권` : "표지 있는 것만";
    }
  }
  $("sumonly")?.addEventListener("click", () => { onlySummary = !onlySummary; renderAll(); });
  $("coveronly")?.addEventListener("click", () => { onlyCover = !onlyCover; renderAll(); });

  /* 책상 위 오늘의 책 — 아직 열어보지 않은 책 중에서 날짜로 고른다.
     그냥 첫 권을 집으면 1,300권이 있어도 매일 같은 책이다.
     날짜를 씨앗으로 쓰면 하루 안에서는 늘 같은 책, 다음 날은 다른 책. */
  function renderToday() {
    const books = allBooks();
    // 읽다 만 책이 있으면 그 책이 먼저다 — 새 책은 그다음
    const reading = books.filter(b => b.st === "읽는 중");
    const unread = books.filter(b => b.st === "안 읽음");
    const pool = reading.length ? reading : (unread.length ? unread : books);
    const day = new Date().toISOString().slice(0, 10);
    let seed = 0;
    for (let i = 0; i < day.length; i++) seed = (seed * 31 + day.charCodeAt(i)) >>> 0;
    const pick = pool.length ? pool[seed % pool.length] : null;
    const t = $("today-title"), s = $("today-sub"), btn = $("today-open");
    if (!pick) {
      t.textContent = "책상이 비어 있다";
      s.textContent = "아직 꽂힌 책이 없습니다 — 사진을 들이는 것부터 시작합니다";
      btn.hidden = true;
      return;
    }
    btn.hidden = false;
    t.textContent = pick.t;
    const marks = [`오늘의 책 · ${pick.a}`];
    if (pick.st === "읽는 중") {
      marks.push(pick.bookmark
        ? `갈피 ${pick.bookmark.toLocaleString()}쪽${pick.pages ? " / " + pick.pages.toLocaleString() + "쪽" : ""}`
        : "읽는 중");
      // 멈춘 지 얼마나 됐는지 — 갈피를 꽂은 날이 남아 있을 때만
      const ago = agoOf(pick.bookmarkAt);
      if (pick.bookmark && ago) marks.push(ago + " 멈춤");
    } else if (pick.year) marks.push(pick.year + " 입고");
    s.textContent = marks.join(" · ");
    todayBook = pick;
    renderPile(books);
  }
  let todayBook = null;

  /* 며칠 전인지 사람 말로 — "오늘" "사흘 전" "3주 전" "두 달 전" */
  function agoOf(iso) {
    if (!iso) return null;
    const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    if (!Number.isFinite(d) || d < 0) return null;
    if (d === 0) return "오늘";
    if (d < 7) return `${d}일 전`;
    if (d < 30) return `${Math.floor(d / 7)}주 전`;
    if (d < 365) return `${Math.floor(d / 30)}달 전`;
    return `${Math.floor(d / 365)}년 전`;
  }

  /* 읽는 중인 책들이 책상 위에 실제로 쌓인다 — 눕힌 책등 더미.
     누르면 그 책의 서표가 열린다. 다섯 권까지만 — 책상이니까. */
  function renderPile(books) {
    const host = $("deskpile");
    if (!host) return;
    host.innerHTML = "";
    const reading = books.filter((b) => b.st === "읽는 중").slice(0, 5);
    if (!reading.length) return;
    reading.forEach((b) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "pilebook";
      el.style.background = b.c;
      // 눕힌 책의 길이는 실물 키를 따른다 — 더미가 들쭉날쭉해야 진짜 같다
      el.style.width = Math.round(Math.max(96, Math.min(150, b.h * 1.15))) + "px";
      el.textContent = b.t;
      el.title = `${b.t} — ${b.a}`
        + (b.bookmark ? ` · 갈피 ${b.bookmark.toLocaleString()}쪽` : "")
        + (agoOf(b.bookmarkAt) ? ` · ${agoOf(b.bookmarkAt)} 멈춤` : "");
      el.addEventListener("click", () => openExlibris(b, bookWall(b)));
      host.appendChild(el);
    });
  }

  function bookWall(b) { return WALLS.find(w => w.books && w.books.includes(b)); }
  function allBooks() { return WALLS.filter(w => w.books).flatMap(w => w.books); }
  /* 검색은 어느 뷰에서든 같은 규칙 — 제목·지은이에 출판사·ISBN 까지 */
  /* 검색이 닿는 곳 — 제목·지은이·펴낸곳·ISBN 만 보다가
     시리즈·분류·갈래·여백의 메모까지 넓혔다. 「신들의 사회」를 찾는 사람이
     시리즈 이름으로 찾고, 「추리」로 갈래를 훑을 수 있어야 한다. */
  function matchBook(b, query) {
    return [b.t, b.a, b.pub, b.isbn, b.series, b.cat, b.genre, b.memo]
      .filter(Boolean).join(" ").toLowerCase().includes(query);
  }
  window.PostLibrosMatch = matchBook;
  function filteredBooks() { return allBooks().filter(passes); }
  function setView(v) {
    curView = v;
    document.querySelectorAll(".viewseg button").forEach(b => {
      const on = b.dataset.v === v;
      b.setAttribute("aria-selected", on ? "true" : "false");
      // 탭 묶음은 Tab 키를 한 번만 먹는다 — 안에서는 ←/→ 로 옮겨 다닌다
      b.tabIndex = on ? 0 : -1;
    });
    $("walls").hidden = v !== "walls";
    $("crate").hidden = v !== "walls";
    $("desk").hidden = v !== "walls";
    const hs = $("heightsort");
    if (hs) hs.hidden = v !== "walls";
    $("v-covers").hidden = v !== "covers";
    $("v-list").hidden = v !== "list";
    $("v-stats").hidden = v !== "stats";
    if (v === "covers") renderCovers();
    if (v === "list") renderList();
    if (v === "stats") renderStats();
    syncFindNote();
    /* 보기도 주소에 남는다 — 「목록으로 봐」라고 링크를 건넬 수 있어야 한다.
       서표가 열려 있을 때는 그 주소가 우선이므로 건드리지 않는다. */
    const want = v === "walls" ? "" : "#" + v;
    if (!openBook && !location.hash.startsWith("#book/") && location.hash !== want) {
      // replaceState 는 hashchange 를 울리지 않는다 — 표는 해시를 실제로
      // 바꿀 때만 남긴다. 아니면 다음에 오는 진짜 뒤로 가기를 삼켜 버린다
      if (want) { hashSelf = true; location.hash = want; }
      else history.replaceState(null, "", location.pathname + location.search);
    }
    layoutLadder(); updateLadder();
  }
  document.querySelectorAll(".viewseg button").forEach(b => {
    b.addEventListener("click", () => setView(b.dataset.v));
  });
  /* 탭 묶음 안에서의 ←/→ — 키보드로만 다니는 사람은 이 길로 보기를 바꾼다.
     (서표가 열려 있을 때의 ←/→ 는 이웃 책 넘기기라 서로 겹치지 않는다) */
  document.querySelector(".viewseg")?.addEventListener("keydown", (e) => {
    const keys = { ArrowLeft: -1, ArrowRight: 1, Home: 0, End: 0 };
    if (!(e.key in keys)) return;
    const tabs = [...document.querySelectorAll(".viewseg button")];
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const j = e.key === "Home" ? 0
      : e.key === "End" ? tabs.length - 1
        : (i + keys[e.key] + tabs.length) % tabs.length;
    setView(tabs[j].dataset.v);
    tabs[j].focus();
  });

  /* 표지 뷰 — 표지는 그림이라 무겁다. 한 번에 다 깔지 않고,
     화면에 들어온 것만 실제로 내려받는다. */
  const COVER_STEP = 60;
  let coversShown = COVER_STEP;
  let coverIO = null;
  function lazyCover(el, url) {
    if (!("IntersectionObserver" in window)) { el.style.backgroundImage = `url("${url}")`; return; }
    if (!coverIO) {
      coverIO = new IntersectionObserver((ens) => {
        ens.forEach(en => {
          if (!en.isIntersecting) return;
          en.target.style.backgroundImage = `url("${en.target.dataset.cover}")`;
          coverIO.unobserve(en.target);
        });
      }, { rootMargin: "300px" });
    }
    el.dataset.cover = url;
    coverIO.observe(el);
  }

  function renderCovers() {
    const box = $("covergrid"); box.innerHTML = "";
    if (coverIO) { coverIO.disconnect(); coverIO = null; }
    const list = filteredBooks();
    list.slice(0, coversShown).forEach(b => {
      const el = document.createElement("button");
      el.className = "cover";
      el.style.setProperty("--cvr", b.c);
      /* 표지가 없는 책도 표지 뷰에서는 표지를 입는다 — 알라딘이 모르는 책이
         빈 색종이로만 서 있으면, 그 칸은 「없는 책」처럼 읽힌다. 천 색 위에
         테를 두르고 제목 첫 글자를 활자처럼 찍어 가짜 표지를 만든다. */
      el.innerHTML = `<i class="cvrframe" aria-hidden="true"><em></em><u></u></i><b></b><span></span>`;
      el.querySelector("b").textContent = b.t;
      el.querySelector("span").textContent = b.a;
      el.querySelector(".cvrframe em").textContent = (b.t || "?").trim()[0] || "?";
      el.querySelector(".cvrframe u").textContent = b.cat || "";
      // 알라딘에서 받아 온 진짜 표지가 있으면 그것을 깐다.
      // 표지는 없어도 실물 책등 조각이 있으면 — 그거라도 세워 둔다
      if (b.cover) {
        el.classList.add("hascover");
        lazyCover(el, b.cover);
      } else if (b.spineImg) {
        el.classList.add("hascover", "spinefill");
        lazyCover(el, b.spineImg);
      }
      el.addEventListener("click", () => openExlibris(b, bookWall(b)));
      box.appendChild(el);
    });
    const shown = Math.min(coversShown, list.length);
    $("cover-note").textContent = shown < list.length
      ? `— 등불이 닿는 ${shown.toLocaleString()}권까지 — 어둠 속에 ${(list.length - shown).toLocaleString()}권이 더 있다 —`
      : stFilter ? (list.length
        ? `이 서재가 읽어 낸 ${list.length.toLocaleString()}권${q() ? ` 중 "${$("q").value.trim()}"` : ""}`
        : "아직 읽어 낸 책이 없습니다.")
        : (q() ? `"${$("q").value.trim()}" — ${list.length}권 응답`
          : (list.length ? `${list.length.toLocaleString()}권 전부` : "아직 꽂힌 책이 없습니다."));
    const more = $("covermore");
    more.hidden = shown >= list.length;
    more.textContent = `등불을 옮긴다 (${(list.length - shown).toLocaleString()}권 남음)`;
  }

  /* 목록 뷰 */
  const STCOLOR = { "읽음": "var(--st-done)", "읽는 중": "var(--st-doing)", "안 읽음": "var(--st-todo)" };
  /* 목록은 이 서재를 통째로 훑는 유일한 자리다.
     1,300권을 스무 줄만 보여주면 나머지는 없는 것과 같아, 넉넉히 펼치고
     더 볼 수 있게 한다. 정렬도 여기서만 된다. */
  const LIST_STEP = 120;
  let listShown = LIST_STEP;
  let sortKey = null, sortAsc = true;

  const ST_ORDER = { "읽는 중": 0, "안 읽음": 1, "읽음": 2 };
  function sortedBooks() {
    const list = filteredBooks();
    if (!sortKey) return list;
    const val = (b) => sortKey === "st" ? (ST_ORDER[b.st] ?? 9)
      : sortKey === "year" ? (b.year ?? 0)
      // 읽은 해가 없는 책은 0 이 아니라 맨 뒤로 — 안 읽은 책이 앞줄을 차지하면
      // 「읽은 해로 정렬」이 아무 소용이 없다
      : sortKey === "ry" ? (b.readYear ?? (sortAsc ? 9999 : -1))
      : String(b[sortKey] ?? "");
    return [...list].sort((x, y) => {
      const a = val(x), b2 = val(y);
      const c = typeof a === "number" ? a - b2 : a.localeCompare(b2, "ko");
      return sortAsc ? c : -c;
    });
  }

  /* 시리즈 접기 — 「토지 1」…「토지 20」이 스무 줄을 차지하지 않게.
     제목 끝의 권수를 접고, 같은 밑동·지은이가 두 권 이상이면 시리즈로 본다.
     정렬이나 검색 중에는 접지 않는다 — 그때는 낱권이 답이다. */
  const SERIES_RE = /^(.*?)[\s·-]+(\d{1,3})$/;
  const expandedSeries = new Set();
  function seriesRows(list) {
    const groups = new Map(), order = [];
    list.forEach((b) => {
      /* 서표에서 손으로 적은 시리즈 이름이 우선이다 — 제목 꼴이 제각각인
         전집(「신들의 사회」 「빛의 왕」…)도 한 이름으로 묶을 수 있다.
         없으면 제목 끝 숫자 규칙(자동)이 그대로 일한다. */
      const m = b.t.match(SERIES_RE);
      const base = b.series || (m ? m[1].trim() : null);
      if (base) {
        const key = (b.series ? "손␟" + b.series : base + "␟" + b.a);
        if (!groups.has(key)) { groups.set(key, []); order.push({ g: key, base }); }
        groups.get(key).push(b);
      } else order.push({ b });
    });
    const rows = [];
    order.forEach((o) => {
      if (o.b) { rows.push(o); return; }
      const g = groups.get(o.g);
      if (g.length < 2) { rows.push({ b: g[0] }); return; }   // 한 권뿐이면 낱권이다
      rows.push({ series: o.g, base: o.base, books: g });
    });
    return rows;
  }

  function bookRow(b, sub) {
    const tr = document.createElement("tr");
    if (sub) tr.className = "subrow";
    const stLabel = b.st === "읽는 중" && b.bookmark
      ? `읽는 중 · ${b.bookmark.toLocaleString()}쪽` : b.st;
    /* 기록이 있는 책에는 표를 단다 — 520권 중 여섯 권이라 우연히는 못 만난다 */
    const mark = summarized.has(b.id) ? `<i class="hasrec" title="기록이 있는 책">✦</i>` : "";
    tr.innerHTML = `<td class="t"></td><td></td><td></td>
      <td><span class="st-dot" style="background:${STCOLOR[b.st]}"></span>${stLabel}</td>
      <td class="ry">${b.readYear ?? ""}</td>
      <td>${b.year ?? ""}</td><td></td>`;
    tr.children[0].innerHTML = mark;
    tr.children[0].append((sub ? "└ " : "") + b.t);
    tr.children[1].textContent = b.a;
    tr.children[2].textContent = b.cat;
    tr.children[6].textContent = b.loc;
    tr.addEventListener("click", () => openExlibris(b, bookWall(b)));
    return tr;
  }

  function seriesRow(r) {
    const open = expandedSeries.has(r.series);
    const read = r.books.filter((x) => x.st === "읽음").length;
    const tr = document.createElement("tr");
    tr.className = "seriesrow";
    tr.innerHTML = `<td class="t"><i class="fold">${open ? "▾" : "▸"}</i> <b></b> <span class="cnt">${r.books.length}권</span></td>
      <td></td><td></td><td>읽음 ${read}/${r.books.length}</td><td></td><td></td><td></td>`;
    tr.querySelector("b").textContent = r.base;
    tr.children[1].textContent = r.books[0].a;
    tr.children[2].textContent = r.books[0].cat;
    tr.children[6].textContent = r.books[0].loc;
    tr.addEventListener("click", () => {
      if (open) expandedSeries.delete(r.series); else expandedSeries.add(r.series);
      renderList();
    });
    return tr;
  }

  function renderList() {
    const body = $("listbody"); body.innerHTML = "";
    const list = sortedBooks();
    const grouping = !sortKey && !q();
    const rows = grouping ? seriesRows(list) : list.map((b) => ({ b }));
    // 펼친 시리즈는 헤더 밑에 낱권을 늘어놓는다
    const flat = [];
    rows.forEach((r) => {
      flat.push(r);
      if (r.series && expandedSeries.has(r.series)) r.books.forEach((b) => flat.push({ b, sub: true }));
    });
    flat.slice(0, listShown).forEach((r) => {
      body.appendChild(r.series ? seriesRow(r) : bookRow(r.b, r.sub));
    });
    const shown = Math.min(listShown, flat.length);
    $("listnote").textContent = list.length
      ? `${list.length.toLocaleString()}권`
        + (grouping && flat.length < list.length ? ` · 시리즈는 접혀 있습니다 — 줄을 눌러 펼칩니다` : "")
        + (shown < flat.length ? ` · ${shown.toLocaleString()}줄 표시` : "")
        + (stFilter ? ` · 읽은 책만 보는 중` : "")
        + (q() ? ` (검색어: "${$("q").value.trim()}")` : "")
        + (sortKey ? ` · ${sortAsc ? "오름차순" : "내림차순"}` : "")
      : stFilter && q() ? `읽은 책 중에 "${$("q").value.trim()}" 은 없습니다`
        : stFilter ? "아직 읽어 낸 책이 없습니다."
          : (q() ? `"${$("q").value.trim()}" — 찾지 못했습니다` : "아직 꽂힌 책이 없습니다.");
    const more = $("listmore");
    more.hidden = shown >= flat.length;
    more.textContent = `더 본다 (${(flat.length - shown).toLocaleString()}줄 남음)`;
  }

  /* 통계 뷰 — 숫자는 전부 지금 꽂혀 있는 책에서 센다.
     표본이든 실제 장서든 같은 코드가 답을 낸다. */
  function tally(list, pick) {
    const m = new Map();
    list.forEach((b) => {
      const k = pick(b);
      if (k === null || k === undefined || k === "") return;
      m.set(k, (m.get(k) || 0) + 1);
    });
    return [...m.entries()];
  }

  function renderStats() {
    const books = allBooks();
    const n = books.length;

    ["catbars", "yearcols", "statusbar", "authorbars", "pagesum", "wallbars", "pubbars", "memolist"]
      .forEach((id) => { const el = $(id); if (el) el.innerHTML = ""; });
    $("statuslegend").innerHTML = "";

    // 빈 서가에 가짜 숫자를 세우지 않는다
    if (!n) {
      $("ps-cat").textContent = "아직 꽂힌 책이 없습니다";
      $("ps-status").textContent = "책을 들이면 여기에 셈이 섭니다";
      $("catbars").innerHTML = `<p class="statempty">사진을 들이고 책등을 읽으면 이 칸이 채워집니다.</p>`;
      return;
    }

    const CATSTAT = tally(books, (b) => b.cat).sort((a, b) => b[1] - a[1]);
    /* 입고 해가 하나뿐이면(장서를 한꺼번에 옮긴 참) 막대 하나짜리 그림이 된다 —
       그때는 펴낸 해를 10년 단위로 묶어 장서의 나이를 보여준다. 항목은
       [막대 글자, 권수, 올릴 때 설명] 세 짝이다. */
    const acqTally = tally(books, (b) => b.year);
    const pubTally = tally(books, (b) => b.pubYear && Math.floor(b.pubYear / 10) * 10);
    const usePub = acqTally.length <= 1 && pubTally.length > 1;
    const YEARSTAT = usePub
      ? pubTally.sort((a, b) => a[0] - b[0])
          .map(([d, v]) => ["'" + String(d).slice(2), v, `${d}년대 펴냄 ${v}권`])
      : acqTally.sort((a, b) => a[0] - b[0])
          .map(([y, v]) => ["'" + String(y).slice(2), v, `${y}년 ${v}권 입고`]);
    const yearPanel = $("yearcols")?.closest(".statpanel");
    if (yearPanel) {
      const h4El = yearPanel.querySelector("h4");
      if (h4El) h4El.textContent = usePub ? "펴낸 해" : "연도별 입고";
    }
    const AUTHSTAT = tally(books, (b) => b.a).sort((a, b) => b[1] - a[1]).slice(0, 5);

    // "서가에 꽂힌" 이라고 못박는다 — 표본 화면에서는 벽이 밝힌 권수보다
    // 실제로 그려진 책등이 적어서, 그냥 "전체"라고 하면 위의 입고 수와 어긋나 보인다
    $("ps-cat").textContent = `서가에 꽂힌 ${n.toLocaleString()}권 · ${CATSTAT.length}개 분류`;
    $("ps-status").textContent = `서가에 꽂힌 ${n.toLocaleString()}권 기준`;

    const grow = []; /* 막대는 0에서 자라난다 */
    const cb = $("catbars");
    const cmax = CATSTAT[0][1];
    CATSTAT.forEach(([nm, v]) => {
      const el = document.createElement("div"); el.className = "hbar";
      el.innerHTML = `<span class="lb"></span><span class="track"><span class="fill" style="width:0%"></span></span><span class="val">${v}권</span>`;
      el.querySelector(".lb").textContent = nm;
      grow.push([el.querySelector(".fill"), "width", Math.round(v/cmax*100) + "%"]);
      cb.appendChild(el);
    });
    const yc = $("yearcols");
    // 입고 연도를 모르는 장서만 있을 수 있다 — 그때는 빈 칸으로 둔다
    const ymax = YEARSTAT.length ? Math.max(...YEARSTAT.map(y => y[1])) : 0;
    if (!YEARSTAT.length) yc.innerHTML = `<p class="statempty">연도가 적힌 책이 아직 없습니다.</p>`;
    YEARSTAT.forEach(([y, v, tip], i) => {
      const el = document.createElement("div"); el.className = "col";
      const showVal = v === ymax || i === YEARSTAT.length - 1;
      el.innerHTML = `<span class="vl">${showVal ? v : ""}</span><i style="height:0%"></i><span class="yl">${y}</span>`;
      el.title = tip;
      grow.push([el.querySelector("i"), "height", Math.round(v/ymax*76) + "%"]);
      yc.appendChild(el);
    });
    const sb = $("statusbar");
    const lg = $("statuslegend");
    [["읽음", "var(--st-done)", "#F2EDE0"],
     ["읽는 중", "var(--st-doing)", "#241708"],
     ["안 읽음", "var(--st-todo)", "#F2EDE0"]].forEach(([nm, c, txt]) => {
      const cnt = books.filter((b) => b.st === nm).length;
      const p = Math.round(cnt / n * 100);
      if (cnt) {
        const seg = document.createElement("i");
        seg.style.cssText = `width:${p}%;background:${c};color:${txt};`;
        if (p >= 10) seg.textContent = p + "%";
        seg.title = `${nm} ${cnt}권 · ${p}%`;
        sb.appendChild(seg);
      }
      const li = document.createElement("span");
      li.innerHTML = `<i style="background:${c}"></i>`;
      li.append(`${nm} ${cnt.toLocaleString()} · ${p}%`);
      lg.appendChild(li);
    });
    const ab = $("authorbars");
    const amax = AUTHSTAT.length ? AUTHSTAT[0][1] : 0;
    if (!AUTHSTAT.length) ab.innerHTML = `<p class="statempty">지은이가 적힌 책이 아직 없습니다.</p>`;
    AUTHSTAT.forEach(([nm, v]) => {
      const el = document.createElement("div"); el.className = "hbar";
      el.innerHTML = `<span class="lb" style="font-size:11.5px"></span><span class="track"><span class="fill" style="width:0%;background:var(--brass-dim)"></span></span><span class="val">${v}권</span>`;
      el.querySelector(".lb").textContent = nm;
      grow.push([el.querySelector(".fill"), "width", Math.round(v/amax*100) + "%"]);
      ab.appendChild(el);
    });
    /* ── 읽어낸 쪽수 — 권수보다 정직한 숫자 ── */
    const paged = books.filter((b) => b.pages);
    const totalPages = paged.reduce((s, b) => s + b.pages, 0);
    const readPages = paged.reduce((s, b) =>
      s + (b.st === "읽음" ? b.pages : (b.st === "읽는 중" && b.bookmark ? Math.min(b.bookmark, b.pages) : 0)), 0);
    const pp = $("ps-pages"), ps = $("pagesum");
    if (pp && ps) {
      if (!paged.length) {
        pp.textContent = "쪽수를 아는 책이 아직 없습니다";
        ps.innerHTML = `<p class="statempty">서지를 채우면 알라딘이 쪽수를 알려줍니다.</p>`;
      } else {
        pp.textContent = `쪽수를 아는 ${paged.length.toLocaleString()}권 기준`;
        const pct = totalPages ? Math.round(readPages / totalPages * 100) : 0;
        ps.innerHTML = `
          <div class="pagenum"><b>${readPages.toLocaleString()}</b><span>읽어낸 쪽</span></div>
          <div class="pagenum dim"><b>${totalPages.toLocaleString()}</b><span>서가 전체 쪽</span></div>
          <div class="pagebar"><i style="width:${pct}%"></i></div>
          <p class="pagepct">${pct}% — 읽는 중인 책은 갈피까지 센다</p>`;
      }
    }

    /* ── 벽별 읽음률 ── */
    const wb = $("wallbars");
    if (wb) {
      WALLS.filter((w) => w.cat !== "archive" && w.n).forEach((w) => {
        const el = document.createElement("div"); el.className = "hbar";
        el.innerHTML = `<span class="lb"></span><span class="track"><span class="fill" style="width:0%;background:var(--st-done)"></span></span><span class="val">${w.read}%</span>`;
        el.querySelector(".lb").textContent = w.nm.replace("의 벽", "");
        el.title = `${w.nm} ${w.n.toLocaleString()}권 중 ${w.read}% 읽음`;
        grow.push([el.querySelector(".fill"), "width", w.read + "%"]);
        wb.appendChild(el);
      });
      if (!wb.children.length) wb.innerHTML = `<p class="statempty">벽에 책이 꽂히면 셈이 섭니다.</p>`;
    }

    /* ── 자주 들인 출판사 — 서지를 채운 책 기준 ── */
    const pb = $("pubbars");
    if (pb) {
      const PUBSTAT = tally(books, (b) => b.pub).sort((x, y) => y[1] - x[1]).slice(0, 5);
      const pmax = PUBSTAT.length ? PUBSTAT[0][1] : 0;
      if (!PUBSTAT.length) pb.innerHTML = `<p class="statempty">서지를 채우면 출판사가 여기 모입니다.</p>`;
      PUBSTAT.forEach(([nm, v]) => {
        const el = document.createElement("div"); el.className = "hbar";
        el.innerHTML = `<span class="lb" style="font-size:11.5px"></span><span class="track"><span class="fill" style="width:0%;background:var(--brass-dim)"></span></span><span class="val">${v}권</span>`;
        el.querySelector(".lb").textContent = nm;
        grow.push([el.querySelector(".fill"), "width", Math.round(v / pmax * 100) + "%"]);
        pb.appendChild(el);
      });
    }

    /* ── 여백의 기록 — 흩어진 메모를 한자리에 ── */
    const ml = $("memolist"), pm = $("ps-memos");
    if (ml && pm) {
      const memos = books.filter((b) => b.memo);
      pm.textContent = memos.length
        ? `${memos.length.toLocaleString()}권의 여백에 글이 있습니다`
        : "서표의 여백에 적으면 여기 모입니다";
      memos.slice(0, 12).forEach((b) => {
        const el = document.createElement("button"); el.className = "memorow";
        el.innerHTML = `<b></b><span></span>`;
        el.querySelector("b").textContent = b.t;
        el.querySelector("span").textContent = b.memo;
        el.addEventListener("click", () => openExlibris(b, bookWall(b)));
        ml.appendChild(el);
      });
      if (memos.length > 12) {
        const more = document.createElement("p"); more.className = "statempty";
        more.textContent = `— 그 밖에 ${memos.length - 12}권의 여백이 더 있다 —`;
        ml.appendChild(more);
      }
    }

    /* ── 그 해의 서재 — 읽은 해(read_year)로 여는 회고 ── */
    const rp = $("recapbody"), rps = $("ps-recap");
    if (rp && rps) {
      rp.innerHTML = "";
      const readable = books.filter((b) => b.readYear);
      if (!readable.length) {
        rps.textContent = "읽음으로 표시하면 그 해가 기록됩니다";
        rp.innerHTML = `<p class="statempty">읽은 해가 쌓이면 연말 회고가 여기 섭니다.</p>`;
      } else {
        const years = tally(readable, (b) => b.readYear).sort((x, y) => y[0] - x[0]);
        const y = years[0][0];   // 가장 최근 해
        const ofYear = readable.filter((b) => b.readYear === y);
        const pages = ofYear.reduce((s, b) => s + (b.pages || 0), 0);
        rps.textContent = `${y}년의 서재`;
        rp.innerHTML = `
          <div class="pagenum"><b>${ofYear.length.toLocaleString()}</b><span>읽어낸 권</span></div>
          <div class="pagenum dim"><b>${pages.toLocaleString()}</b><span>읽어낸 쪽</span></div>`;
        const catline = document.createElement("p");
        catline.className = "pagepct";
        catline.textContent = tally(ofYear, (b) => b.cat)
          .sort((x, z) => z[1] - x[1]).slice(0, 3)
          .map(([c, v]) => `${c} ${v}권`).join(" · ");
        rp.appendChild(catline);
        if (years.length > 1) {
          const past = document.createElement("p");
          past.className = "statempty";
          past.textContent = "— 그 전에는 "
            + years.slice(1, 4).map(([yy, v]) => `${yy}년 ${v}권`).join(", ") + " —";
          rp.appendChild(past);
        }
        // 회고를 그림 한 장으로 — 공유하거나 남겨 두거나
        const card = document.createElement("button");
        card.type = "button";
        card.className = "cardbtn";
        card.textContent = "그림 한 장으로 내려받는다";
        card.addEventListener("click", () => downloadRecapCard(y, ofYear, pages));
        rp.appendChild(card);
      }
    }

    /* ── 읽기 리듬 — 최근 91일, 갈피가 움직인 날들 ── */
    const rg = $("rhythmgrid"), rs = $("ps-rhythm");
    if (rg && rs) {
      rg.innerHTML = "";
      const stamps = books.filter((b) => b.bookmarkAt).map((b) => b.bookmarkAt);
      if (!stamps.length) {
        rs.textContent = "갈피를 적으면 그 날들이 여기 찍힙니다";
        rg.innerHTML = `<p class="statempty">읽다 만 자리를 서표에 적어 두면, 읽은 날들이 밭처럼 남습니다.</p>`;
      } else {
        const byDay = new Map();
        stamps.forEach((iso) => {
          const k = String(iso).slice(0, 10);
          byDay.set(k, (byDay.get(k) || 0) + 1);
        });
        rs.textContent = `최근 91일 · 갈피가 움직인 ${byDay.size}일`;
        // 13주 × 7칸 — 오늘이 오른쪽 끝
        const today = new Date(); today.setHours(0, 0, 0, 0);
        for (let i = 90; i >= 0; i--) {
          const day = new Date(today.getTime() - i * 86400000);
          const k = day.toISOString().slice(0, 10);
          const n = byDay.get(k) || 0;
          const cell = document.createElement("i");
          cell.className = "rcell";
          cell.dataset.n = String(Math.min(n, 3));
          cell.title = `${k}${n ? ` · ${n}권의 갈피` : ""}`;
          rg.appendChild(cell);
        }
      }
    }

    renderChronicle(books); // 독서 연대기 — 실제로 통과한 책들
    renderSizeMap(books);   // 판형 지도 — 실물 치수를 아는 책만
    renderLinkWeb(books);   // 이음의 별자리 — 데이터를 따로 받아와 그린다
    renderAuthorWeb(books); // 작가의 별자리 — 같은 작가의 책이 한 성좌로

    requestAnimationFrame(() => requestAnimationFrame(() => {
      grow.forEach(([el, prop, val]) => el.style[prop] = val);
    }));
  }

  /* ── 독서 연대기 ────────────────────────────────────────
     읽어 낸 책은 서재의 5%뿐이라 벽을 훑어서는 만날 수 없고, 지금까지는
     통계의 막대 하나로만 있었다. 해마다 줄을 세워 표지를 늘어놓는다 —
     이 서재가 실제로 통과한 것들의 목록이자, 가장 읽을 만한 자리.
     읽은 해를 모르는 책은 「해를 적지 않은 책」으로 맨 뒤에 따로 선다. */
  function renderChronicle(books) {
    const box = $("chron"), ps = $("ps-chron"), panel = $("chron-panel");
    if (!box || !panel) return;
    const read = books.filter((b) => b.st === "읽음");
    if (!read.length) { panel.hidden = true; return; }
    panel.hidden = false;

    const byYear = new Map();
    read.forEach((b) => {
      const y = b.readYear || 0;
      if (!byYear.has(y)) byYear.set(y, []);
      byYear.get(y).push(b);
    });
    // 최근 해가 위. 해를 모르는 책(0)은 언제나 맨 뒤
    const years = [...byYear.keys()].sort((a, b) => (b || -1) - (a || -1));

    const pages = read.reduce((s, b) => s + (b.pages || 0), 0);
    ps.textContent = `읽어 낸 ${read.length.toLocaleString()}권`
      + (pages ? ` · ${pages.toLocaleString()}쪽` : "")
      + ` · 해가 적힌 것 ${read.filter((b) => b.readYear).length}권`;

    box.innerHTML = "";
    years.forEach((y) => {
      const mine = byYear.get(y).sort((a, b) => a.t.localeCompare(b.t, "ko"));
      const row = document.createElement("div");
      row.className = "chronyear";
      const head = document.createElement("div");
      head.className = "chronhead";
      const p = mine.reduce((s, b) => s + (b.pages || 0), 0);
      head.innerHTML = `<b></b><span></span>`;
      head.querySelector("b").textContent = y ? `${y}년` : "해를 적지 않은 책";
      head.querySelector("span").textContent =
        `${mine.length}권` + (p ? ` · ${p.toLocaleString()}쪽` : "");
      row.appendChild(head);

      const strip = document.createElement("div");
      strip.className = "chronstrip";
      mine.forEach((b) => {
        const it = document.createElement("button");
        it.type = "button";
        it.className = "chronbook" + (b.cover ? " hascover" : "");
        it.style.setProperty("--cvr", b.c);
        it.title = `${b.t} — ${b.a}`;
        if (b.cover) {
          const im = document.createElement("img");
          im.loading = "lazy"; im.alt = ""; im.src = b.cover;
          im.addEventListener("error", () => { it.classList.remove("hascover"); im.remove(); });
          it.appendChild(im);
        }
        const cap = document.createElement("span");
        cap.textContent = b.t;
        it.appendChild(cap);
        // 여백에 한 줄이 있으면 그것이 이 해의 말이 된다
        if (b.memo) {
          const m = document.createElement("i");
          m.className = "chronmemo";
          m.textContent = b.memo;
          it.appendChild(m);
        }
        it.addEventListener("click", () => openExlibris(b, bookWall(b)));
        strip.appendChild(it);
      });
      row.appendChild(strip);
      box.appendChild(row);
    });
  }

  /* ── 판형 지도 ─────────────────────────────────────────
     알라딘의 packing 으로 199권의 실물 높이(mm)를 받아 두었는데, 지금은
     책등 픽셀을 정하는 데만 쓰고 화면에는 한 번도 나오지 않았다. 여기서는
     mm 를 숫자가 아니라 크기로 보여준다 — 판형별로 실제 비율의 종이를 세운다.
     인쇄의 판형 이름은 높이로 가른다 (문고본 ~150, 국판 ~200, 신국판 ~230…). */
  const FORMS = [
    { nm: "문고본", max: 155, note: "주머니에 들어간다" },
    { nm: "국판", max: 195, note: "손에 가볍다" },
    { nm: "신국판", max: 213, note: "한국 단행본의 기본" },
    { nm: "크라운판", max: 232, note: "조금 크고 두껍다" },
    { nm: "4×6배판", max: 265, note: "화집·도감 쪽" },
    { nm: "대형본", max: 9999, note: "책장 한 칸을 혼자 쓴다" },
  ];
  function renderSizeMap(books) {
    const box = $("sizemap"), ps = $("ps-size"), panel = $("size-panel");
    if (!box || !panel) return;
    const sized = books.filter((b) => b.mmH > 0);
    if (sized.length < 8) { panel.hidden = true; return; }
    panel.hidden = false;
    const tallest = Math.max(...sized.map((b) => b.mmH));
    ps.textContent =
      `실물 치수를 아는 ${sized.length.toLocaleString()}권 — 종이 조각의 크기가 실제 비율입니다.` +
      ` 가장 큰 책은 ${tallest}mm.`;
    box.innerHTML = "";
    FORMS.forEach((f, i) => {
      const lo = i ? FORMS[i - 1].max : 0;
      const mine = sized.filter((b) => b.mmH > lo && b.mmH <= f.max);
      if (!mine.length) return;
      const avgH = Math.round(mine.reduce((s, b) => s + b.mmH, 0) / mine.length);
      const depths = mine.map((b) => b.mmD).filter(Boolean);
      const avgD = depths.length ? Math.round(depths.reduce((s, d) => s + d, 0) / depths.length) : null;
      // 가장 큰 판형이 92px 이 되도록 — 판형끼리의 비율은 실물 그대로다
      const px = Math.round(avgH / tallest * 92);
      const cell = document.createElement("button");
      cell.className = "sizecell";
      cell.type = "button";
      cell.innerHTML = `
        <span class="sizepaper" style="height:${px}px;width:${Math.round(px * 0.68)}px"></span>
        <b>${f.nm}</b>
        <span class="sizen">${mine.length}권</span>
        <span class="sizemm">평균 ${avgH}mm${avgD ? ` · 등 ${avgD}mm` : ""}</span>`;
      cell.title = `${f.nm} — ${f.note}. 누르면 그중 한 권을 펼칩니다`;
      cell.addEventListener("click", () => {
        const b = mine[Math.floor(Math.random() * mine.length)];
        openExlibris(b, bookWall(b));
      });
      box.appendChild(cell);
    });
  }

  /* ── 작가의 별자리 — 같은 작가의 책들이 한 성좌로 모인다 ──
     이음(book_links)과 달리 손대지 않아도 뜬다: 지은이가 같으면 한 무리다.
     진짜 성도(星圖)처럼 그린다: 바퀴살 대신 별을 흩뿌려 사슬로 잇고,
     잔별을 배경에 깔고, 별마다 아주 작게 반짝이고 떠다닌다.
     자리는 작가 이름 시드로 정한다 — 새로고침해도 같은 하늘이어야 한다.
     모션 감경이면 정지 화면 한 장만 그린다. 별을 누르면 서표가 열린다. */
  let authorWebRaf = 0;
  function renderAuthorWeb(books) {
    const cvs = $("authorweb"), ps = $("ps-authorweb");
    if (!cvs || !ps) return;
    cancelAnimationFrame(authorWebRaf);
    // 두 권 이상 모은 작가만, 많이 모은 순으로 여덟까지
    const byAuthor = new Map();
    books.forEach((b) => {
      if (!b.a || b.a === "지은이 미상") return;
      if (!byAuthor.has(b.a)) byAuthor.set(b.a, []);
      byAuthor.get(b.a).push(b);
    });
    const tops = [...byAuthor.entries()]
      .filter(([, list]) => list.length >= 2)
      .sort((x, y) => y[1].length - x[1].length)
      .slice(0, 8);
    if (!tops.length) {
      ps.textContent = "같은 작가의 책이 두 권 넘게 모이면 성좌가 뜹니다";
      cvs.hidden = true;
      return;
    }
    ps.textContent = `${tops.length}명의 작가 — 별을 누르면 그 책이 펼쳐진다`;
    // 그림은 읽어 줄 수 없으니, 성좌 이름과 권수를 말로 적어 둔다
    cvs.setAttribute("aria-label",
      "작가의 별자리 — " + tops.map(([nm, list]) => `${nm} ${list.length}권`).join(", "));

    const Wd = cvs.parentElement?.clientWidth ? cvs.parentElement.clientWidth - 2 : 600;
    const perRow = Math.max(1, Math.floor(Wd / 210));
    const Ht = Math.max(170, Math.ceil(tops.length / perRow) * 165 + 10);
    cvs.hidden = false;
    cvs.width = Wd * 2; cvs.height = Ht * 2;   // 레티나
    cvs.style.width = Wd + "px"; cvs.style.height = Ht + "px";
    const c = cvs.getContext("2d");
    c.scale(2, 2);
    c.textAlign = "center";

    const hash = (s) => {
      let h = 9;
      for (const ch of s) h = (h * 31 + ch.codePointAt(0)) >>> 0;
      return h || 1;
    };

    // 성도의 먼지 — 배경의 잔별. 흐리게 깜빡이기만 하고 움직이지는 않는다
    const dustRng = makeRng(77);
    const dust = Array.from({ length: Math.round((Wd * Ht) / 4500) }, () => ({
      x: dustRng() * Wd, y: dustRng() * Ht,
      r: 0.4 + dustRng() * 0.7,
      ph: dustRng() * Math.PI * 2, sp: 0.5 + dustRng(),
    }));

    const stars = [];   // 성좌의 별 — 밑자리(bx,by)와 반짝임 위상을 품는다
    const bonds = [];   // 별과 별 사이의 실
    tops.forEach(([name, list], i) => {
      const cx = 105 + (i % perRow) * 210, cy = 82 + Math.floor(i / perRow) * 165;
      const shown = list.slice(0, 14);   // 전집 작가는 열넷까지만 — 하늘이 붐빈다
      const rng = makeRng(hash(name));
      const r0 = Math.min(54, 26 + shown.length * 2.2);
      const cell = [];
      shown.forEach((b, k) => {
        // 고른 각에 시드 난수의 흔들림을 얹는다 — 완전한 원은 성좌처럼 안 보인다
        const a = (k / shown.length) * Math.PI * 2 - Math.PI / 2 + (rng() - 0.5) * 0.6;
        const rr = r0 * (0.55 + rng() * 0.55);
        const s = {
          bx: cx + Math.cos(a) * rr, by: cy + Math.sin(a) * rr,
          r: b.st === "읽음" ? 2.4 + rng() * 1.2 : 1.6 + rng() * 0.9,
          lit: b.st === "읽음",
          ph: rng() * Math.PI * 2, sp: 0.7 + rng() * 1.1,
          b,
        };
        cell.push(s); stars.push(s);
      });
      // 이웃 별끼리 사슬로 잇는다 — 가운데서 뻗는 바퀴살이 아니라 별자리 선
      for (let k = 0; k < cell.length - 1; k++) bonds.push([cell[k], cell[k + 1]]);
    });

    // 표류 — 밑자리 둘레를 아주 느리게 (한 바퀴 십몇 초) 맴돈다
    const posOf = (s, t) => [
      s.bx + Math.sin(t * 0.00042 * s.sp + s.ph) * 1.4,
      s.by + Math.cos(t * 0.00033 * s.sp + s.ph * 1.7) * 1.4,
    ];

    let lastT = 0;
    const draw = (t) => {
      lastT = t;
      c.clearRect(0, 0, Wd, Ht);
      // 잔별
      dust.forEach((d) => {
        const tw = 0.16 + 0.14 * (1 + Math.sin(t * 0.0011 * d.sp + d.ph)) / 2;
        c.globalAlpha = tw;
        c.fillStyle = "#E2D5B8";
        c.beginPath(); c.arc(d.x, d.y, d.r, 0, Math.PI * 2); c.fill();
      });
      c.globalAlpha = 1;
      // 작가 이름 — 성좌 한가운데의 표기
      tops.forEach(([name, list], i) => {
        const cx = 105 + (i % perRow) * 210, cy = 82 + Math.floor(i / perRow) * 165;
        c.fillStyle = "#E2D5B8";
        c.font = "700 12px 'Gowun Batang', serif";
        c.fillText(name.length > 9 ? name.slice(0, 9) + "…" : name, cx, cy + 4);
        c.fillStyle = "rgba(163,148,122,.9)";
        c.font = "10px sans-serif";
        c.fillText(`${list.length}권`, cx, cy + 18);
      });
      // 별 사이의 실
      c.strokeStyle = "rgba(151,116,47,.28)";
      c.lineWidth = 0.8;
      bonds.forEach(([p, q2]) => {
        const [x1, y1] = posOf(p, t), [x2, y2] = posOf(q2, t);
        c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
      });
      // 별 — 읽은 책은 놋빛으로 밝게 무리를 두르고, 나머지는 흐린 상아빛
      stars.forEach((s) => {
        const [x, y] = posOf(s, t);
        const tw = 0.68 + 0.32 * Math.sin(t * 0.002 * s.sp + s.ph);
        if (s.lit) {
          c.globalAlpha = Math.max(0.35, tw);
          c.shadowColor = "rgba(224,177,94,.85)";
          c.shadowBlur = 6;
          c.fillStyle = "#E0B15E";
        } else {
          c.globalAlpha = Math.max(0.25, tw * 0.6);
          c.shadowBlur = 0;
          c.fillStyle = "#E2D5B8";
        }
        c.beginPath(); c.arc(x, y, s.r, 0, Math.PI * 2); c.fill();
      });
      c.shadowBlur = 0;
      c.globalAlpha = 1;
    };

    if (noMotion) {
      draw(0);   // 모션을 줄여 달라면 성도 한 장으로 멈춘다
    } else {
      const loop = (t) => {
        if (!cvs.isConnected) return;   // 통계 화면이 통째로 사라지면 끝
        if (cvs.offsetParent !== null) draw(t);   // 안 보일 땐 그리지 않고 기다린다
        authorWebRaf = requestAnimationFrame(loop);
      };
      authorWebRaf = requestAnimationFrame(loop);
    }

    cvs.onclick = (ev) => {
      const r = cvs.getBoundingClientRect();
      const mx = ev.clientX - r.left, my = ev.clientY - r.top;
      let hit = null, best = 16 * 16;
      for (const s of stars) {
        const [x, y] = posOf(s, lastT);
        const d = (x - mx) ** 2 + (y - my) ** 2;
        if (d < best) { best = d; hit = s.b; }
      }
      if (hit) openExlibris(hit, bookWall(hit));
    };
  }

  /* ── 회고 카드 — 「그 해의 서재」를 그림 한 장으로 굽는다 ──
     화면 스타일을 canvas 에 손으로 다시 그린다. 공유용이라 세로가 길다. */
  function downloadRecapCard(year, ofYear, pages) {
    const W = 1080, H = 1350;
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const c = cv.getContext("2d");
    // 바탕과 겹테 — 서재의 어둠과 놋쇠
    c.fillStyle = "#171009"; c.fillRect(0, 0, W, H);
    c.strokeStyle = "#97742F"; c.lineWidth = 3;
    c.strokeRect(40, 40, W - 80, H - 80);
    c.strokeStyle = "rgba(151,116,47,.4)"; c.lineWidth = 1;
    c.strokeRect(52, 52, W - 104, H - 104);
    c.textAlign = "center";
    // 머리
    c.fillStyle = "#A3947A"; c.font = "28px Georgia, serif";
    c.fillText("P O S T   L I B R O S", W / 2, 150);
    c.fillStyle = "#E2D5B8"; c.font = "700 64px 'Gowun Batang', serif";
    c.fillText("서가 뒤의 방", W / 2, 230);
    // 해
    c.fillStyle = "#E0B15E"; c.font = "700 110px 'Gowun Batang', serif";
    c.fillText(`${year}년의 서재`, W / 2, 430);
    // 셈 — 권과 쪽
    c.fillStyle = "#E2D5B8"; c.font = "700 150px Georgia, serif";
    c.fillText(ofYear.length.toLocaleString(), W / 2 - 220, 660);
    c.fillText(pages.toLocaleString(), W / 2 + 220, 660);
    c.fillStyle = "#A3947A"; c.font = "34px 'Gowun Batang', serif";
    c.fillText("읽어낸 권", W / 2 - 220, 720);
    c.fillText("읽어낸 쪽", W / 2 + 220, 720);
    // 갈래
    const cats = tally(ofYear, (b) => b.cat).sort((x, y) => y[1] - x[1]).slice(0, 3);
    c.fillStyle = "#E0B15E"; c.font = "40px 'Gowun Batang', serif";
    c.fillText(cats.map(([k, v]) => `${k} ${v}권`).join("   ·   "), W / 2, 850);
    // 가장 아낀 책 — 여백에 글이 남은 책을 우선, 없으면 첫 권
    const dear = ofYear.find((b) => b.memo) || ofYear[0];
    if (dear) {
      c.fillStyle = "#A3947A"; c.font = "30px 'Gowun Batang', serif";
      c.fillText("그 해의 한 권", W / 2, 990);
      c.fillStyle = "#E2D5B8"; c.font = "700 48px 'Gowun Batang', serif";
      const t = dear.t.length > 18 ? dear.t.slice(0, 18) + "…" : dear.t;
      c.fillText(`「${t}」`, W / 2, 1050);
      c.fillStyle = "#A3947A"; c.font = "32px 'Gowun Batang', serif";
      c.fillText(dear.a || "", W / 2, 1100);
    }
    // 발
    c.fillStyle = "#97742F"; c.font = "26px Georgia, serif";
    c.fillText("rokiz.net/books", W / 2, H - 90);
    cv.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `서가뒤의방-${year}-회고.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }, "image/png");
  }

  /* ── 이음의 별자리 — 이어 둔 책들이 성좌를 이룬다 ──
     이어진 책들만 별로 뜨고, 같은 성분(서로 닿는 무리)은 작은 원으로 모인다.
     여기서의 이음은 컬렉션이다: 다른 작가·다른 작품이라도 이었을 때 빛이
     나는 짝(주인의 뜻). 시리즈 잇기 제안은 여기가 아니라 서표에 있다. */
  /* ── 이음의 항로도 ──────────────────────────────────────
     예전에는 이음을 성좌로 그렸다. 예쁘지만 아무 데도 안내하지 않았다 —
     별을 이어 두어도 어디서 시작해 어디로 가는지는 말해 주지 않는다.
     독서 커뮤니티에서 도는 「작가 플로우 차트」처럼, 이음은 길이어야 한다:
     화살표에 방향이 있고, 화살표 위에 왜 그리로 가는지가 적혀 있고,
     어디서 시작하는지가 굵게 표시되어 있다.
     밤하늘을 버리지는 않는다 — 옛 성도에도 항해선은 그려져 있었다. */
  const CELL_W = 148, CELL_H = 112, CV_W = 44, CV_H = 62;
  const coverCache = new Map();
  function loadCover(url) {
    if (!url) return Promise.resolve(null);
    if (coverCache.has(url)) return coverCache.get(url);
    // 알라딘 표지는 CORS 를 열어 준다(확인함) — 그래야 그림으로 내려받을 때
    // 캔버스가 오염되지 않는다. 열어 주지 않는 곳이면 그냥 못 싣고 넘어간다.
    const p = new Promise((res) => {
      const im = new Image();
      im.crossOrigin = "anonymous";
      im.onload = () => res(im);
      im.onerror = () => res(null);
      im.src = url;
    });
    coverCache.set(url, p);
    return p;
  }

  /* 표지가 없는 책의 얼굴 — 활판으로 찍은 듯 제목 첫 글자를 앉힌다.
     서재의 열에 여섯은 표지가 없어서, 없는 채로 두면 색 블록 밭이 된다. */
  function drawFace(c, x, y, w, h, b, img, dim) {
    c.save();
    c.globalAlpha = dim ? 0.55 : 1;
    if (img) {
      c.drawImage(img, x, y, w, h);
    } else {
      c.fillStyle = b.c || "#4A3218";
      c.fillRect(x, y, w, h);
      c.strokeStyle = "rgba(224,177,94,.45)"; c.lineWidth = 1;
      c.strokeRect(x + 3.5, y + 3.5, w - 7, h - 7);
      c.fillStyle = "rgba(242,231,200,.92)";
      c.textAlign = "center"; c.textBaseline = "middle";
      c.font = `700 ${Math.round(h * 0.42)}px 'Gowun Batang', serif`;
      c.fillText((b.t || "?").trim().slice(0, 1), x + w / 2, y + h / 2 + 1);
      c.textBaseline = "alphabetic";
    }
    c.strokeStyle = b.st === "읽음" ? "rgba(224,177,94,.9)" : "rgba(0,0,0,.5)";
    c.lineWidth = b.st === "읽음" ? 1.6 : 1;
    c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    c.restore();
  }

  /* 캔버스에 두 줄까지 줄여 적는다 */
  function wrap2(c, text, x, y, max) {
    const t = String(text || "");
    let line = "", lines = [];
    for (const ch of t) {
      if (c.measureText(line + ch).width > max && line) { lines.push(line); line = ch; }
      else line += ch;
      if (lines.length === 2) break;
    }
    if (lines.length < 2 && line) lines.push(line);
    if (lines.length === 2 && c.measureText(lines[1]).width > max - 8) {
      lines[1] = lines[1].slice(0, -1) + "…";
    }
    lines.forEach((ln, k) => c.fillText(ln, x, y + k * 12));
    return lines.length;
  }

  let walk = null;          /* 지금 걷고 있는 길 { list, i } */
  let chartHit = [];        /* 항로도의 눌리는 자리 */

  async function renderLinkWeb(books) {
    const cvs = $("linkweb"), ps = $("ps-linkweb"), bar = $("chartbar");
    if (!cvs || !ps) return;
    const db = window.PostLibrosDB;
    const byId = new Map(books.filter((b) => b.id).map((b) => [b.id, b]));
    let links = [];
    if (db?.listAllLinks && byId.size) {
      try { links = await db.listAllLinks(); }
      catch (e) { console.warn("[항로도] 이음을 읽지 못했습니다:", e); }
    }
    const es = links.filter((l) => byId.has(l.book_id) && byId.has(l.linked_book_id));

    /* 기계가 이은 시리즈와 사람이 그은 길을 구별한다 — 굵기가 달라진다.
       (예전에는 시리즈를 아예 숨겼는데, 그러면 화면이 통째로 비었다) */
    const seriesKeyOf = (b) => {
      if (b.series) return "손␟" + b.series;
      const m = b.t.match(SERIES_RE);
      return m ? m[1].trim().toLowerCase() + "␟" + (b.a || "") : null;
    };
    const isAuto = (l) => {
      const ka = seriesKeyOf(byId.get(l.book_id));
      return !!(ka && ka === seriesKeyOf(byId.get(l.linked_book_id)));
    };

    const Wd = cvs.parentElement?.clientWidth ? cvs.parentElement.clientWidth - 2 : 600;
    if (!es.length) {
      ps.textContent = "책과 책을 이어 두면 길이 됩니다 — 서표의 「이음」 줄에서, 방향과 까닭까지";
      cvs.hidden = true;
      if (bar) bar.hidden = true;
      return;
    }
    if (bar) bar.hidden = false;

    /* 이웃 관계 — 순서(방향 있음)와 나란히(방향 없음)를 나눠 둔다 */
    const out = new Map(), inc = new Map(), any = new Map();
    const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
    es.forEach((l) => {
      push(any, l.book_id, l.linked_book_id);
      push(any, l.linked_book_id, l.book_id);
      if (l.kind !== "나란히") {
        push(out, l.book_id, l.linked_book_id);
        push(inc, l.linked_book_id, l.book_id);
      }
    });

    // 길 하나 = 이어진 덩어리 하나
    const seen = new Set(), comps = [];
    for (const n of any.keys()) {
      if (seen.has(n)) continue;
      const c = [], st = [n]; seen.add(n);
      while (st.length) {
        const x = st.pop(); c.push(x);
        for (const m of any.get(x) || []) if (!seen.has(m)) { seen.add(m); st.push(m); }
      }
      comps.push(c);
    }

    /* 깊이 = 입구에서 몇 걸음인가. 고리가 있어도 멈추도록 방문 표시를 둔다 */
    const depth = new Map();
    const depthOf = (n, guard) => {
      if (depth.has(n)) return depth.get(n);
      if (guard.has(n)) return 0;          // 고리 — 여기서 끊는다
      guard.add(n);
      const ps2 = inc.get(n) || [];
      const d = ps2.length ? Math.max(...ps2.map((p) => depthOf(p, guard) + 1)) : 0;
      guard.delete(n);
      depth.set(n, d);
      return d;
    };
    for (const n of any.keys()) depthOf(n, new Set());

    /* 자리 잡기 — 길 하나가 한 덩어리다. 덩어리 안에서는 깊이가 가로 칸이 되고,
       덩어리끼리는 가로로 채우다 자리가 모자라면 줄을 바꾼다. 짧은 길 열한 개를
       세로로만 쌓으면 지도가 3,500px 짜리 두루마리가 되어 아무도 안 본다. */
    const shaped = comps.map((c) => {
      const cols = new Map();
      c.forEach((n) => { const d = depth.get(n) || 0; push(cols, d, n); });
      const keys = [...cols.keys()].sort((a, b2) => a - b2);
      let rows = 0;
      keys.forEach((d) => {
        cols.get(d).sort((a, b2) =>
          (byId.get(a)?.t || "").localeCompare(byId.get(b2)?.t || "", "ko"));
        rows = Math.max(rows, cols.get(d).length);
      });
      return { ids: c, cols, keys, w: keys.length, rows };
    }).sort((a, b2) => b2.w * b2.rows - a.w * a.rows);   // 큰 덩어리부터 자리를 준다

    const canvasW = Math.max(Wd, 26 + CELL_W + 20);
    const perRow = Math.max(1, Math.floor((canvasW - 40) / CELL_W));
    const pos = new Map();
    /* 한 줄을 채울 때, 남은 칸에 들어가는 덩어리를 뒤에서 끌어와 메운다
       (그냥 순서대로 흘리면 세 칸짜리 뒤에 한 칸이 남아 지도가 텅 빈다) */
    const left = [...shaped];
    let yCursor = 30, maxCol = 1;
    while (left.length) {
      let xCol = 0, bandH = 0;
      while (left.length) {
        const i = left.findIndex((s) => xCol + s.w <= perRow);
        if (i < 0) break;                       // 남은 칸에 들어갈 덩어리가 없다
        const s = left.splice(i, 1)[0];
        const x0 = 26 + xCol * CELL_W;
        s.keys.forEach((d, di) => {
          s.cols.get(d).forEach((n, r) => pos.set(n, [x0 + di * CELL_W, yCursor + r * CELL_H]));
        });
        bandH = Math.max(bandH, s.rows * CELL_H);
        xCol += s.w;
        maxCol = Math.max(maxCol, xCol);
      }
      if (!bandH) {   // 한 줄보다 넓은 덩어리 — 혼자 한 줄을 쓴다
        const s = left.shift();
        s.keys.forEach((d, di) => {
          s.cols.get(d).forEach((n, r) => pos.set(n, [26 + di * CELL_W, yCursor + r * CELL_H]));
        });
        bandH = s.rows * CELL_H;
        maxCol = Math.max(maxCol, s.w);
      }
      yCursor += bandH + 26;
    }

    const needW = 26 + maxCol * CELL_W + 20;
    const W = Math.max(Wd, needW), H = Math.max(160, yCursor);

    // 입구(들어오는 순서 이음이 없고 나가는 것이 있는 책)와 길 이름
    const entries = [...any.keys()].filter((n) => !(inc.get(n) || []).length);
    const named = entries.map((n) => byId.get(n)).filter((b) => b && b.pathName);

    ps.textContent =
      `길 ${comps.length}갈래 · 이음 ${es.length}개 · 입구 ${entries.length}곳`
      + (named.length ? ` — ${named.map((b) => `「${b.pathName}」`).join(" ")}` : "")
      + " · 책을 누르면 서표가 열립니다";
    cvs.setAttribute("aria-label",
      `이음의 항로도 — 길 ${comps.length}갈래, 이음 ${es.length}개. `
      + comps.map((c) => (byId.get(c[0])?.t || "") + ` 등 ${c.length}권`).join(", "));

    // 표지를 미리 실어 둔다 — 캔버스는 다 그린 뒤 한 번에 뜬다
    const imgs = new Map();
    await Promise.all([...any.keys()].map(async (n) => {
      const b = byId.get(n);
      const im = await loadCover(b?.cover || null);
      if (im) imgs.set(n, im);
    }));

    cvs.hidden = false;
    cvs.width = W * 2; cvs.height = H * 2;
    cvs.style.width = W + "px"; cvs.style.height = H + "px";
    const c = cvs.getContext("2d");
    c.setTransform(2, 0, 0, 2, 0, 0);
    c.clearRect(0, 0, W, H);

    /* 손으로 이름 붙인 무리는 네모 상자로 묶는다 — 순서는 없지만 한 덩어리인 책들 */
    const groups = new Map();
    for (const n of any.keys()) {
      const b = byId.get(n);
      if (b?.series) push(groups, b.series, n);
    }
    groups.forEach((ids, name) => {
      if (ids.length < 2) return;
      const xs = ids.map((n) => pos.get(n)[0]), ys = ids.map((n) => pos.get(n)[1]);
      const x0 = Math.min(...xs) - 14, x1 = Math.max(...xs) + CV_W + 14;
      const y0 = Math.min(...ys) - 26, y1 = Math.max(...ys) + CV_H + 30;
      c.strokeStyle = "rgba(224,177,94,.55)"; c.lineWidth = 1.2;
      c.setLineDash([]);
      c.strokeRect(x0, y0, x1 - x0, y1 - y0);
      c.fillStyle = "rgba(224,177,94,.75)";
      c.font = "10px 'IBM Plex Mono', monospace"; c.textAlign = "left";
      c.fillText(name, x0 + 6, y0 - 5);
    });

    /* 화살표 — 순서 이음. 사람이 그은 길은 굵은 놋빛, 기계가 이은
       시리즈는 가는 실선. 읽은 책으로 들어가는 길에는 불이 들어온다. */
    const arrow = (p, q, l) => {
      const auto = isAuto(l);
      const lit = byId.get(l.linked_book_id)?.st === "읽음";
      const x1 = p[0] + CV_W, y1 = p[1] + CV_H / 2;
      const x2 = q[0], y2 = q[1] + CV_H / 2;
      c.strokeStyle = lit ? "rgba(224,177,94,.95)"
        : auto ? "rgba(151,116,47,.5)" : "rgba(224,177,94,.72)";
      c.lineWidth = auto ? 1 : 1.8;
      c.setLineDash(l.kind === "나란히" ? [4, 3] : []);
      c.beginPath();
      c.moveTo(x1, y1);
      const mx = (x1 + x2) / 2;
      c.bezierCurveTo(mx, y1, mx, y2, x2 - 8, y2);
      c.stroke();
      c.setLineDash([]);
      if (l.kind !== "나란히") {
        const a = Math.atan2(y2 - y1, 10);
        c.fillStyle = c.strokeStyle;
        c.beginPath();
        c.moveTo(x2 - 1, y2);
        c.lineTo(x2 - 9, y2 - 4 - Math.sin(a));
        c.lineTo(x2 - 9, y2 + 4 - Math.sin(a));
        c.closePath(); c.fill();
      }
      if (l.note) {
        c.fillStyle = "rgba(226,213,184,.82)";
        c.font = "10px 'Noto Sans KR', sans-serif";
        c.textAlign = "center";
        const ty = (y1 + y2) / 2 - 8;
        const w = c.measureText(l.note).width + 8;
        c.save();
        c.fillStyle = "rgba(16,10,4,.82)";
        c.fillRect(mx - w / 2, ty - 10, w, 14);
        c.restore();
        c.fillStyle = "rgba(226,213,184,.9)";
        c.fillText(l.note.length > 16 ? l.note.slice(0, 16) + "…" : l.note, mx, ty);
      }
    };
    es.forEach((l) => {
      const p = pos.get(l.book_id), q = pos.get(l.linked_book_id);
      if (!p || !q) return;
      // 나란히는 방향이 없으니 왼쪽에 있는 쪽에서 긋는다
      if (l.kind === "나란히" && p[0] > q[0]) arrow(q, p, l);
      else arrow(p, q, l);
    });

    /* 책 — 표지(없으면 활자 얼굴)와 제목, 입구에는 「여기서 시작」 */
    chartHit = [];
    for (const [n, [x, y]] of pos) {
      const b = byId.get(n);
      if (!b) continue;
      drawFace(c, x, y, CV_W, CV_H, b, imgs.get(n) || null, b.st !== "읽음");
      c.fillStyle = b.st === "읽음" ? "rgba(242,231,200,.95)" : "rgba(226,213,184,.7)";
      c.font = "10.5px 'Gowun Batang', serif";
      c.textAlign = "center";
      wrap2(c, b.t, x + CV_W / 2, y + CV_H + 14, CELL_W - 34);
      if (!(inc.get(n) || []).length && (out.get(n) || []).length) {
        c.fillStyle = "#E0B15E";
        c.font = "700 10px 'Gowun Batang', serif";
        c.fillText(b.pathName ? `「${b.pathName}」` : "여기서 시작", x + CV_W / 2, y - 8);
      }
      chartHit.push({ x, y, b });
    }

    cvs.onclick = (ev) => {
      const r = cvs.getBoundingClientRect();
      const mx = (ev.clientX - r.left) * (W / r.width);
      const my = (ev.clientY - r.top) * (H / r.height);
      const hit = chartHit.find((h) =>
        mx >= h.x - 6 && mx <= h.x + CV_W + 6 && my >= h.y - 6 && my <= h.y + CV_H + 20);
      if (hit) openExlibris(hit.b, bookWall(hit.b));
    };

    /* 길을 걷는다 — 가장 긴 길의 입구부터 한 권씩 */
    chartPaths = comps.map((ids) => {
      const start = ids.find((n) => !(inc.get(n) || []).length) ?? ids[0];
      const order = [], seen2 = new Set();
      const walkFrom = (n) => {
        if (seen2.has(n)) return;
        seen2.add(n); order.push(n);
        (out.get(n) || []).forEach(walkFrom);
      };
      walkFrom(start);
      ids.forEach(walkFrom);   // 방향 밖에 남은 책도 뒤에 붙인다
      return order.map((n) => byId.get(n)).filter(Boolean);
    }).sort((a, b2) => b2.length - a.length);
  }
  let chartPaths = [];

  /* ── 콜로폰 ────────────────────────────────────────────
     책 뒤의 판권장처럼, 이 서재가 지금 몇 권이고 마지막으로 언제 자랐는지.
     숫자를 정적 파일에 박아 두면 반드시 거짓말이 되므로 셈에서 가져온다. */
  function renderColophon() {
    const el = $("colo-how");
    if (!el) return;
    const books = allBooks();
    const grew = books
      .map((b) => b.acquired)
      .filter(Boolean)
      .sort()
      .pop();
    const when = grew ? new Date(grew) : null;
    const day = when && !isNaN(when)
      ? `${when.getFullYear()}년 ${when.getMonth() + 1}월 ${when.getDate()}일에 마지막 한 권이 들어왔습니다`
      : "";
    el.textContent = books.length
      ? `지금 ${books.length.toLocaleString("ko-KR")}권` + (day ? ` · ${day}` : "")
      : "서가 뒤의 방 · rokiz.net";
  }

  /* ── 현관에 걸리는 길 ──────────────────────────────────
     항로도는 통계 안쪽에 있어서, 들어온 사람은 길이 있는 줄도 모른다.
     이름을 붙인 길(books.path_name)과 가장 긴 길 하나를 현관에 내건다.
     지도를 그리는 것과 달리 표지도 캔버스도 필요 없으므로 따로 센다. */
  let foyerPaths = [];
  async function renderPaths() {
    const sec = $("paths"), row = $("pathrow");
    const db = window.PostLibrosDB;
    if (!sec || !row) return;
    const byId = new Map(allBooks().filter((b) => b.id).map((b) => [b.id, b]));
    if (!db?.listAllLinks || !byId.size) { sec.hidden = true; return; }
    let links = [];
    try { links = await db.listAllLinks(); }
    catch (e) { console.warn("[길] 이음을 읽지 못했습니다:", e); sec.hidden = true; return; }
    LINK_N = links.length;   // 현관의 첫 문장이 이 숫자를 쓴다
    renderFoyerLine();       // 이음 수가 이제야 왔으므로 문장을 다시 쓴다

    /* 「순서」로 이은 것만 길이 된다 — 나란히 놓은 짝은 길이 아니다 */
    const out = new Map(), inc = new Map();
    links.filter((l) => l.kind !== "나란히" && byId.has(l.book_id) && byId.has(l.linked_book_id))
      .forEach((l) => {
        if (!out.has(l.book_id)) out.set(l.book_id, []);
        out.get(l.book_id).push(l.linked_book_id);
        if (!inc.has(l.linked_book_id)) inc.set(l.linked_book_id, []);
        inc.get(l.linked_book_id).push(l.book_id);
      });

    /* 입구(들어오는 화살이 없는 책)에서 앞으로만 따라간다 */
    const chains = [];
    const used = new Set();
    const entries = [...byId.keys()].filter((id) => (out.get(id) || []).length && !(inc.get(id) || []).length);
    for (const start of entries) {
      const list = [], seen = new Set();
      let cur = start;
      while (cur && !seen.has(cur)) {
        seen.add(cur); used.add(cur);
        list.push(byId.get(cur));
        cur = (out.get(cur) || [])[0];
      }
      if (list.length >= 2) chains.push(list);
    }
    chains.sort((a, b) => b.length - a.length);

    /* 이름 붙인 길이 먼저, 그다음 가장 긴 길. 다 합쳐 넷까지 */
    const named = chains.filter((c) => c[0].pathName);
    const rest = chains.filter((c) => !c[0].pathName);
    foyerPaths = [...named, ...rest].slice(0, 4);
    if (!foyerPaths.length) { sec.hidden = true; return; }

    sec.hidden = false;
    row.innerHTML = "";
    foyerPaths.forEach((list, i) => {
      const read = list.filter((b) => b.st === "읽음").length;
      const card = document.createElement("button");
      card.className = "pathcard";
      card.type = "button";
      // 제목은 사람이 적은 글이다 — 태그로 읽히지 않게 textContent 로만 넣는다
      card.innerHTML = `<b></b><span class="pathwho"></span><span class="pathn"></span>`;
      card.querySelector("b").textContent =
        list[0].pathName || `「${list[0].t}」에서 시작하는 길`;
      card.querySelector(".pathwho").textContent =
        list.map((b) => b.t).slice(0, 3).join(" → ") + (list.length > 3 ? " → …" : "");
      card.querySelector(".pathn").textContent = `${list.length}권 · 읽은 것 ${read}권`;
      card.addEventListener("click", () => {
        walk = { list };
        openExlibris(list[0], bookWall(list[0]));
      });
      row.appendChild(card);
      if (i === 0) card.classList.add("first");
    });
  }

  /* ── 길을 걷는다 ────────────────────────────────────────
     지도를 눈으로 따라가는 것과 실제로 걷는 것은 다르다. 가장 긴 길의
     입구에서 시작해 서표를 열고, 다 읽으면 다음 한 권으로 넘어간다. */
  function syncWalkRow() {
    const btn = $("x-walknext");
    if (!btn) return;
    if (!walk || !openBook) { btn.hidden = true; return; }
    const i = walk.list.indexOf(openBook);
    if (i < 0) { btn.hidden = true; return; }
    const next = walk.list[i + 1];
    btn.hidden = false;
    btn.textContent = next
      ? `이 길의 다음 책 — 「${next.t}」 →`
      : "길의 끝입니다 — 여기까지";
    btn.disabled = !next;
  }
  $("x-walknext")?.addEventListener("click", () => {
    if (!walk || !openBook) return;
    const next = walk.list[walk.list.indexOf(openBook) + 1];
    if (next) openExlibris(next, bookWall(next));
  });
  $("chart-walk")?.addEventListener("click", () => {
    const path = chartPaths[0];
    if (!path?.length) return;
    walk = { list: path };
    openExlibris(path[0], bookWall(path[0]));
  });
  /* 그림으로 내려받는다 — 커뮤니티에 도는 플로우 차트는 결국 이미지 한 장이다 */
  $("chart-png")?.addEventListener("click", () => {
    const cvs = $("linkweb");
    if (!cvs || cvs.hidden) return;
    /* 머리에 제목과 셈, 발에 범례와 날짜를 붙인다 —
       그림 한 장만 떠도 무엇을 보는 것인지 알 수 있어야 나눔물이 된다 */
    const 머리 = 92, 발 = 56;
    const out = document.createElement("canvas");
    out.width = cvs.width; out.height = cvs.height + (머리 + 발) * 2;
    const c = out.getContext("2d");
    c.fillStyle = "#100A04";
    c.fillRect(0, 0, out.width, out.height);
    c.drawImage(cvs, 0, 머리 * 2);
    c.setTransform(2, 0, 0, 2, 0, 0);
    const W2 = out.width / 2, H2 = out.height / 2;

    c.textAlign = "left";
    c.fillStyle = "#E2D5B8";
    c.font = "700 24px 'Gowun Batang', serif";
    c.fillText("이음의 항로도", 26, 38);

    // 이 지도가 무엇을 담고 있는지 — 셈은 지금 그린 것에서 그대로 가져온다
    const 걸린책 = chartPaths.flat();
    const 읽음 = 걸린책.filter((b) => b.st === "읽음").length;
    const 이름 = chartPaths.map((p) => p[0]?.pathName).filter(Boolean);
    c.fillStyle = "rgba(224,177,94,.9)";
    c.font = "12px 'IBM Plex Mono', monospace";
    c.fillText(
      `길 ${chartPaths.length}갈래 · 책 ${걸린책.length}권 · 읽어 낸 것 ${읽음}권`,
      26, 60);
    if (이름.length) {
      c.fillStyle = "rgba(163,148,122,.85)";
      c.font = "12px 'Gowun Batang', serif";
      c.fillText(이름.map((n) => `「${n}」`).join("  "), 26, 78);
    }
    // 머리와 그림 사이에 가는 선 하나
    c.strokeStyle = "rgba(224,177,94,.28)"; c.lineWidth = 1;
    c.beginPath(); c.moveTo(26, 머리 - 12); c.lineTo(W2 - 26, 머리 - 12); c.stroke();

    // 범례 — 화살표의 굵기와 밝기가 뜻하는 것
    const fy = H2 - 발 + 22;
    c.beginPath(); c.moveTo(26, fy - 24); c.lineTo(W2 - 26, fy - 24); c.stroke();
    const 범례 = [
      ["굵은 화살", "손으로 그은 길"],
      ["가는 화살", "시리즈 (저절로 이어진 것)"],
      ["밝은 화살", "읽어 낸 책으로 들어가는 길"],
    ];
    let lx = 26;
    범례.forEach(([k, v], i) => {
      c.strokeStyle = i === 1 ? "rgba(163,148,122,.6)" : "rgba(224,177,94,.95)";
      c.lineWidth = i === 0 ? 2.2 : i === 1 ? 1 : 2.2;
      c.beginPath(); c.moveTo(lx, fy); c.lineTo(lx + 22, fy); c.stroke();
      c.fillStyle = "rgba(163,148,122,.9)";
      c.font = "10px 'IBM Plex Mono', monospace";
      c.fillText(v, lx + 28, fy + 3.5);
      lx += 28 + c.measureText(v).width + 26;
    });
    c.textAlign = "right";
    c.fillStyle = "rgba(163,148,122,.7)";
    c.font = "10px 'IBM Plex Mono', monospace";
    c.fillText(`서가 뒤의 방 · rokiz.net/books · ${new Date().toLocaleDateString("ko-KR")}`,
      W2 - 26, fy + 3.5);
    c.textAlign = "left";
    let url;
    try { url = out.toDataURL("image/png"); }
    catch {
      // 표지 중에 CORS 를 안 열어 준 것이 섞이면 캔버스가 오염돼 내보낼 수 없다
      $("ps-linkweb").textContent = "그림으로 뽑지 못했습니다 — 표지 하나가 내려받기를 막고 있습니다";
      return;
    }
    const a = document.createElement("a");
    a.href = url;
    a.download = `서가뒤의방-항로도-${new Date().toISOString().slice(0, 10)}.png`;
    a.click();
  });

  /* 서표의 시리즈 잇기 — 같은 무리(손으로 적은 시리즈, 또는 밑동·지은이가
     같은 자동 시리즈)의 이웃 권끼리 사슬처럼 잇는다 (1↔2, 2↔3 …).
     예전에는 통계의 별자리 밑에 있었지만, 그 별자리는 다른 작품끼리의
     컬렉션이라(주인의 뜻) 시리즈 제안은 책 앞으로 왔다. 주인에게만 보인다. */
  async function chainSeries(btn, base, group) {
    const db = window.PostLibrosDB;
    if (!db?.addLink || !db?.listAllLinks) return;
    btn.disabled = true;
    btn.textContent = `「${base}」 잇는 중…`;
    try {
      const es = await db.listAllLinks();
      const linked = new Set((es || []).map((l) => [l.book_id, l.linked_book_id].sort().join("|")));
      // 권수 순으로, 권수가 없으면(손묶기 전집) 제목 순으로 사슬을 짠다
      const vols = group
        .map((x) => [Number(x.t.match(SERIES_RE)?.[2] ?? NaN), x])
        .sort((p, q2) => (isNaN(p[0]) || isNaN(q2[0]))
          ? p[1].t.localeCompare(q2[1].t, "ko") : p[0] - q2[0]);
      let made = 0;
      for (let i = 1; i < vols.length; i++) {
        const a = vols[i - 1][1], b = vols[i][1];
        if (linked.has([a.id, b.id].sort().join("|"))) continue;
        await db.addLink(a.id, b.id);
        made++;
      }
      btn.textContent = made ? `이었습니다 — ${made}곳` : "이미 다 이어져 있습니다";
      if (made && openBook) renderLinks(openBook);   // 이음 줄을 새로 편다
    } catch (err) {
      btn.textContent = "잇지 못했습니다 — " + (err.message || err);
      btn.disabled = false;
    }
  }

  $("listmore").addEventListener("click", () => {
    listShown += LIST_STEP;
    renderList();
  });

  $("covermore").addEventListener("click", () => {
    coversShown += COVER_STEP;
    renderCovers();
  });

  /* 「더 본다」가 화면에 들어오면 스스로 눌린다 — 스크롤이 곧 넘김이다.
     단추는 그대로 남는다: 관찰자가 없는 브라우저의 예비 길. */
  if ("IntersectionObserver" in window) {
    const autoMore = new IntersectionObserver((ens) => {
      ens.forEach((en) => {
        if (en.isIntersecting && !en.target.hidden) en.target.click();
      });
    }, { rootMargin: "200px" });
    autoMore.observe($("listmore"));
    autoMore.observe($("covermore"));
  }

  document.querySelectorAll(".sortbtn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const k = btn.dataset.k;
      // 같은 칸을 다시 누르면 방향만 뒤집는다
      if (sortKey === k) sortAsc = !sortAsc;
      else { sortKey = k; sortAsc = true; }
      document.querySelectorAll(".sortbtn").forEach((o) => {
        o.classList.toggle("on", o === btn);
        o.dataset.dir = o === btn ? (sortAsc ? "↑" : "↓") : "";
        o.closest("th")?.setAttribute("aria-sort",
          o === btn ? (sortAsc ? "ascending" : "descending") : "none");
      });
      listShown = LIST_STEP;
      renderList();
    });
  });

  /* 한 글자마다 벽 넷을 통째로 다시 그리면 1,300권에서는 손가락을 따라오지
     못한다. 타자가 멎은 뒤에 한 번만 그린다. */
  let searchTimer = null;
  $("q").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      listShown = LIST_STEP;   // 검색을 바꾸면 처음부터 다시 센다
      coversShown = COVER_STEP;
      renderWalls();
      syncFindNote();
      if (curView === "covers") renderCovers();
      if (curView === "list") renderList();
    }, 140);
  });

  /* ── 검색의 안내판 ──────────────────────────────────────
     서가 뷰의 벽은 한 벽에 예순여섯 권만 그린다. 검색한 사람은 「12권 응답」
     이라는 숫자만 보고 그 열두 권이 어디 있는지 모른 채 벽을 훑는다.
     응답이 벽 한 면에 다 서지 못할 만큼 많으면, 목록으로 가는 문을 연다. */
  const WALL_DRAWN = 66;
  function syncFindNote() {
    const note = $("findnote"), t = $("findnote-t");
    if (!note || !t) return;
    const word = $("q").value.trim();
    const on = curView === "walls" && (word || stFilter);
    if (!on) { note.hidden = true; return; }
    const n = filteredBooks().length;
    if (!n) {
      note.hidden = false;
      t.textContent = word
        ? `"${word}" — 어느 벽도 응답하지 않았습니다.`
        : "아직 읽어 낸 책이 없습니다.";
      $("findgo").hidden = true;
      return;
    }
    /* 한 벽에 다 서는 만큼이면 안내가 필요 없다 — 눈으로 이미 다 보인다 */
    const crowded = n > WALL_DRAWN;
    note.hidden = !crowded;
    if (!crowded) return;
    $("findgo").hidden = false;
    t.textContent = word
      ? `"${word}" — ${n.toLocaleString()}권이 응답했습니다. 벽에는 앞줄만 섭니다.`
      : `읽어 낸 ${n.toLocaleString()}권. 벽에는 앞줄만 섭니다.`;
  }
  $("findgo")?.addEventListener("click", () => {
    document.getElementById("tab-list")?.click();
    $("v-list")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  /* ── 사다리: 위치 표식 + 고도계 ───────────────────────── */
  function maxScroll() { return document.documentElement.scrollHeight - innerHeight; }
  function layoutLadder() {
    const rail = $("rail");
    rail.querySelectorAll(".dot").forEach(d => d.remove());
    const targets = [
      ...wallEls.map(({el, w}) => ({ el, label: w.nm, hit: !!(w.hits && w.hits > 0) })),
      { el: $("crate"), label: "새로 도착한 궤짝", hit: false },
      { el: $("desk"), label: "책상 — 오늘의 책", hit: false }
    ];
    const ms = maxScroll();
    const carH = 30, railH = rail.clientHeight;
    targets.forEach(t => {
      if (!t.el || t.el.hidden || t.el.offsetParent === null) return;
      const target = Math.min(ms, Math.max(0, t.el.offsetTop - 70));
      const p = ms > 0 ? target / ms : 0;
      const dot = document.createElement("button");
      dot.className = "dot" + (t.hit ? " hit" : "");
      dot.style.top = `${carH/2 + p * (railH - carH)}px`;
      dot.title = t.label;
      dot.setAttribute("aria-label", t.label + "로 이동");
      dot.addEventListener("click", (e) => {
        e.stopPropagation();
        scrollTo({ top: target, behavior: "smooth" });
      });
      rail.appendChild(dot);
    });
  }
  function updateLadder() {
    const ms = maxScroll();
    const p = ms > 0 ? Math.min(1, Math.max(0, scrollY / ms)) : 0;
    const rail = $("rail");
    const carH = 30;
    $("car").style.top = `${p * (rail.clientHeight - carH)}px`;
    $("alt").textContent = `지상 ${(9.2 * (1 - p)).toFixed(1)}m`;
    /* 지금 지나는 표식이 밝아진다 */
    const carY = carH / 2 + p * (rail.clientHeight - carH);
    let nearest = null, best = Infinity;
    rail.querySelectorAll(".dot").forEach(d => {
      const dy = Math.abs(parseFloat(d.style.top) - carY);
      if (dy < best) { best = dy; nearest = d; }
      d.classList.remove("here");
    });
    if (nearest && best < 40) nearest.classList.add("here");
  }
  $("rail").addEventListener("click", (e) => {
    const r = $("rail").getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    scrollTo({ top: p * maxScroll(), behavior: "smooth" });
  });
  addEventListener("scroll", updateLadder, { passive: true });
  addEventListener("resize", () => { layoutLadder(); updateLadder(); });

  /* ── 궤짝: 자물쇠 → 뚜껑 열림 ─────────────────────────── */
  $("cratelid").addEventListener("click", () => {
    const wrap = $("cratewrap");
    wrap.classList.add("open");

    /* 다 열린 뚜껑은 화면에서 아예 치운다.
       투명해지기만 하면 3D 로 젖혀진 판이 자리에는 그대로 남아, 일부
       모바일 브라우저에서 가로로 삐져나온 것으로 계산된다. 그러면 화면이
       축소되며 좌우 여백만 넓어진 것처럼 보인다.
       transitionend 를 기다리되, 모션을 끈 환경에서는 그 신호가 오지
       않으므로 시간제한을 함께 둔다. */
    const tuck = () => wrap.classList.add("shut");
    const lid = $("cratelid");
    lid.addEventListener("transitionend", (e) => {
      if (e.propertyName === "transform") tuck();
    }, { once: true });
    setTimeout(tuck, 1300);
  });
  document.querySelectorAll(".cand").forEach(c => {
    c.addEventListener("click", () => {
      c.closest(".crateitem").classList.add("resolved");
      /* 모두 확정되면 궤짝 바닥이 보인다 */
      const items = document.querySelectorAll(".crateitem");
      if ([...items].every(it => it.classList.contains("resolved")) && !$("crate-done")) {
        const done = document.createElement("p");
        done.id = "crate-done";
        done.className = "note";
        done.style.cssText = "margin:12px 0 0;border-top:1px dashed var(--line);padding-top:12px;color:var(--brass);";
        done.textContent = "…궤짝 바닥이 보인다. 16권 모두 제자리를 찾았다.";
        document.querySelector(".cratebox").appendChild(done);
      }
    });
  });

  /* ── 서표 ─────────────────────────────────────────────── */
  let openBook = null;   /* 지금 펼쳐 둔 책 — 고칠 때 대상이 된다 */
  let returnFocus = null;

  function openExlibris(b, w) {
    openBook = b;
    $("x-mark").textContent = `${w ? w.nm : "책상 위"} · ${b.cat || "문학"}`;
    // 표지가 있으면 걸어 둔다 — 없으면 실물 책등 조각이라도.
    // 깨진 그림은 error 핸들러가 내린다
    const cv = $("x-cover");
    const face = b.cover || b.spineImg;
    if (face) {
      cv.src = face;
      cv.alt = `${b.t} ${b.cover ? "표지" : "책등"}`;
      cv.classList.toggle("spine", !b.cover);
      cv.hidden = false;
    } else {
      cv.hidden = true;
      cv.removeAttribute("src");
    }
    $("x-title").textContent = b.t;
    $("x-byline").textContent =
      `${b.a}${b.pages ? " · " + b.pages.toLocaleString() + "쪽" : ""}${b.year ? " · " + b.year + " 입고" : ""}`
      + (b.readYear ? ` · ${b.readYear} 읽음` : "");
    $("veil").classList.add("show");
    $("exlibris").classList.add("show");
    /* 서표에 고유 주소를 준다 — 이 책 한 권을 그대로 건네줄 수 있어야 한다.
       뒤로 가기가 서표를 닫는 문이 되도록 pushState 가 아니라 해시를 쓴다. */
    if (b.id) { hashSelf = true; location.hash = "book/" + b.id; }
    syncWalkRow();
    syncPhotoRow(b);
    // 닫으면 원래 있던 자리로 돌아가도록 표를 남긴다
    returnFocus = document.activeElement;
    $("x-close").focus();

    const owner = document.body.classList.contains("owner");
    const db = window.PostLibrosDB;

    /* 서재는 공개다 — 방문자도 서지·기록·여백을 읽는다.
       고치는 자리(x-edit)와 「기록을 부탁한다」만 주인의 것이다. */
    $("x-edit").hidden = !owner;
    $("x-memoedit").hidden = !owner;
    $("x-memo").hidden = owner;
    $("x-saved").hidden = true;
    // 시리즈 잇기는 주인의 것 — 주인 분기가 무리를 세어 다시 편다
    const slBtn = $("x-serieslink");
    if (slBtn) slBtn.hidden = true;
    if (!owner) {
      // 여백의 기록은 읽기 전용으로
      $("x-memo").textContent = b.memo || "아직 여백에 적힌 말이 없다.";
    } else {
      $("x-memoedit").value = b.memo || "";
      /* 읽어 낸 책인데 여백이 비어 있으면 — 이 서재에서 AI 가 대신 쓸 수 없는
         유일한 칸이다. 빈 칸을 조용히 두지 않고 한 줄을 청한다.
         (읽지 않은 책에는 청하지 않는다 — 아직 할 말이 없는 게 맞다) */
      const 빈여백 = b.st === "읽음" && !(b.memo || "").trim();
      $("x-memoedit").classList.toggle("asking", 빈여백);
      $("x-memoedit").placeholder = 빈여백
        ? `읽어 낸 책입니다 — 한 줄만 남겨 두세요. 무엇이 남았는지, 누구에게 권할지.`
        : "여백에 적어 둘 말 — 자리를 옮기면 저장됩니다";
      document.querySelectorAll("#x-status button").forEach(btn =>
        btn.setAttribute("aria-selected", btn.dataset.st === b.st ? "true" : "false"));
      $("x-wall").value = b.wall || "";
      $("x-shelf").value = b.shelfNo || "";
      $("x-t").value = b.t || "";
      $("x-a").value = b.a || "";
      $("x-enrich-note").textContent = "ISBN·표지·쪽수를 이 책만 다시 채웁니다";
      $("x-enrich").disabled = false;
      $("x-isbn").value = b.isbn || "";
      $("x-cover-url").value = b.cover || "";
      $("x-series").value = b.series || "";
      $("x-path").value = b.pathName || "";
      // 이미 쓰던 시리즈 이름들을 골라 적게 — 오타로 무리가 갈라지지 않게
      const dl = $("serieslist");
      if (dl) {
        dl.innerHTML = "";
        [...new Set(allBooks().map((x) => x.series).filter(Boolean))].sort()
          .forEach((s) => {
            const opt = document.createElement("option");
            opt.value = s;
            dl.appendChild(opt);
          });
      }
      syncBookmarkRow(b);
      syncReadYearRow(b);
      syncOpenNowRow(b);
      renderLinks(b);
      // 시리즈 잇기 단추 — 같은 무리가 두 권 넘으면 이음 줄 밑에 뜬다
      const sbtn = $("x-serieslink");
      if (sbtn) {
        const m2 = b.t.match(SERIES_RE);
        const base2 = b.series || (m2 ? m2[1].trim() : null);
        const group = base2 && b.id
          ? allBooks().filter((x) => x.id && (b.series
              ? x.series === b.series
              : (x.t.match(SERIES_RE)?.[1].trim() === base2 && x.a === b.a)))
          : [];
        sbtn.hidden = group.length < 2;
        if (group.length >= 2) {
          sbtn.disabled = false;
          sbtn.textContent = `「${base2}」 ${group.length}권을 시리즈로 잇는다`;
          sbtn.onclick = () => chainSeries(sbtn, base2, group);
        }
      }
    }

    // 기록은 있으면 누구에게나 보여주고, 없을 때 짓는 단추는 주인에게만
    $("x-full").hidden = true;
    $("x-pending").hidden = false;
    $("x-none").textContent = "기록을 찾는 중…";
    $("x-gen").hidden = true;
    if (!db || !b.id) {
      $("x-none").textContent = "이 책의 기록은 아직 없습니다.";
      return;
    }

    db.getSummary(b.id).then((s) => {
      if (openBook !== b) return;          // 그새 다른 책을 폈다면 버린다
      if (s) {
        $("x-summary").textContent = s.summary;
        $("x-full").hidden = false;
        $("x-pending").hidden = true;
        // 방문자에게는 여백(메모)이 x-full 안에 있으니 함께 보인다
        if (!owner) $("x-memo").hidden = false;
      } else {
        $("x-none").textContent = "이 책의 기록은 아직 없습니다.";
        $("x-gen").hidden = !owner;
        $("x-gen").disabled = false;
        $("x-gen").textContent = "지금 기록을 부탁한다";
      }
    }).catch((err) => {
      if (openBook !== b) return;
      $("x-none").textContent = "기록을 읽지 못했습니다: " + (err.message || err);
      $("x-gen").hidden = !owner;
    });
  }

  /* ── 서표에서 고친 것을 바로 적는다 ── */
  async function saveBook(patch, applyLocal) {
    const b = openBook, db = window.PostLibrosDB;
    if (!b || !b.id || !db) return;
    try {
      await db.updateBook(b.id, patch);
      applyLocal?.(b);
      const tag = $("x-saved");
      tag.hidden = false;
      clearTimeout(saveBook._t);
      saveBook._t = setTimeout(() => { tag.hidden = true; }, 1800);
      renderAll();
    } catch (err) {
      console.error("[서표] 고치지 못했습니다:", err);
      $("x-saved").hidden = false;
      $("x-saved").textContent = "적지 못했습니다";
    }
  }
  function closeExlibris() {
    walk = null;
    if ($("x-walknext")) $("x-walknext").hidden = true;
    // ESC 로 닫으면 여백에 적던 글이 blur 를 못 만나 사라진다 — 먼저 흘려보낸다
    if (document.activeElement === $("x-memoedit")) $("x-memoedit").blur();
    $("veil").classList.remove("show");
    $("exlibris").classList.remove("show");
    openBook = null;
    // replaceState 는 hashchange 를 울리지 않으므로 표(hashSelf)를 남기지 않는다
    if (location.hash.startsWith("#book/")) {
      history.replaceState(null, "", location.pathname + location.search);
    }
    try { returnFocus?.focus(); } catch {}
    returnFocus = null;
  }

  /* ── 책 한 권의 주소 ────────────────────────────────────
     `#book/<id>` 로 들어오면 그 책의 서표가 열린 채로 서재가 시작된다.
     내가 주소를 바꾼 것과 사람이 뒤로 가기를 누른 것을 구별해야 하므로
     스스로 쓴 해시에는 표를 남긴다. */
  let hashSelf = false;
  function openFromHash() {
    if (hashSelf) { hashSelf = false; return; }
    const view = location.hash.replace(/^#/, "");
    if (["walls", "covers", "list", "stats"].includes(view)) {
      if (openBook) closeExlibris();
      if (curView !== view) setView(view);
      return;
    }
    const m = location.hash.match(/^#book\/([\w-]+)$/);
    if (!m) { if (openBook) closeExlibris(); return; }
    if (openBook?.id === m[1]) return;   // 이미 그 책이 열려 있다 (서가를 다시 그린 뒤)
    const b = allBooks().find((x) => x.id === m[1]);
    if (b) openExlibris(b, bookWall(b));
  }
  window.addEventListener("hashchange", openFromHash);
  /* 이 책을 만난 사진 — 인식에 쓴 원본 책장 사진을 새 탭에 연다.
     intake 버킷은 비공개라 서명 주소가 필요하고, 그건 주인에게만 나온다.
     그래서 방문자에게는 단추 자체를 보이지 않는다. */
  function syncPhotoRow(b) {
    const btn = $("x-photo");
    if (!btn) return;
    btn.hidden = !(b?.photoId && document.body.classList.contains("owner"));
    btn.textContent = "이 책을 만난 사진을 본다";
  }
  $("x-photo")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    if (!openBook?.photoId) return;
    btn.textContent = "사진을 여는 중…";
    const got = await window.PostLibrosDB?.spinePhotoUrl(openBook.photoId).catch(() => null);
    if (!got) { btn.textContent = "사진을 열지 못했습니다"; return; }
    const where = [got.wall ? got.wall + "의 벽" : null, got.shelf ? got.shelf + "단" : null]
      .filter(Boolean).join(" · ");
    btn.textContent = where ? `이 책을 만난 사진 — ${where}` : "이 책을 만난 사진을 본다";
    window.open(got.url, "_blank", "noopener");
  });

  $("x-share")?.addEventListener("click", async (e) => {
    if (!openBook?.id) return;
    /* 나눔 쪽 주소를 준다 — 카톡·슬랙의 미리보기는 자바스크립트를 돌리지
       않으므로 `#book/…` 을 붙이면 어느 책이든 같은 그림이 뜬다.
       b/<id>.html 에는 그 책의 표지와 제목이 태그로 박혀 있다.
       아직 안 지은 책이면 404.html 이 알아보고 서표로 돌려보낸다. */
    const 뿌리 = location.origin + location.pathname.replace(/index\.html$/, "");
    const url = `${뿌리}b/${openBook.id}.html`;
    const btn = e.currentTarget;
    const was = btn.textContent;
    try {
      await navigator.clipboard.writeText(url);
      btn.textContent = "주소를 복사했습니다";
    } catch {
      // 복사가 막힌 브라우저 — 주소창에라도 남겨 두면 사람이 긁어 갈 수 있다
      btn.textContent = "복사가 막혀 있습니다 — 주소창을 그대로 쓰세요";
    }
    setTimeout(() => { btn.textContent = was; }, 2200);
  });
  /* 장서를 다 실은 뒤에 한 번 — 그전에는 찾을 책이 없다 */
  window.PostLibrosOpenHash = openFromHash;
  // 알라딘 표지 주소가 죽어 있으면 그림 자리를 걷는다
  $("x-cover").addEventListener("error", () => { $("x-cover").hidden = true; });
  $("x-close").addEventListener("click", closeExlibris);
  $("veil").addEventListener("click", closeExlibris);
  /* 서표는 장막 위에 뜬 방이다 — Tab 이 장막 뒤 서가로 새어 나가면
     보이지 않는 곳에 초점이 놓여 길을 잃는다. 안에서만 돌게 묶는다. */
  $("exlibris").addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const able = [...$("exlibris").querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter((el) => !el.disabled && el.offsetParent !== null);
    if (!able.length) return;
    const first = able[0], last = able[able.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  $("x-gen").addEventListener("click", async () => {
    const db = window.PostLibrosDB, b = openBook;
    if (!db || !b || !b.id) {
      // 표본 화면 — 실제로 짓지는 않는다
      $("x-pending").hidden = true;
      $("x-full").hidden = false;
      $("x-summary").textContent = "…실서비스에서는 이 자리에서 AI가 책 소개를 지어 넣습니다. 열어보는 책에만 비용이 듭니다.";
      $("x-memo").textContent = "메모는 이 자리에서 바로 적어 넣습니다.";
      return;
    }
    $("x-gen").disabled = true;
    $("x-none").textContent = "기록을 짓는 중… (열어본 책에만 비용이 듭니다)";
    const { data, error } = await db.summarizeBook(b.id);
    if (openBook !== b) return;
    if (error || data?.error) {
      $("x-gen").disabled = false;
      $("x-none").textContent = "짓지 못했습니다 — " + (data?.error || error.message);
      return;
    }
    $("x-summary").textContent = data.summary;
    $("x-full").hidden = false;
    $("x-pending").hidden = true;
  });

  /* ── 읽음 상태 ── */
  document.querySelectorAll("#x-status button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const st = btn.dataset.st;
      document.querySelectorAll("#x-status button").forEach((o) =>
        o.setAttribute("aria-selected", o === btn ? "true" : "false"));
      // 읽음으로 바꾸는 순간의 해를 함께 적는다 — 연말에 「그 해에 읽은 책」이 남게.
      // 이미 적힌 해가 있으면 존중한다 (예전에 읽은 책을 나중에 등재했을 수 있다)
      const patch = { read_status: st };
      const ry = st === "읽음" && openBook && !openBook.readYear
        ? new Date().getFullYear() : null;
      if (ry) patch.read_year = ry;
      saveBook(patch, (b) => { b.st = st; if (ry) b.readYear = ry; });
      syncBookmarkRow(openBook && { ...openBook, st });
      syncReadYearRow(openBook && { ...openBook, st, readYear: ry || openBook.readYear });
      syncOpenNowRow(openBook && { ...openBook, st });
      if (st === "읽음") celebrateRead();
    });
  });

  /* ── 한 권을 다 읽으면 서재가 반응한다 ─────────────────
     읽음으로 바꾸는 것은 이 서재에서 가장 드물고 가장 값진 일인데
     (스무 권 남짓이다) 지금은 단추 색만 바뀐다. 촛불이 한 번 크게 흔들리고
     서표에 금빛이 번진다 — 소리도 팝업도 없이, 방이 알아차리는 만큼만. */
  function celebrateRead() {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const x = $("exlibris"), desk = $("desk");
    [x, desk].forEach((el) => {
      if (!el) return;
      el.classList.remove("lit");
      void el.offsetWidth;   // 연달아 눌러도 다시 켜지도록 흐름을 끊는다
      el.classList.add("lit");
      setTimeout(() => el.classList.remove("lit"), 1400);
    });
  }

  /* ── 읽은 해 — 읽음일 때만 보인다 ── */
  function syncReadYearRow(b) {
    const row = $("x-ry-row");
    if (!row) return;
    row.hidden = !b || b.st !== "읽음";
    if (!row.hidden) $("x-ry").value = b.readYear || "";
  }
  /* ── 시리즈 — 손으로 묶는다. 지우면 자동 접기 규칙으로 돌아간다 ── */
  /* ── 길 이름 — 이 책에서 시작하는 길 ── */
  $("x-path")?.addEventListener("change", () => {
    const v = $("x-path").value.trim();
    saveBook({ path_name: v || null }, (bk) => { bk.pathName = v || null; });
  });
  $("x-series").addEventListener("change", () => {
    const v = $("x-series").value.trim();
    saveBook({ series: v || null }, (b) => { b.series = v || null; });
  });

  $("x-ry").addEventListener("change", () => {
    const raw = $("x-ry").value.trim();
    const y = raw ? parseInt(raw, 10) : null;
    if (y && (y < 1900 || y > 2200)) return;   // DB 제약과 같은 울타리
    saveBook({ read_year: y }, (b) => { b.readYear = y; });
  });

  /* ── 책 사이 이음 — 같은 작가 계보, 인용 관계, 이어 읽기 ──
     이음은 방향이 없다: 어느 쪽에서 열어도 상대가 보인다.
     띠는 눌러서 그 책의 서표로 건너가고, ×로 푼다. */
  async function renderLinks(b) {
    const row = $("x-link-row");
    if (!row) return;
    const db = window.PostLibrosDB;
    if (!db?.listLinks || !b.id) { row.hidden = true; return; }
    row.hidden = false;
    const owner = document.body.classList.contains("owner");
    const host = $("x-linklist");
    host.innerHTML = "";
    $("x-linkpick").innerHTML = "";
    $("x-link-q").value = "";
    let links = [];
    try { links = await db.listLinks(b.id); }
    catch (err) { console.error("[이음] 읽지 못했습니다:", err); return; }
    if (openBook !== b) return;   // 그새 다른 책을 폈다
    links.forEach((l) => {
      const otherId = l.book_id === b.id ? l.linked_book_id : l.book_id;
      const other = allBooks().find((x) => x.id === otherId);
      const chip = document.createElement("span");
      chip.className = "linkchip";

      /* 이음의 방향 — 같은 줄을 양쪽에서 보면 「다음에」와 「먼저」다.
         책 하나에서 보면 셋 중 하나이므로, 한 단추로 돌려 가며 고른다.
         이것이 있어야 성좌가 아니라 길이 된다. */
      const dirOf = () => (l.kind === "나란히" ? "나란히"
        : l.book_id === b.id ? "다음에" : "먼저");
      const dir = document.createElement("button");
      dir.type = "button";
      dir.className = "linkdir";
      const paintDir = () => {
        const d = dirOf();
        dir.dataset.d = d;
        dir.textContent = d === "다음에" ? "이 책 다음에" : d === "먼저" ? "이 책보다 먼저" : "나란히";
        dir.title = "눌러서 방향을 바꿉니다 — 다음에 → 먼저 → 나란히";
        chip.dataset.d = d;
      };
      paintDir();
      dir.addEventListener("click", async () => {
        const d = dirOf();
        dir.disabled = true;
        try {
          if (d === "다음에") {
            await db.flipLink(l);
            const t = l.book_id; l.book_id = l.linked_book_id; l.linked_book_id = t;
          } else if (d === "먼저") {
            await db.updateLink(l.id, { kind: "나란히" });
            l.kind = "나란히";
          } else {
            // 나란히 → 다음에: 방향을 되살리되 이 책이 앞에 서게 한다
            if (l.book_id !== b.id) {
              await db.flipLink(l);
              const t = l.book_id; l.book_id = l.linked_book_id; l.linked_book_id = t;
            }
            await db.updateLink(l.id, { kind: "순서" });
            l.kind = "순서";
          }
          paintDir();
          renderAll();
        } catch (err) { console.error("[이음] 방향을 바꾸지 못했습니다:", err); }
        dir.disabled = false;
      });

      const go = document.createElement("button");
      go.type = "button";
      go.textContent = other ? other.t : "(서가에 없는 책)";
      if (other) go.addEventListener("click", () => openExlibris(other, bookWall(other)));
      else go.disabled = true;
      /* 이은 까닭 — 있으면 띠 안에 작게, ✎ 로 적거나 고친다.
         비어 있으면 주인에게만 「까닭을 적는다」로 보인다. 열아홉 개 이음의
         까닭이 전부 비어 있었는데, 빈 칸이 아무 말도 하지 않아서였다 —
         화살표에 한마디가 붙어야 항로도가 비로소 항로도가 된다. */
      const why = document.createElement("i");
      why.className = "linknote" + (!l.note && owner ? " askwhy" : "");
      why.textContent = l.note || (owner ? "까닭을 적는다" : "");
      const pen = document.createElement("button");
      pen.type = "button";
      pen.className = "unlink pen";
      pen.textContent = "✎";
      pen.setAttribute("aria-label", "이은 까닭 적기");
      const askNote = () => {
        if (chip.querySelector("input")) return;   // 이미 적는 중
        const inp = document.createElement("input");
        inp.type = "text";
        inp.className = "linknote-in";
        inp.value = l.note || "";
        inp.placeholder = "까닭 — 같은 번역가, 인용…";
        inp.setAttribute("aria-label", "이은 까닭");
        const save = async () => {
          const v = inp.value.trim();
          try {
            await db.updateLink(l.id, { note: v || null });
            l.note = v || null;
            renderAll();
          } catch (err) { console.error("[이음] 까닭을 적지 못했습니다:", err); }
          why.textContent = l.note || (owner ? "까닭을 적는다" : "");
          why.classList.toggle("askwhy", !l.note && owner);
          inp.remove();
        };
        inp.addEventListener("blur", save);
        inp.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") { ev.preventDefault(); inp.blur(); }
          if (ev.key === "Escape") { ev.stopPropagation(); inp.value = l.note || ""; inp.blur(); }
        });
        chip.insertBefore(inp, pen);
        inp.focus();
      };
      pen.addEventListener("click", askNote);
      why.addEventListener("click", askNote);   // 빈 까닭을 눌러도 열린다
      const del = document.createElement("button");
      del.type = "button";
      del.className = "unlink";
      del.textContent = "×";
      del.setAttribute("aria-label", (other ? other.t : "이 책") + " 이음을 푼다");
      del.addEventListener("click", async () => {
        try { await db.removeLink(l.id); renderLinks(b); }
        catch (err) { console.error("[이음] 풀지 못했습니다:", err); }
      });
      chip.append(dir, go, why, pen, del);
      host.appendChild(chip);
    });
  }
  $("x-link-q").addEventListener("input", () => {
    const pick = $("x-linkpick");
    pick.innerHTML = "";
    const b = openBook;
    const v = $("x-link-q").value.trim().toLowerCase();
    if (!b || v.length < 2) return;   // 한 글자는 후보가 너무 많다
    allBooks()
      .filter((x) => x !== b && x.id && matchBook(x, v))
      .slice(0, 5)
      .forEach((x) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "linkpickbtn";
        btn.textContent = x.t + (x.a ? " — " + x.a : "");
        btn.addEventListener("click", async () => {
          try {
            const r = await window.PostLibrosDB.addLink(b.id, x.id);
            if (r?.dup) {
              $("x-saved").textContent = "이미 이어져 있습니다";
              $("x-saved").hidden = false;
            }
          } catch (err) { console.error("[이음] 잇지 못했습니다:", err); }
          renderLinks(b);
        });
        pick.appendChild(btn);
      });
  });

  /* ── 갈피 — 읽는 중일 때만 보인다 ── */
  function syncBookmarkRow(b) {
    const row = $("x-bm-row");
    if (!row) return;
    row.hidden = !b || b.st !== "읽는 중";
    if (row.hidden) return;
    $("x-bm").value = b.bookmark || "";
    $("x-bm-hint").textContent = b.pages
      ? `전체 ${b.pages.toLocaleString()}쪽`
      : "읽다 만 자리를 적어 둡니다";
  }
  /* ── 지금 펼친다 ─────────────────────────────────────────
     책상 위 더미, 갈피, 읽기 리듬은 모두 「읽는 중」을 먹고 사는 기능인데,
     읽는 중으로 바꾸려면 상태를 누르고 갈피를 따로 적어야 했다. 두 걸음을
     한 걸음으로 줄인다 — 펼친 책은 1쪽에 갈피를 꽂고 책상 위로 올라간다. */
  function syncOpenNowRow(b) {
    const btn = $("x-opennow");
    if (!btn) return;
    btn.hidden = !b || b.st !== "안 읽음";
  }
  $("x-opennow")?.addEventListener("click", () => {
    if (!openBook) return;
    const at = new Date().toISOString();
    const page = openBook.bookmark || 1;
    document.querySelectorAll("#x-status button").forEach((o) =>
      o.setAttribute("aria-selected", o.dataset.st === "읽는 중" ? "true" : "false"));
    saveBook(
      { read_status: "읽는 중", bookmark_page: page, bookmark_at: at },
      (b) => { b.st = "읽는 중"; b.bookmark = page; b.bookmarkAt = at; },
    );
    // 저장은 비동기다 — 화면의 줄들은 바뀔 모습을 미리 그려 둔다
    const after = { ...openBook, st: "읽는 중", bookmark: page, bookmarkAt: at };
    syncBookmarkRow(after);
    syncReadYearRow(after);
    syncOpenNowRow(after);
  });
  $("x-bm").addEventListener("change", () => {
    const raw = $("x-bm").value.trim();
    const page = raw ? Math.max(1, parseInt(raw, 10) || 0) || null : null;
    // 갈피를 꽂은 날도 같이 적는다 — 멈춘 지 얼마나 됐는지의 재료
    const at = page ? new Date().toISOString() : null;
    saveBook({ bookmark_page: page, bookmark_at: at }, (b) => { b.bookmark = page; b.bookmarkAt = at; });
  });

  /* ── 자리 (벽·단) ── */
  $("x-wall").addEventListener("change", () => {
    const wall = $("x-wall").value || null;
    saveBook({ wall }, (b) => { b.wall = wall; b.loc = [wall, b.shelfNo ? b.shelfNo + "단" : null].filter(Boolean).join(" ") || "자리 미정"; });
  });
  $("x-shelf").addEventListener("change", () => {
    const raw = $("x-shelf").value.trim();
    const shelf = raw ? Number(raw) : null;
    saveBook({ shelf }, (b) => { b.shelfNo = shelf; b.loc = [b.wall, shelf ? shelf + "단" : null].filter(Boolean).join(" ") || "자리 미정"; });
  });

  /* ── 표지 고치기·지우기 — 알라딘이 엉뚱한 판본 표지를 준 책의 출구 ── */
  function applyCover(url) {
    const b = openBook;
    saveBook({ cover_url: url }, (x) => { x.cover = url; });
    // 서표 머리의 그림도 그 자리에서 바꾼다
    const cv = $("x-cover");
    const face = url || b?.spineImg;
    if (face) {
      cv.src = face;
      cv.classList.toggle("spine", !url);
      cv.hidden = false;
    } else {
      cv.hidden = true;
      cv.removeAttribute("src");
    }
  }
  $("x-cover-url").addEventListener("change", () => {
    const v = $("x-cover-url").value.trim();
    if (!openBook) return;
    if (v && !/^https?:\/\//.test(v)) {
      $("x-saved").textContent = "http(s):// 로 시작하는 주소여야 합니다";
      $("x-saved").hidden = false;
      return;
    }
    applyCover(v || null);
  });
  $("x-cover-del").addEventListener("click", () => {
    if (!openBook) return;
    $("x-cover-url").value = "";
    applyCover(null);
  });

  /* ── 서지 지우기 — 엉뚱한 책의 서지가 입혀졌을 때 통째로 벗긴다 ──
     제목·지은이·메모·읽음 상태는 남긴다. 표식(enrich_tried_at)도 걷어
     「끝까지 채운다」가 다시 묻게 한다. */
  $("x-meta-del").addEventListener("click", () => {
    const btn = $("x-meta-del"), b = openBook;
    if (!b || !b.id) return;
    if (!btn.dataset.sure) {
      btn.dataset.sure = "1";
      btn.classList.add("warn");
      btn.textContent = "정말 지웁니다";
      setTimeout(() => {
        if (!btn.dataset.sure) return;
        delete btn.dataset.sure;
        btn.classList.remove("warn");
        btn.textContent = "서지를 지운다";
      }, 4000);
      return;
    }
    delete btn.dataset.sure;
    btn.classList.remove("warn");
    btn.textContent = "서지를 지운다";
    saveBook({
      isbn: null, publisher: null, cover_url: null, published_year: null,
      page_count: null, size_height: null, size_depth: null,
      enrich_tried_at: null,
    }, (x) => {
      x.isbn = null; x.pub = null; x.cover = null; x.pubYear = null; x.pages = null;
    });
    $("x-isbn").value = "";
    $("x-cover-url").value = "";
    const cv = $("x-cover");
    if (openBook?.spineImg) { cv.src = openBook.spineImg; cv.classList.add("spine"); }
    else { cv.hidden = true; cv.removeAttribute("src"); }
  });

  /* ── 서가에서 뺀다 — 되돌릴 수 없으므로 한 번 더 묻는다 ── */
  $("x-remove").addEventListener("click", async () => {
    const btn = $("x-remove"), b = openBook, db = window.PostLibrosDB;
    if (!b || !b.id || !db) return;
    if (!btn.dataset.sure) {
      btn.dataset.sure = "1";
      btn.classList.add("warn");
      btn.textContent = "정말 뺍니다";
      setTimeout(() => {
        if (!btn.dataset.sure) return;
        delete btn.dataset.sure;
        btn.classList.remove("warn");
        btn.textContent = "서가에서 뺀다";
      }, 4000);
      return;
    }
    delete btn.dataset.sure;
    btn.classList.remove("warn");
    btn.disabled = true;
    try {
      await db.removeBook(b.id);
      closeExlibris();
      await window.PostLibrosRefresh?.();
    } catch (err) {
      console.error("[서표] 빼지 못했습니다:", err);
      $("x-saved").hidden = false;
      $("x-saved").textContent = "빼지 못했습니다";
    } finally {
      btn.disabled = false;
      btn.textContent = "서가에서 뺀다";
    }
  });

  /* ── 여백의 기록 — 자리를 옮길 때 적는다 ── */
  /* 이 책 한 권만 서지를 받아온다 — 목록 전체를 돌릴 필요가 없다.
     ISBN 칸에 번호를 적었으면 검색 없이 그 번호로 정확히 조회한다. */
  $("x-enrich").addEventListener("click", async () => {
    const b = openBook, db = window.PostLibrosDB;
    if (!b || !b.id || !db) return;
    const btn = $("x-enrich"), note = $("x-enrich-note");
    const typed = $("x-isbn").value.replace(/[^0-9Xx]/g, "");
    // 이미 저장된 번호를 그대로 두고 눌렀다면 검색 경로로 — 새로 적었을 때만 번호 조회
    const isbn = typed && typed !== (b.isbn || "") ? typed : null;
    if (isbn && isbn.length !== 13 && isbn.length !== 10) {
      note.textContent = "ISBN 은 10자리나 13자리입니다.";
      return;
    }
    btn.disabled = true;
    note.textContent = isbn ? `${isbn} 로 조회하는 중…` : "알라딘에 묻는 중…";
    try {
      const { data, error } = await db.enrichBook(b.id, isbn);
      if (error || data?.error) throw new Error(data?.error || error.message);
      if (data.겹침) {
        note.textContent = `이미 같은 책이 꽂혀 있습니다 — ${data.제목}`;
        $("x-enrich").disabled = false;
        return;
      }
      await window.PostLibrosRefresh?.();
      // 새 값으로 서표를 다시 편다 — 손에 든 책은 옛 모습이다
      const nb = allBooks().find((x) => x.id === b.id);
      if (nb && openBook === b) openExlibris(nb, bookWall(nb));
      const tag = $("x-enrich-note");
      const aladinT = data.제목 || data.살펴볼것?.[0]?.알라딘;
      tag.textContent = data.채움
        ? "받아왔습니다" + (aladinT && nb && aladinT !== nb.t ? ` — 알라딘 제목: ${aladinT}` : "")
        : "알라딘에서 찾지 못했습니다 — ISBN 을 적어 다시 시도해 보세요";
    } catch (err) {
      note.textContent = "받아오지 못했습니다 — " + (err.message || err);
    }
    $("x-enrich").disabled = false;
  });

  /* 책등을 잘못 읽었을 때 — 지웠다 다시 넣지 않고 여기서 고친다.
     제목·지은이는 중복 열쇠의 재료라, 고치면 이미 있는 책과 부딪힐 수 있다.
     그때 DB 가 23505 로 거절하므로 그대로 알린다. */
  function fixField(id, key, apply) {
    $(id).addEventListener("blur", async () => {
      const v = $(id).value.trim();
      if (!openBook || !v || v === (openBook[key === "title" ? "t" : "a"] || "")) return;
      const tag = $("x-saved");
      try {
        // 이름이 바뀌었으니 서지도 다시 물어볼 만하다 — 채우기 표식을 걷는다
        await window.PostLibrosDB.updateBook(openBook.id, { [key]: v, enrich_tried_at: null });
        apply(openBook, v);
        tag.textContent = "적었습니다"; tag.hidden = false;
        clearTimeout(fixField._t);
        fixField._t = setTimeout(() => { tag.hidden = true; }, 1800);
        renderAll();
      } catch (err) {
        const dup = String(err.message || err).includes("23505")
          || String(err.code || "") === "23505";
        tag.textContent = dup ? "이미 같은 책이 있습니다" : "적지 못했습니다";
        tag.hidden = false;
        $(id).value = openBook[key === "title" ? "t" : "a"] || "";
      }
    });
  }
  fixField("x-t", "title", (b, v) => { b.t = v; $("x-title").textContent = v; });
  fixField("x-a", "author", (b, v) => { b.a = v; });

  $("x-memoedit").addEventListener("blur", () => {
    const memo = $("x-memoedit").value.trim();
    if (!openBook || memo === (openBook.memo || "")) return;
    saveBook({ memo: memo || null }, (b) => { b.memo = memo; });
  });
  document.addEventListener("keydown", e => {
    // / 를 누르면 검색으로 — 글을 쓰는 중이 아닐 때만
    if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "")) {
      e.preventDefault();
      $("q").focus();
      return;
    }
    // 서표가 열려 있으면 ←/→ 로 이웃 책을 넘긴다 — 글을 쓰는 중이 아닐 때만
    if ((e.key === "ArrowLeft" || e.key === "ArrowRight")
        && $("exlibris").classList.contains("show") && openBook
        && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "")) {
      const list = filteredBooks();
      const i = list.indexOf(openBook);
      if (i >= 0) {
        const nb = list[i + (e.key === "ArrowRight" ? 1 : -1)];
        if (nb) { e.preventDefault(); openExlibris(nb, bookWall(nb)); }
      }
      return;
    }
    if (e.key !== "Escape") return;
    // 검색창에서 Esc — 검색을 비운다
    if (document.activeElement === $("q") && $("q").value) {
      $("q").value = "";
      $("q").dispatchEvent(new Event("input"));
      return;
    }
    if ($("exlibris").classList.contains("show")) { closeExlibris(); return; }
    const open = document.querySelector(".wallsec.open");
    if (open) { open.classList.remove("open"); syncBodyClass(); }
  });
  $("today-open").addEventListener("click", () => {
    if (todayBook) openExlibris(todayBook, bookWall(todayBook));
  });

  /* 주사위 — "다음에 뭘 읽지"는 서재가 답한다. 안 읽은 책을 우선 뽑는다.
     책은 누르는 순간 이미 정해져 있고, 구르는 눈은 눈요기다 — 굴러가는
     동안 결과를 바꾸면 「던져서 나온 것」이라는 느낌이 오히려 옅어진다.
     모션을 줄여 달라고 한 사람에게는 굴리지 않고 곧장 펼친다. */
  const DICE_MS = 780;
  let diceRolling = false;
  const eyeOf = () => String(1 + Math.floor(Math.random() * 6));
  $("today-rand")?.addEventListener("click", () => {
    if (diceRolling) return;
    const all = allBooks();
    const unread = all.filter((b) => b.st === "안 읽음");
    const pool = unread.length ? unread : all;
    if (!pool.length) return;
    const b = pool[Math.floor(Math.random() * pool.length)];
    const die = $("die");
    if (noMotion || !die) { openExlibris(b, bookWall(b)); return; }
    diceRolling = true;
    // 애니메이션을 다시 태우려면 클래스를 뗀 뒤 한 번 재계산시켜야 한다
    die.classList.remove("rolling");
    void die.offsetWidth;
    die.classList.add("rolling");
    const flip = setInterval(() => { die.dataset.face = eyeOf(); }, 85);
    setTimeout(() => {
      clearInterval(flip);
      die.dataset.face = eyeOf();
      die.classList.remove("rolling");
      diceRolling = false;
      openExlibris(b, bookWall(b));
    }, DICE_MS);
  });

  /* 키 순서 토글 — 서가 뷰에서만 보인다 */
  $("heightsort")?.addEventListener("click", () => {
    sortHeight = !sortHeight;
    $("heightsort").setAttribute("aria-pressed", sortHeight ? "true" : "false");
    try { localStorage.setItem("pl-heightsort", sortHeight ? "1" : "0"); } catch { /* 못 남겨도 그만 */ }
    renderWalls();
  });
  $("heightsort")?.setAttribute("aria-pressed", sortHeight ? "true" : "false");

  /* ── 이 달의 진열장 — 표지가 있는 책 여섯을 액자처럼 건다 ──
     달을 씨앗으로 쓰면 한 달 동안은 같은 여섯, 달이 바뀌면 저절로 바뀐다.
     표지가 세 권도 안 되면 구획째 숨긴다 — 빈 액자를 걸 수는 없다. */
  function renderShowcase() {
    const sec = $("showcase"), grid = $("showgrid");
    if (!sec || !grid) return;
    const covered = allBooks().filter((b) => b.cover);
    if (covered.length < 3) { sec.hidden = true; return; }
    const d = new Date();
    let seed = (d.getFullYear() * 12 + d.getMonth()) >>> 0;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    // 씨앗 섞기 — 같은 달에는 늘 같은 순서
    const pool = [...covered];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const picks = pool.slice(0, 6);
    sec.hidden = false;
    $("showcase-sub").textContent =
      `${d.getMonth() + 1}월 — 표지가 있는 ${covered.length.toLocaleString()}권에서 여섯을 걸었다`;
    grid.innerHTML = "";
    picks.forEach((b) => {
      const f = document.createElement("button");
      f.type = "button";
      f.className = "showframe";
      const img = document.createElement("img");
      img.src = b.cover;
      img.alt = `${b.t} 표지`;
      img.loading = "lazy";
      img.addEventListener("error", () => f.remove());   // 죽은 표지는 액자째 내린다
      const cap = document.createElement("span");
      cap.textContent = b.t;
      f.append(img, cap);
      f.title = `${b.t} — ${b.a}`;
      f.addEventListener("click", () => openExlibris(b, bookWall(b)));
      grid.appendChild(f);
    });
  }

  /* 데이터가 바뀌면 서가만이 아니라 셈과 책상도 함께 다시 그린다 —
     한 군데만 갱신하면 옛 숫자가 남아 찌꺼기처럼 보인다 */
  function renderAll() {
    renderWalls();
    renderCensus();
    renderToday();
    renderShowcase();
    renderPaths();          // 이음이 만든 길 — 데이터를 따로 받아와 건다
    renderColophon();
    renderFoyerLine();
    renderNowOpen();
    loadSummarized();       // 한 번만 묻는다 — 오면 스스로 다시 그린다
    syncSideBtns();
    syncFindNote();
    if (curView === "covers") renderCovers();
    if (curView === "list") renderList();
    if (curView === "stats") renderStats();
    updateLadder();
  }
  window.PostLibrosRenderAll = renderAll;

  /* 서재는 공개다 — 로그인과 무관하게 누구나 실제 장서를 본다.
     빈 뼈대를 그리지 않고, auth.js 의 loadRealLibrary 가 책을 실어 올 때까지
     「여는 중」으로 기다린다. (예전의 방문자용 표본 데이터는 지웠다) */
  document.body.classList.add("waking");
  // role="status" — 화면을 못 보는 사람에게도 「여는 중」과 「다 열렸다」가 들린다
  $("walls").innerHTML = `<p class="waking-note" role="status">서재를 여는 중…</p>`;
  $("census-n").textContent = "장서를 세는 중";
  /* 「여는 중」의 끝을 정해 둔다 ─────────────────────────
     장서 싣기가 실패하면 auth.js 가 ShowEmpty 를 부르지만, **싣기가 아예
     시작되지 못하면** 아무도 부르지 않는다. jsdelivr 가 죽어 supabase-js 가
     안 오는 경우가 그렇다 — db.js 가 PostLibrosDB 를 못 만들고, 화면은
     「서재를 여는 중…」에 영원히 머문다 (2026-09-02 확인: 24초 뒤에도 그대로).
     어떤 까닭이든 열두 셈을 넘기면 못 열었다고 말한다. */
  setTimeout(() => {
    if (!document.body.classList.contains("waking")) return;
    window.PostLibrosShowEmpty?.(new Error(
      window.PostLibrosDB
        ? "서재가 열두 셈 안에 답하지 않았습니다"
        : "서재로 가는 길(supabase-js)을 싣지 못했습니다"));
  }, 12000);
  /* 장서를 끝내 못 실었을 때 auth.js 가 부른다.
     예전에는 그냥 renderAll() 을 불렀는데, 그러면 벽 다섯이 전부
     「이 벽은 아직 비어 있습니다」라고 말한다 — 통신이 끊긴 것을
     **텅 빈 서재**로 보여주는 셈이라, 화면이 거짓말을 한다.
     못 연 것과 비어 있는 것은 다르다. 그렇게 말하고, 다시 열 문을 준다. */
  window.PostLibrosShowEmpty = (err) => {
    document.body.classList.remove("waking");
    if (!err) { renderAll(); return; }
    console.error("[서재] 장서를 불러오지 못했습니다:", err);
    $("walls").innerHTML = "";
    const box = document.createElement("div");
    box.className = "loadfail";
    box.setAttribute("role", "alert");
    box.innerHTML = `
      <b>서재를 열지 못했습니다</b>
      <p>책은 그대로 있습니다 — 지금 이 화면이 서재에 닿지 못했을 뿐입니다.
         잠시 뒤 다시 열어 보세요.</p>
      <button type="button" class="failgo">다시 열어 본다</button>
      <code class="failwhy"></code>`;
    box.querySelector(".failwhy").textContent = String(err?.message || err || "").slice(0, 160);
    box.querySelector(".failgo").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true; btn.textContent = "여는 중…";
      /* 길 자체를 못 실은 경우에는 auth.js 도 서지 못해 PostLibrosRefresh 가
         없다 — 그때는 다시 부를 것이 없으므로 문서를 통째로 다시 연다 */
      if (!window.PostLibrosRefresh) { location.reload(); return; }
      try { await window.PostLibrosRefresh(); }
      catch (again) {
        btn.disabled = false; btn.textContent = "다시 열어 본다";
        box.querySelector(".failwhy").textContent = String(again?.message || again).slice(0, 160);
      }
    });
    $("walls").appendChild(box);
    $("census-n").textContent = "서재를 열지 못했습니다";
    $("foyerline").textContent = "";
    $("today-title").textContent = "—";
    $("today-sub").textContent = "서재에 닿지 못했습니다 — 위의 「다시 열어 본다」를 눌러 보세요";
    ["showcase", "paths", "crate"].forEach((id) => { const e2 = $(id); if (e2) e2.hidden = true; });
  };

  addEventListener("load", () => { layoutLadder(); updateLadder(); });
