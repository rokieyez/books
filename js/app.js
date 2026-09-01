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

  function renderWalls() {
    const host = $("walls"); host.innerHTML = "";
    wallEls.length = 0;
    syncBodyClass();
    WALLS.forEach((w) => {
      const sec = document.createElement("section");
      sec.className = "wallsec";
      wallEls.push({ el: sec, w });
      const hits = (w.cat !== "archive" && q())
        ? w.books.filter(b => matchBook(b, q())).length : null;
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
            `<p class="statempty">아직 아무것도 들이지 않았습니다 — 문서·사진·링크가 여기 쌓입니다.</p>`);
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
        const hit = (b) => matchBook(b, q());
        // 키 순서일 때는 실물 높이(없으면 어림값)로 줄을 세운다 — 검색 앞줄 규칙이 우선
        const base = sortHeight
          ? [...w.books].sort((x, y) => y.h - x.h || y.w2 - x.w2)
          : w.books;
        const shelved = q()
          ? [...base.filter(hit), ...base.filter(b => !hit(b))]
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
        for (let s = 0; s < 3; s++) {
          const line = document.createElement("div"); line.className = "shelfline";
          shelved.slice(s*22, (s+1)*22).forEach((b, k) => {
            const idx = s*22 + k;
            if (idx === w.latchIdx) line.appendChild(makeLatch());
            const el = document.createElement("button"); el.className = "tome";
            if (b.paper) el.classList.add("paper");
            if (b.lean) el.classList.add("lean");
            if (b.folio) el.classList.add("folio");
            if (q() && !matchBook(b, q())) el.classList.add("dim");
            el.style.cssText = `background-color:${b.c};height:${b.h}px;width:${b.w2}px;`;
            // 사진에서 오려 낸 실물 책등이 있으면 그것을 입는다 — 글자는 그림 안에 이미 있다
            if (b.spineImg) {
              el.classList.add("realspine");
              el.style.backgroundImage = `url("${b.spineImg}")`;
            } else {
              el.textContent = b.t;
            }
            el.title = `${b.t} — ${b.a}`;
            el.addEventListener("click", (e) => {
              e.stopPropagation();
              openExlibris(b, w);
            });
            line.appendChild(el);
          });
          panel.appendChild(line);
          const pk = document.createElement("div"); pk.className = "plank"; panel.appendChild(pk);
        }
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
      box.innerHTML = `<p class="note">궤짝이 비어 있습니다 — 확신이 갈리는 책이 생기면 여기 담깁니다.</p>`;
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
          + (bad ? ` · ${bad}권은 실패했습니다 — 남아 있습니다` : "");
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
    num.textContent = n ? `${n.toLocaleString()}권 입고` : "아직 비어 있음";
    if (bar) bar.style.width = readPct.toFixed(1) + "%";
    const box = $("census");
    if (box) box.title = n ? `읽음 ${Math.round(readPct)}% — 막대는 읽어 낸 만큼 차오릅니다` : "";
  }

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
    } else if (pick.year) marks.push(pick.year + " 입고");
    s.textContent = marks.join(" · ");
    todayBook = pick;
  }
  let todayBook = null;

  function bookWall(b) { return WALLS.find(w => w.books && w.books.includes(b)); }
  function allBooks() { return WALLS.filter(w => w.books).flatMap(w => w.books); }
  /* 검색은 어느 뷰에서든 같은 규칙 — 제목·지은이에 출판사·ISBN 까지 */
  function matchBook(b, query) {
    return (b.t + " " + b.a + " " + (b.pub || "") + " " + (b.isbn || ""))
      .toLowerCase().includes(query);
  }
  window.PostLibrosMatch = matchBook;
  function filteredBooks() {
    const query = q();
    return allBooks().filter(b => !query || matchBook(b, query));
  }
  function setView(v) {
    curView = v;
    document.querySelectorAll(".viewseg button").forEach(b =>
      b.setAttribute("aria-selected", b.dataset.v === v ? "true" : "false"));
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
    layoutLadder(); updateLadder();
  }
  document.querySelectorAll(".viewseg button").forEach(b => {
    b.addEventListener("click", () => setView(b.dataset.v));
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
      el.innerHTML = `<b></b><span></span>`;
      el.querySelector("b").textContent = b.t;
      el.querySelector("span").textContent = b.a;
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
      const m = b.t.match(SERIES_RE);
      if (m) {
        const key = m[1].trim() + "␟" + b.a;
        if (!groups.has(key)) { groups.set(key, []); order.push({ g: key, base: m[1].trim() }); }
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
    tr.innerHTML = `<td class="t"></td><td></td><td></td>
      <td><span class="st-dot" style="background:${STCOLOR[b.st]}"></span>${stLabel}</td>
      <td>${b.year ?? ""}</td><td></td>`;
    tr.children[0].textContent = (sub ? "└ " : "") + b.t;
    tr.children[1].textContent = b.a;
    tr.children[2].textContent = b.cat;
    tr.children[5].textContent = b.loc;
    tr.addEventListener("click", () => openExlibris(b, bookWall(b)));
    return tr;
  }

  function seriesRow(r) {
    const open = expandedSeries.has(r.series);
    const read = r.books.filter((x) => x.st === "읽음").length;
    const tr = document.createElement("tr");
    tr.className = "seriesrow";
    tr.innerHTML = `<td class="t"><i class="fold">${open ? "▾" : "▸"}</i> <b></b> <span class="cnt">${r.books.length}권</span></td>
      <td></td><td></td><td>읽음 ${read}/${r.books.length}</td><td></td><td></td>`;
    tr.querySelector("b").textContent = r.base;
    tr.children[1].textContent = r.books[0].a;
    tr.children[2].textContent = r.books[0].cat;
    tr.children[5].textContent = r.books[0].loc;
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
        + (q() ? ` (검색어: "${$("q").value.trim()}")` : "")
        + (sortKey ? ` · ${sortAsc ? "오름차순" : "내림차순"}` : "")
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

    requestAnimationFrame(() => requestAnimationFrame(() => {
      grow.forEach(([el, prop, val]) => el.style[prop] = val);
    }));
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
      if (curView === "covers") renderCovers();
      if (curView === "list") renderList();
    }, 140);
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
    // 닫으면 원래 있던 자리로 돌아가도록 표를 남긴다
    returnFocus = document.activeElement;
    $("x-close").focus();

    const owner = document.body.classList.contains("owner");
    const db = window.PostLibrosDB;

    // 표본 화면에서는 미리 써 둔 글을 보여준다
    if (!owner || !db || !b.id) {
      const cur = CURATED[b.t];
      $("x-edit").hidden = true;
      $("x-memoedit").hidden = true;
      $("x-full").hidden = !cur;
      $("x-pending").hidden = !!cur;
      $("x-memo").hidden = false;
      if (cur) { $("x-summary").textContent = cur.s; $("x-memo").textContent = cur.m; }
      return;
    }

    /* ── 주인의 화면 ── */
    $("x-edit").hidden = false;
    $("x-memo").hidden = true;
    $("x-memoedit").hidden = false;
    $("x-memoedit").value = b.memo || "";
    $("x-saved").hidden = true;

    document.querySelectorAll("#x-status button").forEach(btn =>
      btn.setAttribute("aria-selected", btn.dataset.st === b.st ? "true" : "false"));
    $("x-wall").value = b.wall || "";
    $("x-shelf").value = b.shelfNo || "";
    $("x-t").value = b.t || "";
    $("x-a").value = b.a || "";
    $("x-enrich-note").textContent = "ISBN·표지·쪽수를 이 책만 다시 채웁니다";
    $("x-enrich").disabled = false;
    $("x-isbn").value = b.isbn || "";
    syncBookmarkRow(b);
    syncReadYearRow(b);
    renderLinks(b);

    // 기록은 있으면 보여주고, 없으면 청할 수 있게 둔다
    $("x-full").hidden = true;
    $("x-pending").hidden = false;
    $("x-none").textContent = "기록을 찾는 중…";
    $("x-gen").hidden = true;

    db.getSummary(b.id).then((s) => {
      if (openBook !== b) return;          // 그새 다른 책을 폈다면 버린다
      if (s) {
        $("x-summary").textContent = s.summary;
        $("x-full").hidden = false;
        $("x-pending").hidden = true;
      } else {
        $("x-none").textContent = "이 책의 기록은 아직 없습니다.";
        $("x-gen").hidden = false;
        $("x-gen").disabled = false;
        $("x-gen").textContent = "지금 기록을 부탁한다";
      }
    }).catch((err) => {
      if (openBook !== b) return;
      $("x-none").textContent = "기록을 읽지 못했습니다: " + (err.message || err);
      $("x-gen").hidden = false;
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
    // ESC 로 닫으면 여백에 적던 글이 blur 를 못 만나 사라진다 — 먼저 흘려보낸다
    if (document.activeElement === $("x-memoedit")) $("x-memoedit").blur();
    $("veil").classList.remove("show");
    $("exlibris").classList.remove("show");
    openBook = null;
    try { returnFocus?.focus(); } catch {}
    returnFocus = null;
  }
  // 알라딘 표지 주소가 죽어 있으면 그림 자리를 걷는다
  $("x-cover").addEventListener("error", () => { $("x-cover").hidden = true; });
  $("x-close").addEventListener("click", closeExlibris);
  $("veil").addEventListener("click", closeExlibris);
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
    });
  });

  /* ── 읽은 해 — 읽음일 때만 보인다 ── */
  function syncReadYearRow(b) {
    const row = $("x-ry-row");
    if (!row) return;
    row.hidden = !b || b.st !== "읽음";
    if (!row.hidden) $("x-ry").value = b.readYear || "";
  }
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
      const go = document.createElement("button");
      go.type = "button";
      go.textContent = other ? other.t : "(서가에 없는 책)";
      if (other) go.addEventListener("click", () => openExlibris(other, bookWall(other)));
      else go.disabled = true;
      const del = document.createElement("button");
      del.type = "button";
      del.className = "unlink";
      del.textContent = "×";
      del.setAttribute("aria-label", (other ? other.t : "이 책") + " 이음을 푼다");
      del.addEventListener("click", async () => {
        try { await db.removeLink(l.id); renderLinks(b); }
        catch (err) { console.error("[이음] 풀지 못했습니다:", err); }
      });
      chip.append(go, del);
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
  $("x-bm").addEventListener("change", () => {
    const raw = $("x-bm").value.trim();
    const page = raw ? Math.max(1, parseInt(raw, 10) || 0) || null : null;
    saveBook({ bookmark_page: page }, (b) => { b.bookmark = page; });
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

  /* 주사위 — "다음에 뭘 읽지"는 서재가 답한다. 안 읽은 책을 우선 뽑는다. */
  $("today-rand")?.addEventListener("click", () => {
    const all = allBooks();
    const unread = all.filter((b) => b.st === "안 읽음");
    const pool = unread.length ? unread : all;
    if (!pool.length) return;
    const b = pool[Math.floor(Math.random() * pool.length)];
    openExlibris(b, bookWall(b));
  });

  /* 키 순서 토글 — 서가 뷰에서만 보인다 */
  $("heightsort")?.addEventListener("click", () => {
    sortHeight = !sortHeight;
    $("heightsort").setAttribute("aria-pressed", sortHeight ? "true" : "false");
    try { localStorage.setItem("pl-heightsort", sortHeight ? "1" : "0"); } catch { /* 못 남겨도 그만 */ }
    renderWalls();
  });
  $("heightsort")?.setAttribute("aria-pressed", sortHeight ? "true" : "false");

  /* 데이터가 바뀌면 서가만이 아니라 셈과 책상도 함께 다시 그린다 —
     한 군데만 갱신하면 옛 숫자가 남아 찌꺼기처럼 보인다 */
  function renderAll() {
    renderWalls();
    renderCensus();
    renderToday();
    // 주인 앞에서는 진짜 장서다 — 「데이터는 예시」를 걷는다
    document.querySelector(".colophon").textContent =
      document.body.classList.contains("owner")
        ? "서가 뒤의 방 · rokiz.net"
        : "서가 뒤의 방 — 여기 보이는 것은 표본입니다";
    if (curView === "covers") renderCovers();
    if (curView === "list") renderList();
    if (curView === "stats") renderStats();
    updateLadder();
  }
  window.PostLibrosRenderAll = renderAll;

  /* 들어와 있는 사람이면 표본을 아예 그리지 않는다.
     세션 확인은 서버를 다녀와야 하는데, 그 사이에 표본을 그려 두면
     새로고침할 때마다 남의 책이 0.3초쯤 스쳤다가 사라진다.
     브라우저에 저장된 세션은 곧바로 읽을 수 있으므로, 그것만 보고
     "곧 진짜 장서가 온다"고 판단해 빈 서가로 기다린다. */
  function hasStoredSession() {
    try {
      return Object.keys(localStorage).some(
        (k) => k.startsWith("sb-") && k.includes("auth-token") && localStorage.getItem(k));
    } catch { return false; }
  }

  let sampleShown = false;
  function showSample() {
    if (sampleShown) return;
    sampleShown = true;
    document.body.classList.remove("waking");
    renderAll();
  }
  /* 세션이 없다고 판명되면(로그인 안 됨) 그때 표본을 그린다 — auth.js 가 부른다 */
  window.PostLibrosShowSample = showSample;

  // 어느 길로 시작했는지 남겨 둔다 — 표본이 스치는 문제를 다시 볼 때 단서가 된다
  if (hasStoredSession()) {
    document.documentElement.dataset.boot = "waiting";
    document.body.classList.add("waking");
    $("walls").innerHTML = `<p class="waking-note">서재를 여는 중…</p>`;
    $("census-n").textContent = "장서를 세는 중";
  } else {
    document.documentElement.dataset.boot = "sample";
    showSample();
  }

  addEventListener("load", () => { layoutLadder(); updateLadder(); });
