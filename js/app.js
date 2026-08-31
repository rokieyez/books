/* 화면 렌더와 상호작용 */
/* ── 벽 렌더 ──────────────────────────────────────────── */
  function q() { return $("q").value.trim().toLowerCase(); }
  function anyOpen() { return !!document.querySelector(".wallsec.open"); }
  function syncBodyClass() { document.body.classList.toggle("door-open", anyOpen()); }

  const wallEls = [];
  function renderWalls() {
    const host = $("walls"); host.innerHTML = "";
    wallEls.length = 0;
    syncBodyClass();
    WALLS.forEach((w) => {
      const sec = document.createElement("section");
      sec.className = "wallsec";
      wallEls.push({ el: sec, w });
      const hits = (w.cat !== "archive" && q())
        ? w.books.filter(b => (b.t+" "+b.a).toLowerCase().includes(q())).length : null;
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
        LEAVES.forEach(l => {
          const el = document.createElement("div"); el.className = "leafrow";
          el.innerHTML = `<span class="tp">${l.tp}</span><b></b><p></p>`;
          el.querySelector("b").textContent = l.t;
          el.querySelector("p").textContent = l.x;
          room.appendChild(el);
        });
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
          el.textContent = b.t;
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
        for (let s = 0; s < 3; s++) {
          const line = document.createElement("div"); line.className = "shelfline";
          w.books.slice(s*22, (s+1)*22).forEach((b, k) => {
            const idx = s*22 + k;
            const el = document.createElement("button"); el.className = "tome";
            const latch = idx === w.latchIdx;
            const dim = q() && !((b.t+" "+b.a).toLowerCase().includes(q()));
            if (latch) el.classList.add("latch");
            else {
              if (b.paper) el.classList.add("paper");
              if (b.lean) el.classList.add("lean");
              if (b.folio) el.classList.add("folio");
              if (dim) el.classList.add("dim");
            }
            el.style.cssText = `background-color:${latch ? "#8A5A2E" : b.c};height:${b.h}px;width:${b.w2}px;`;
            if (!latch) el.textContent = b.t;
            el.title = latch ? "…이 책이 조금 이상하다" : `${b.t} — ${b.a}`;
            if (latch) {
              el.addEventListener("mouseenter", () => box.classList.add("leak"));
              el.addEventListener("mouseleave", () => box.classList.remove("leak"));
              el.addEventListener("focus", () => box.classList.add("leak"));
              el.addEventListener("blur", () => box.classList.remove("leak"));
            }
            el.addEventListener("click", (e) => {
              e.stopPropagation();
              if (latch) { box.classList.remove("leak"); openDoor(); }
              else openExlibris(b, w);
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
  function bookWall(b) { return WALLS.find(w => w.books && w.books.includes(b)); }
  function allBooks() { return WALLS.filter(w => w.books).flatMap(w => w.books); }
  function filteredBooks() {
    const query = q();
    return allBooks().filter(b => !query || (b.t + " " + b.a).toLowerCase().includes(query));
  }
  function setView(v) {
    curView = v;
    document.querySelectorAll(".viewseg button").forEach(b =>
      b.setAttribute("aria-selected", b.dataset.v === v ? "true" : "false"));
    $("walls").hidden = v !== "walls";
    $("crate").hidden = v !== "walls";
    $("desk").hidden = v !== "walls";
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

  /* 표지 뷰 */
  function renderCovers() {
    const box = $("covergrid"); box.innerHTML = "";
    const list = filteredBooks();
    list.slice(0, 48).forEach(b => {
      const el = document.createElement("button");
      el.className = "cover";
      el.style.setProperty("--cvr", b.c);
      el.innerHTML = `<b></b><span></span>`;
      el.querySelector("b").textContent = b.t;
      el.querySelector("span").textContent = b.a;
      el.addEventListener("click", () => openExlibris(b, bookWall(b)));
      box.appendChild(el);
    });
    $("cover-note").textContent = list.length > 48
      ? `— 등불이 닿는 48권까지 — 실제로는 ${(1284 - 48).toLocaleString()}권이 이어진다 —`
      : (q() ? `"${$("q").value.trim()}" — ${list.length}권 응답` : "");
  }

  /* 목록 뷰 */
  const STCOLOR = { "읽음": "var(--st-done)", "읽는 중": "var(--st-doing)", "안 읽음": "var(--st-todo)" };
  function renderList() {
    const body = $("listbody"); body.innerHTML = "";
    const list = filteredBooks();
    list.slice(0, 20).forEach(b => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td class="t"></td><td></td><td></td>
        <td><span class="st-dot" style="background:${STCOLOR[b.st]}"></span>${b.st}</td>
        <td>${b.year}</td><td></td>`;
      tr.children[0].textContent = b.t;
      tr.children[1].textContent = b.a;
      tr.children[2].textContent = b.cat;
      tr.children[5].textContent = b.loc;
      tr.addEventListener("click", () => openExlibris(b, bookWall(b)));
      body.appendChild(tr);
    });
    $("listnote").textContent = `${list.length.toLocaleString()}권 일치 — ${Math.min(20, list.length)}권 표시`
      + (q() ? ` (검색어: "${$("q").value.trim()}")` : " — 검색으로 좁혀보세요");
  }

  /* 통계 뷰 */
  const CATSTAT = [["문학",433],["역사",287],["과학",198],["예술",152],["사회",129],["기타",85]];
  const YEARSTAT = [["'19",58],["'20",96],["'21",124],["'22",161],["'23",187],["'24",219],["'25",248],["'26",191]];
  const AUTHSTAT = [["박경리",21],["시오노 나나미",15],["유홍준",13],["김훈",9],["헤르만 헤세",8]];
  let statsDone = false;
  function renderStats() {
    if (statsDone) return;
    statsDone = true;
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
    const ymax = Math.max(...YEARSTAT.map(y => y[1]));
    YEARSTAT.forEach(([y, v], i) => {
      const el = document.createElement("div"); el.className = "col";
      const showVal = v === ymax || i === YEARSTAT.length - 1;
      el.innerHTML = `<span class="vl">${showVal ? v : ""}</span><i style="height:0%"></i><span class="yl">${y}</span>`;
      el.title = `20${y.slice(1)}년 ${v}권 입고`;
      grow.push([el.querySelector("i"), "height", Math.round(v/ymax*76) + "%"]);
      yc.appendChild(el);
    });
    const sb = $("statusbar");
    [["읽음",41,"var(--st-done)","#F2EDE0"],["읽는 중",6,"var(--st-doing)","#241708"],["안 읽음",53,"var(--st-todo)","#F2EDE0"]].forEach(([nm,p,c,txt]) => {
      const seg = document.createElement("i");
      seg.style.cssText = `width:${p}%;background:${c};color:${txt};`;
      if (p >= 10) seg.textContent = p + "%";
      seg.title = `${nm} ${p}%`;
      sb.appendChild(seg);
    });
    const ab = $("authorbars");
    const amax = AUTHSTAT[0][1];
    AUTHSTAT.forEach(([nm, v]) => {
      const el = document.createElement("div"); el.className = "hbar";
      el.innerHTML = `<span class="lb" style="font-size:11.5px"></span><span class="track"><span class="fill" style="width:0%;background:var(--brass-dim)"></span></span><span class="val">${v}권</span>`;
      el.querySelector(".lb").textContent = nm;
      grow.push([el.querySelector(".fill"), "width", Math.round(v/amax*100) + "%"]);
      ab.appendChild(el);
    });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      grow.forEach(([el, prop, val]) => el.style[prop] = val);
    }));
  }

  $("q").addEventListener("input", () => {
    renderWalls();
    if (curView === "covers") renderCovers();
    if (curView === "list") renderList();
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
    $("cratewrap").classList.add("open");
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
  function openExlibris(b, w) {
    $("x-mark").textContent = `${w ? w.nm : "책상 위"} · ${b.cat || "문학"}`;
    $("x-title").textContent = b.t;
    $("x-byline").textContent = `${b.a}${b.year ? " · " + b.year + " 입고" : ""}`;
    const cur = CURATED[b.t];
    $("x-full").hidden = !cur;
    $("x-pending").hidden = !!cur;
    if (cur) { $("x-summary").textContent = cur.s; $("x-memo").textContent = cur.m; }
    $("veil").classList.add("show");
    $("exlibris").classList.add("show");
  }
  function closeExlibris() {
    $("veil").classList.remove("show");
    $("exlibris").classList.remove("show");
  }
  $("x-close").addEventListener("click", closeExlibris);
  $("veil").addEventListener("click", closeExlibris);
  $("x-gen").addEventListener("click", () => {
    $("x-pending").hidden = true;
    $("x-full").hidden = false;
    $("x-summary").textContent = "…실서비스에서는 이 자리에서 AI가 책 소개를 바탕으로 요약을 지어 넣습니다. 열어보는 책에만 비용이 듭니다.";
    $("x-memo").textContent = "메모는 이 자리에서 바로 적어 넣습니다.";
  });
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    if ($("exlibris").classList.contains("show")) { closeExlibris(); return; }
    const open = document.querySelector(".wallsec.open");
    if (open) { open.classList.remove("open"); syncBodyClass(); }
  });
  $("today-open").addEventListener("click", () => openExlibris({ t:"난장이가 쏘아올린 작은 공", a:"조세희", cat:"문학", year: 2025 }, null));

  renderWalls(); updateLadder();
  addEventListener("load", () => { layoutLadder(); updateLadder(); });
