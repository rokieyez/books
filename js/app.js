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

    renderLinkWeb(books);   // 이음의 별자리 — 데이터를 따로 받아와 그린다
    renderAuthorWeb(books); // 작가의 별자리 — 같은 작가의 책이 한 성좌로

    requestAnimationFrame(() => requestAnimationFrame(() => {
      grow.forEach(([el, prop, val]) => el.style[prop] = val);
    }));
  }

  /* ── 작가의 별자리 — 같은 작가의 책들이 한 성좌로 모인다 ──
     이음(book_links)과 달리 손대지 않아도 뜬다: 지은이가 같으면 한 무리다.
     가운데 작가 이름, 둘레에 그 작가의 책들 — 별을 누르면 서표가 열린다. */
  function renderAuthorWeb(books) {
    const cvs = $("authorweb"), ps = $("ps-authorweb");
    if (!cvs || !ps) return;
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

    const Wd = cvs.parentElement?.clientWidth ? cvs.parentElement.clientWidth - 2 : 600;
    const perRow = Math.max(1, Math.floor(Wd / 210));
    const Ht = Math.max(170, Math.ceil(tops.length / perRow) * 165 + 10);
    cvs.hidden = false;
    cvs.width = Wd * 2; cvs.height = Ht * 2;   // 레티나
    cvs.style.width = Wd + "px"; cvs.style.height = Ht + "px";
    const c = cvs.getContext("2d");
    c.scale(2, 2);
    c.clearRect(0, 0, Wd, Ht);
    c.textAlign = "center";

    const stars = [];   // [x, y, book] — 누른 자리에서 가장 가까운 별을 찾는다
    tops.forEach(([name, list], i) => {
      const cx = 105 + (i % perRow) * 210, cy = 80 + Math.floor(i / perRow) * 165;
      const shown = list.slice(0, 14);   // 전집 작가는 열넷까지만 — 원이 붐빈다
      const r = Math.min(56, 24 + shown.length * 2.4);
      // 가운데 이름
      c.fillStyle = "#E2D5B8";
      c.font = "700 12px 'Gowun Batang', serif";
      c.fillText(name.length > 9 ? name.slice(0, 9) + "…" : name, cx, cy + 4);
      c.fillStyle = "rgba(163,148,122,.9)";
      c.font = "10px sans-serif";
      c.fillText(`${list.length}권`, cx, cy + 18);
      // 둘레의 책들 — 이름에서 별로 실을 잇는다
      shown.forEach((b, k) => {
        const a = (k / shown.length) * Math.PI * 2 - Math.PI / 2;
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        c.strokeStyle = "rgba(151,116,47,.35)";
        c.lineWidth = 1;
        c.beginPath(); c.moveTo(cx, cy); c.lineTo(x, y); c.stroke();
        c.fillStyle = b.st === "읽음" ? "#E0B15E" : "rgba(226,213,184,.55)";
        c.beginPath(); c.arc(x, y, 2.4, 0, Math.PI * 2); c.fill();
        stars.push([x, y, b]);
      });
    });
    cvs.onclick = (ev) => {
      const r = cvs.getBoundingClientRect();
      const mx = ev.clientX - r.left, my = ev.clientY - r.top;
      let hit = null, best = 16 * 16;
      for (const [x, y, b] of stars) {
        const d = (x - mx) ** 2 + (y - my) ** 2;
        if (d < best) { best = d; hit = b; }
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
     밑에는 「이어 둘까요」 — 시리즈인데 아직 이어지지 않은 무리를 제안한다. */
  async function renderLinkWeb(books) {
    const cvs = $("linkweb"), sug = $("linksuggest"), ps = $("ps-linkweb");
    if (!cvs || !sug || !ps) return;
    sug.innerHTML = "";
    const db = window.PostLibrosDB;
    const byId = new Map(books.filter((b) => b.id).map((b) => [b.id, b]));
    let links = [];
    if (db?.listAllLinks && byId.size) {
      try { links = await db.listAllLinks(); }
      catch (e) { console.warn("[별자리] 이음을 읽지 못했습니다:", e); }
    }
    const es = links.filter((l) => byId.has(l.book_id) && byId.has(l.linked_book_id));

    const Wd = cvs.parentElement?.clientWidth ? cvs.parentElement.clientWidth - 2 : 600;
    if (!es.length) {
      ps.textContent = "책을 이어 두면 성좌가 뜹니다 — 서표의 「이음」 줄에서";
      cvs.hidden = true;
    } else {
      // 연결 성분을 찾는다 — 성좌 하나가 성분 하나
      const adj = new Map();
      const join = (a, b2) => { if (!adj.has(a)) adj.set(a, new Set()); adj.get(a).add(b2); };
      es.forEach((l) => { join(l.book_id, l.linked_book_id); join(l.linked_book_id, l.book_id); });
      const seen = new Set(), comps = [];
      for (const n of adj.keys()) {
        if (seen.has(n)) continue;
        const c = [], st = [n]; seen.add(n);
        while (st.length) {
          const x = st.pop(); c.push(x);
          for (const m of adj.get(x) || []) if (!seen.has(m)) { seen.add(m); st.push(m); }
        }
        comps.push(c);
      }
      ps.textContent = `이음 ${es.length}개 · 성좌 ${comps.length}자리 — 별을 누르면 그 책이 펼쳐진다`;

      // 성분마다 원으로 배치하고, 줄 수에 맞춰 캔버스 키를 정한다
      const perRow = Math.max(1, Math.floor(Wd / 175));
      const Ht = Math.max(150, Math.ceil(comps.length / perRow) * 130 + 10);
      const pos = new Map();
      comps.forEach((c, i) => {
        const cx = 88 + (i % perRow) * 175, cy = 68 + Math.floor(i / perRow) * 130;
        const r = Math.min(48, 14 + c.length * 5);
        c.forEach((id, k) => {
          const a = (k / c.length) * Math.PI * 2 - Math.PI / 2;
          pos.set(id, c.length === 1
            ? [cx, cy] : [cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
        });
      });

      cvs.hidden = false;
      cvs.width = Wd * 2; cvs.height = Ht * 2;   // 레티나
      cvs.style.width = Wd + "px"; cvs.style.height = Ht + "px";
      const c2 = cvs.getContext("2d");
      c2.scale(2, 2);
      c2.clearRect(0, 0, Wd, Ht);
      c2.strokeStyle = "rgba(151,116,47,.5)"; c2.lineWidth = 1;
      es.forEach((l) => {
        const p = pos.get(l.book_id), q2 = pos.get(l.linked_book_id);
        if (!p || !q2) return;
        c2.beginPath(); c2.moveTo(p[0], p[1]); c2.lineTo(q2[0], q2[1]); c2.stroke();
      });
      c2.font = "10px sans-serif"; c2.textAlign = "center";
      for (const [id, [x, y]] of pos) {
        c2.fillStyle = "#E0B15E";
        c2.beginPath(); c2.arc(x, y, 2.6, 0, Math.PI * 2); c2.fill();
        const t = byId.get(id)?.t || "";
        c2.fillStyle = "rgba(226,213,184,.72)";
        c2.fillText(t.length > 9 ? t.slice(0, 9) + "…" : t, x, y + 15);
      }
      // 별을 누르면 그 책 — 가장 가까운 별을 찾는다
      cvs.onclick = (ev) => {
        const r = cvs.getBoundingClientRect();
        const mx = ev.clientX - r.left, my = ev.clientY - r.top;
        let hit = null, best = 18 * 18;
        for (const [id, [x, y]] of pos) {
          const d = (x - mx) ** 2 + (y - my) ** 2;
          if (d < best) { best = d; hit = id; }
        }
        const b = hit && byId.get(hit);
        if (b) openExlibris(b, bookWall(b));
      };
    }

    /* 이어 둘까요 — 같은 밑동·지은이의 시리즈인데 이음이 하나도 없는 무리.
       단추 하나로 이웃 권끼리 사슬처럼 잇는다 (1↔2, 2↔3 …). */
    if (!db?.addLink) return;
    const linked = new Set(es.map((l) => [l.book_id, l.linked_book_id].sort().join("|")));
    const series = new Map();
    books.forEach((b) => {
      if (!b.id) return;
      const m = b.t.match(SERIES_RE);
      if (!m) return;
      const key = m[1].trim().toLowerCase() + "|" + (b.a || "");
      if (!series.has(key)) series.set(key, { base: m[1].trim(), vols: [] });
      series.get(key).vols.push([Number(m[2]), b]);
    });
    let shown = 0;
    for (const { base, vols } of series.values()) {
      if (vols.length < 2 || shown >= 5) continue;
      vols.sort((x, y) => x[0] - y[0]);
      const pairs = [];
      for (let i = 1; i < vols.length; i++) {
        const a = vols[i - 1][1], b = vols[i][1];
        if (!linked.has([a.id, b.id].sort().join("|"))) pairs.push([a, b]);
      }
      if (!pairs.length) continue;
      shown++;
      const row = document.createElement("button");
      row.type = "button";
      row.className = "sugrow";
      row.textContent = `「${base}」 ${vols.length}권을 시리즈로 잇는다`;
      row.addEventListener("click", async () => {
        row.disabled = true;
        row.textContent = `「${base}」 잇는 중…`;
        for (const [a, b] of pairs) {
          try { await db.addLink(a.id, b.id); }
          catch (err) { console.error("[별자리] 잇지 못했습니다:", err); }
        }
        renderLinkWeb(books);   // 새 성좌로 다시 그린다
      });
      sug.appendChild(row);
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
    $("x-cover-url").value = b.cover || "";
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
      // 이은 까닭 — 있으면 띠 안에 작게, ✎ 로 적거나 고친다
      const why = document.createElement("i");
      why.className = "linknote";
      why.textContent = l.note || "";
      const pen = document.createElement("button");
      pen.type = "button";
      pen.className = "unlink pen";
      pen.textContent = "✎";
      pen.setAttribute("aria-label", "이은 까닭 적기");
      pen.addEventListener("click", () => {
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
            await db.updateLink(l.id, v || null);
            l.note = v || null;
          } catch (err) { console.error("[이음] 까닭을 적지 못했습니다:", err); }
          why.textContent = l.note || "";
          inp.remove();
        };
        inp.addEventListener("blur", save);
        inp.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") { ev.preventDefault(); inp.blur(); }
          if (ev.key === "Escape") { ev.stopPropagation(); inp.value = l.note || ""; inp.blur(); }
        });
        chip.insertBefore(inp, pen);
        inp.focus();
      });
      const del = document.createElement("button");
      del.type = "button";
      del.className = "unlink";
      del.textContent = "×";
      del.setAttribute("aria-label", (other ? other.t : "이 책") + " 이음을 푼다");
      del.addEventListener("click", async () => {
        try { await db.removeLink(l.id); renderLinks(b); }
        catch (err) { console.error("[이음] 풀지 못했습니다:", err); }
      });
      chip.append(go, why, pen, del);
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
