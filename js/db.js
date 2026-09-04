/* 데이터 접근 계층
 *
 * 지금은 js/data.js 의 표본 데이터로 화면이 돌아간다.
 * 로그인이 붙으면 app.js 가 이 모듈의 함수를 대신 부르도록 바꾼다.
 *
 * 모든 표는 주인(owner_id)만 읽을 수 있으므로, 로그인 전에는
 * 어떤 조회도 빈 배열을 돌려준다 — 오류가 아니라 정책이 맞게 작동하는 것이다.
 */
(function () {
  const cfg = window.POST_LIBROS_CONFIG;
  if (!cfg || typeof window.supabase === "undefined") {
    console.warn("[서재] Supabase 가 아직 연결되지 않았습니다 — 표본 데이터로 돕니다.");
    return;
  }

  /* 인증 처리의 순서를 지키는 자물쇠.
     기본값(navigatorLock)은 탭 사이에 자물쇠를 걸고 얻을 때까지 무한정
     기다린다. 다른 탭이 쥔 채 멈춰 있으면 로그아웃조차 돌아오지 않는다.
     processLock 은 이 탭 안에서만 순서를 지키고 다른 탭을 기다리지 않는다.
     혼자 쓰는 서재라 탭 사이 조율을 포기해도 잃는 것이 거의 없다.
     (직접 만든 자물쇠로 바꿔 봤다가 라이브러리의 재진입 처리를 깨뜨려
      인증 호출마다 5초씩 잡아먹었다 — 라이브러리 것을 쓴다) */
  const lock = window.supabase.processLock;

  const client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: lock ? { lock } : {},
  });

  /* 인증 요청이 응답 없이 매달리는 일이 있다.
     supabase-js 는 탭 사이에 자물쇠를 걸어 인증 처리를 한 번에 하나씩만
     하는데, 다른 탭이 그 자물쇠를 쥔 채 멈춰 있으면 여기서 영영 기다린다.
     그러면 화면은 "…중"에서 굳고 이유도 보이지 않는다.
     시간제한을 두되 결과 모양은 { data, error } 그대로 돌려준다 —
     부르는 쪽이 실패를 늘 하던 방식으로 다루게 하기 위해서다. */
  function guard(promise, ms, what) {
    let timer;
    const limit = new Promise((resolve) => {
      timer = setTimeout(() => resolve({
        data: null,
        error: {
          timedOut: true,
          message: what + " 응답이 없습니다. 이 사이트의 다른 탭을 모두 닫고 다시 해보세요.",
        },
      }), ms);
    });
    return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
  }

  /* Edge Function 이 4xx/5xx 로 답하면 supabase-js 는 몸통을 버리고
     "Edge Function returned a non-2xx status code" 라고만 말한다.
     몸통 안의 진짜 이유({error: "알라딘에서 찾지 못했습니다 …"})를 꺼내 되살린다. */
  async function tellWhy(r) {
    if (r?.error && typeof r.error.context?.json === "function") {
      try {
        const body = await r.error.context.json();
        if (body?.error) r.error = { ...r.error, message: body.error };
      } catch { /* 몸통이 JSON 이 아니면 원래 말 그대로 둔다 */ }
    }
    return r;
  }

  /* 사진의 서명 주소는 한 번 받으면 돌려 쓴다.
     주소가 매번 달라지면 브라우저도 CDN 도 「처음 보는 사진」으로 알고 통째로
     다시 받는다 — 서가를 다시 그릴 때마다 사진 스무 장(20MB)이 새로 내려와
     하루 4GB 가 그렇게 샜다 (2026-09-02 로그). 열두 시간짜리로 받아 두고
     만료 10분 전까지는 같은 주소를 준다. 같은 주소면 브라우저 캐시가 먼저 답한다. */
  const signedUrls = new Map();   // storage_path → { url, exp }
  const SIGN_SECONDS = 12 * 3600;
  const SIGN_MARGIN_MS = 10 * 60 * 1000;

  /* 손톱 그림 — 카드는 180px 인데 원본은 장당 926KB 다.
     서명 주소를 돌려 쓰는 것만으로는 반만 막힌다: 열쇠는 이 페이지가 살아
     있는 동안만 간직되므로, 새로고침하면 열쇠가 새로 나고 열여덟 장 16MB 가
     통째로 다시 내려온다 (같은 사진이어도 주소가 다르면 캐시는 남이다).
     장변 320px·q0.72 짜리를 따로 두어 그 자리를 가볍게 만든다 — 재어 보니
     책장 사진 꼴에서 11.7KB, 압축이 아예 안 되는 잡음으로도 17.8KB 라
     926KB 대비 쉰두 배에서 여든 배다 (2026-09-04 측정).
     원본은 책등을 오릴 때만 받는다 — 그때는 화질이 필요하다. */
  const 썸경로 = (p) => p.replace(/([^/]+)$/, "thumb/$1").replace(/\.[^.]+$/, ".jpg");
  let 썸목록 = null;   // Promise<Set<경로>> · null 이면 아직 안 물어봤다

  /* 장서도 한 번 받아 두고 그다음부터는 바뀐 줄만 덧댄다.
     책 한 권을 고칠 때마다 서가를 다시 그리는데, 그때마다 544권(447KB)을
     통째로 다시 받으면 손질 스무 번에 9MB 다 — 무료 요금제의 Egress 는
     그렇게 닳는다 (2026-09-02).
     books_touch 트리거가 손댈 때마다 updated_at 을 새로 적어 두니,
     가장 늦은 시각 뒤에 손댄 줄만 물어 오면 된다. 시각은 서버가 적은 것을
     그대로 되돌려 준다 — 브라우저 시계가 어긋나도 상관없도록. */
  const bookCache = { rows: null, mark: null };

  /* 화면은 벽·단·자리 순으로 놓인 장서를 기대한다 (listBooks 의 order 와 같다).
     비어 있는 자리는 뒤로 — PostgREST 의 오름차순 기본값(NULLS LAST)과 맞춘다. */
  function byShelfOrder(a, b) {
    const cmp = (x, y) => {
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return x < y ? -1 : 1;
    };
    return cmp(a.wall, b.wall) || cmp(a.shelf, b.shelf)
      || cmp(a.slot, b.slot) || cmp(a.id, b.id);
  }

  function keepBooks(rows) {
    bookCache.rows = rows.slice().sort(byShelfOrder);
    bookCache.mark = rows.reduce(
      (m, b) => (b.updated_at && (!m || b.updated_at > m) ? b.updated_at : m), null,
    );
    return bookCache.rows;
  }

  const db = {
    client,

    /* ── 로그인 ── */
    async signIn(email) {
      // 비밀번호 없이 메일로 들어온다.
      // 링크는 지금 보고 있는 주소로 돌아오게 한다 — 로컬이든 배포든 같은 코드로 맞는다.
      // (단, 그 주소가 Supabase 의 Redirect URLs 목록에 있어야 통한다)
      //
      // 여긴 가입하는 곳이 아니라 주인이 들어오는 곳이다.
      // 등록된 계정이 아니면 메일조차 나가지 않는다.
      //
      // 다만 이건 화면 쪽 잠금일 뿐이다 — 진짜 잠금은 대시보드에서 신규
      // 가입을 꺼둔 것이고(2026-09-01 확인), 브라우저를 거치지 않고 API 를
      // 직접 불러도 거부된다. 이 옵션은 안내 문구를 위한 것에 가깝다.
      //
      // 주의: 주인 계정을 새로 만들어야 할 일이 생기면 이 값만 바꿔선 안 된다.
      // 대시보드의 가입 차단을 먼저 풀어야 한다 — 그러지 않으면 계정을
      // 만들 길이 없어진다.
      return guard(client.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: location.origin + location.pathname,
          shouldCreateUser: false,
        },
      }), 15000, "열쇠 보내기");
    },
    /* 비밀번호로 들어오기 — 평소에 쓰는 길.
       가입이 잠겨 있어도 이미 있는 계정의 로그인은 막히지 않는다. */
    async signInWithPassword(email, password) {
      return guard(client.auth.signInWithPassword({ email, password }), 15000, "로그인");
    },

    /* 비밀번호 정하기·바꾸기 — 들어와 있는 동안에만 된다.
       그래서 처음 한 번은 메일 링크로 들어와야 한다. */
    async setPassword(password) {
      return guard(client.auth.updateUser({ password }), 15000, "비밀번호 변경");
    },

    async signOut() {
      // 재설정·로그아웃은 전체 세션을 끊는다 (지금 이 접속만 남기지 않는다)
      const r = await guard(client.auth.signOut(), 8000, "로그아웃");
      if (r?.error?.timedOut) {
        // 서버에 닿지 못해도 이 기기에서는 확실히 나가게 한다.
        // 자물쇠에 갇힌 상태라 라이브러리를 한 번 더 부르면 같이 갇힌다 —
        // 저장된 세션을 직접 지운다.
        try {
          Object.keys(localStorage)
            .filter((k) => k.startsWith("sb-") && k.includes("auth"))
            .forEach((k) => localStorage.removeItem(k));
        } catch (e) {
          console.warn("[서재] 저장된 세션을 지우지 못했습니다:", e);
        }
      }
      return r;
    },
    /* 지금 들어와 있는 사람.
       getUser() 는 서버에 물어보는 호출이라 늦거나 막히면 "없음"으로 답하게 되고,
       그러면 화면이 로그인이 풀린 줄 알고 주인용 자리를 지워 버린다.
       (사진 올리는 자리가 몇 초 뒤 사라진 것이 이 때문이었다)
       세션은 브라우저에 저장돼 있으니 그것을 읽는다 — 네트워크를 타지 않는다. */
    async currentUser() {
      const { data } = await client.auth.getSession();
      return data?.session?.user ?? null;
    },

    /* ── 장서 ── */
    /* 장서 전체를 쪽으로 나눠 읽는다.
       PostgREST 에는 한 번에 돌려주는 줄 수의 상한(기본 1,000)이 있어,
       .limit(2000) 이라 적어도 조용히 잘린다. 상한값을 짐작하지 않고
       한 쪽씩 끝까지 읽는다 — 서재가 커져도 그대로 산다. */
    async listBooks({ wall = null, limit = 5000, page = 500 } = {}) {
      /* 예전에는 search 매개변수가 있어 `.or(\`title.ilike.%${search}%,…\`)` 로
         PostgREST 필터 문법에 입력을 그대로 끼웠다 — 「,」「)」가 절을 바꾸는
         주입 구멍이었고, 부르는 곳도 없었다. 찾기는 화면 쪽(app.js 의 q())이
         받아 둔 장서 안에서 한다. 서버 쪽 찾기가 다시 필요해지면 .ilike() 를
         낱낱이 걸 것 — 문자열을 이어 붙여 만들지 말 것. */
      const out = [];
      for (let from = 0; from < limit; from += page) {
        // id 까지 걸어야 쪽이 어긋나지 않는다 — 벽·단·자리는 겹칠 수 있다
        let qy = client.from("books").select("*")
          .order("wall").order("shelf").order("slot").order("id");
        if (wall) qy = qy.eq("wall", wall);
        const to = Math.min(from + page, limit) - 1;
        const { data, error } = await qy.range(from, to);
        if (error) throw error;
        out.push(...data);
        if (data.length < to - from + 1) break;   // 마지막 쪽이었다
      }
      return out;
    },

    /* 서가를 다시 그릴 때 쓰는 장서 — 처음에는 전부, 그다음부터는 바뀐 것만.
       한 권 고치고 부르면 한 줄(수백 바이트)만 오간다. 걸러 보는 목록
       (listBooks 의 wall) 은 이 길을 쓰지 않는다. */
    async syncBooks() {
      if (!bookCache.rows || !bookCache.mark) {
        return keepBooks(await this.listBooks({ limit: 5000 }));
      }
      // 경계에 걸친 줄을 놓치지 않도록 gte 로 묻고 id 로 덮어쓴다
      const { data, error } = await client.from("books").select("*")
        .gte("updated_at", bookCache.mark);
      if (error) throw error;
      /* 한 번에 돌려주는 줄 수에는 상한(1,000)이 있다 — 서지 채우기처럼
         수백 권을 한꺼번에 손댄 뒤라면 조용히 잘렸을 수 있으니 다 읽는다 */
      if (data.length >= 1000) return keepBooks(await this.listBooks({ limit: 5000 }));

      const merged = new Map(bookCache.rows.map((b) => [b.id, b]));
      data.forEach((b) => merged.set(b.id, b));

      /* 지워진 책은 updated_at 으로 알 길이 없다 — 권수가 어긋나면 다시 다 읽는다.
         셈만 묻는 질의(head)라 줄은 한 줄도 오지 않는다. */
      let n = merged.size;
      try { n = await this.countBooks(); } catch (e) { console.warn("[장서] 권수를 세지 못했습니다:", e); }
      if (n !== merged.size) return keepBooks(await this.listBooks({ limit: 5000 }));

      return keepBooks([...merged.values()]);
    },

    /* 다음 번에 장서를 통째로 다시 읽게 한다 — 손으로 지웠을 때처럼
       셈으로도 잡히지 않을 만한 일이 있었으면 이것을 부른다. */
    forgetBooks() {
      bookCache.rows = null;
      bookCache.mark = null;
    },

    async countBooks() {
      const { count, error } = await client
        .from("books")
        .select("*", { count: "exact", head: true });
      if (error) throw error;
      return count;
    },

    /* 오늘 알라딘에 물어본 권수 — 하루 호출 한도(5,000건)의 계기판 재료.
       알라딘의 하루는 한국 시간 자정에 갈리므로 그 경계로 센다. */
    async countTriedToday() {
      const now = new Date();
      // 한국 시간 오늘 0시를 UTC 로 환산한다 (KST = UTC+9)
      const kst = new Date(now.getTime() + 9 * 3600 * 1000);
      const midnightUtc = new Date(Date.UTC(
        kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate(), 0, 0, 0,
      ).valueOf() - 9 * 3600 * 1000);
      const { count, error } = await client.from("books")
        .select("id", { count: "exact", head: true })
        .gte("enrich_tried_at", midnightUtc.toISOString());
      if (error) throw error;
      return count ?? 0;
    },

    /* 서재의 빈 칸을 한 번에 센다 — 들이기 첫머리의 「건강 상태」가 쓴다.
       열을 하나씩 세는 질의를 여덟 번 던지지 않고, 장서를 한 번 훑어 센다
       (화면이 방금 같은 것을 실어 왔으므로 syncBooks 가 간직한 것을 그대로 쓴다). */
    async healthCounts() {
      const books = await this.syncBooks();
      const n = (f) => books.filter(f).length;
      const [sum, photos, links] = await Promise.all([
        this.listSummarizedIds().catch(() => []),
        client.from("intake_photos").select("id, status").then((r) => r.data || []),
        this.listAllLinks().catch(() => []),
      ]);
      return {
        전체: books.length,
        서지: n((b) => b.isbn),
        갈래: n((b) => b.genre),
        표지: n((b) => b.cover_url),
        책등조각: n((b) => b.spine_url),
        오릴것: n((b) => b.spine_box && !b.spine_url),
        이름없음: n((b) => !b.author || b.author === ""),
        읽음: n((b) => b.read_status === "읽음"),
        메모: n((b) => b.memo && b.memo.trim()),
        읽고메모없음: n((b) => b.read_status === "읽음" && !(b.memo && b.memo.trim())),
        기록: sum.length,
        사진: photos.length,
        이음: links.length,
        까닭: links.filter((l) => l.note && String(l.note).trim()).length,
      };
    },

    /* 지은이가 비어 있는 책들 — 「이름 없는 책들」 작업대의 재료 */
    async listAuthorless(limit = 200) {
      const { data, error } = await client.from("books")
        .select("id, title, author, isbn, category, wall, cover_url")
        .or("author.is.null,author.eq.")
        .order("title")
        .limit(limit);
      if (error) throw error;
      return data ?? [];
    },

    /* ── 요약: 없으면 만들지 않고 null 을 돌려준다 ──
       실제 생성은 Edge Function 이 맡는다. 열어본 책에만 비용이 든다. */
    async getSummary(bookId) {
      const { data, error } = await client
        .from("book_summaries")
        .select("summary, model, generated_at")
        .eq("book_id", bookId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },

    /* 책 한 권을 고친다 — 읽음 상태, 벽·단, 메모 */
    async updateBook(id, patch) {
      const { data, error } = await client
        .from("books").update(patch).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },

    /* 서지를 채운다 — 알라딘에 물어 ISBN·출판사·표지·분류를 넣는다.
       한 번에 여러 권을 도니 넉넉히 기다린다. */
    async enrichBooks(limit = 20) {
      return guard(
        client.functions.invoke("enrich-books", { body: { limit } }),
        180000,
        "서지 채우기",
      ).then(tellWhy);
    },

    /* 알라딘이 지금 응답하는지 한 번 묻는다 — 계기판의 눈금은 어림이지만
       이것은 사실이다. 한도를 넘겨 키가 막히면 errorCode 가 돌아온다. */
    async aladinAlive() {
      const { data, error } = await guard(
        client.functions.invoke("enrich-books", { body: { probe: "책" } }),
        20000,
        "알라딘 상태",
      ).then(tellWhy);
      if (error) throw error;
      const why = data?.shape?.오류 ?? null;
      return { alive: !why, why };
    },

    /* 갈래 채우기 — 문학 벽의 단을 가를 세부 갈래를 받아온다.
       ISBN 을 아는 책만 고르므로 권당 조회 1회 — 서지 채우기보다 훨씬 싸다. */
    async fillGenres(limit = 40) {
      return guard(
        client.functions.invoke("enrich-books", { body: { genre: true, limit } }),
        180000,
        "갈래 채우기",
      ).then(tellWhy);
    },

    /* 궤짝 확정 — 확신이 낮아 궤짝에 담긴 후보를 알라딘에 물어,
       강하게 일치하면(0.75 이상) 그 서지로 바로 꽂는다.
       한 번에 여러 권을 도니 넉넉히 기다린다. */
    async confirmCrate(limit = 20) {
      return guard(
        client.functions.invoke("enrich-books", { body: { crate: true, limit } }),
        180000,
        "궤짝 확정",
      ).then(tellWhy);
    },

    /* 궤짝 수동 검색 — 자동 확정이 못 정한 후보를, 사람이 고쳐 쓴 글자로
       알라딘에 다시 물어 꽂는다 (문턱 0.5) */
    async confirmCandidate(candidateId, query) {
      return guard(
        client.functions.invoke("enrich-books", {
          body: { candidate_id: candidateId, query },
        }),
        30000,
        "궤짝 검색",
      ).then(tellWhy);
    },

    /* 바코드 입고 — ISBN 하나로 서지가 완성된 책을 꽂는다 */
    async addByIsbn(isbn) {
      return guard(
        client.functions.invoke("enrich-books", { body: { add_isbn: isbn } }),
        30000,
        "바코드 입고",
      ).then(tellWhy);
    },

    /* 한 권만 서지를 받아온다 — 서표의 단추.
       이미 물어본 책이어도 다시 묻는다. isbn 을 주면 검색 없이
       그 번호로 정확히 조회한다 — 제목 검색이 못 찾는 책의 마지막 길. */
    async enrichBook(bookId, isbn = null) {
      return guard(
        client.functions.invoke("enrich-books", {
          body: isbn ? { book_id: bookId, isbn } : { book_id: bookId },
        }),
        30000,
        "서지 받아오기",
      ).then(tellWhy);
    },

    /* 책을 뺀다 — 잘못 읽힌 것을 지운다.
       요약은 book_id 를 따라 함께 지워진다 (on delete cascade). */
    async removeBook(id) {
      const { error } = await client.from("books").delete().eq("id", id);
      if (error) throw error;
      // 간직한 장서에서도 빼 준다 — 그래야 다음 syncBooks 가 권수를 보고
      // 544권을 통째로 다시 읽지 않는다
      if (bookCache.rows) bookCache.rows = bookCache.rows.filter((b) => b.id !== id);
    },

    /* 손으로 한 권 들인다 — AI 가 놓친 책을 직접 꽂을 때 */
    async addBook(book) {
      const { data, error } = await client
        .from("books").insert(book).select().single();
      if (error) throw error;
      return data;
    },

    /* 기록을 짓는다 — 처음 펼칠 때만 돈이 든다.
       이미 있으면 함수가 저장된 것을 그대로 돌려준다. */
    async summarizeBook(bookId) {
      return guard(
        client.functions.invoke("summarize-book", { body: { book_id: bookId } }),
        120000,
        "기록 짓기",
      ).then(tellWhy);
    },

    /* ── 책 사이 이음 — 방향 없는 연결 (A↔B 한 줄) ── */
    async listLinks(bookId) {
      const { data, error } = await client
        .from("book_links")
        .select("id, book_id, linked_book_id, note, kind")
        .or(`book_id.eq.${bookId},linked_book_id.eq.${bookId}`);
      if (error) throw error;
      return data;
    },

    /* 이음의 까닭을 적는다 — 화살표 위에 걸리는 말.
       「사회비판적인 글을 읽고 싶다면」처럼 왜 그리로 가는지. */
    async updateLink(linkId, patch) {
      // 예전에는 두 번째 인자가 그냥 문자열이었다 — 둘 다 받아 준다
      const body = typeof patch === "string" ? { note: patch || null } : patch;
      const { error } = await client.from("book_links").update(body).eq("id", linkId);
      if (error) throw error;
    },

    /* 길의 방향을 뒤집는다 — 「이 책 다음에」와 「이 책보다 먼저」는
       같은 이음을 양쪽에서 본 것이다. 줄을 지우고 다시 긋는 대신 바꿔 끼운다. */
    async flipLink(link) {
      const { error } = await client.from("book_links")
        .update({ book_id: link.linked_book_id, linked_book_id: link.book_id })
        .eq("id", link.id);
      if (error) throw error;
    },

    /* 이미 이어져 있으면(뒤집힌 방향 포함, 23505) { dup: true } 로 알린다 */
    async addLink(bookId, otherId) {
      const { error } = await client
        .from("book_links").insert({ book_id: bookId, linked_book_id: otherId });
      if (error) {
        if (error.code === "23505") return { dup: true };
        throw error;
      }
      return { ok: true };
    },

    async removeLink(linkId) {
      const { error } = await client.from("book_links").delete().eq("id", linkId);
      if (error) throw error;
    },

    /* 이음 전체 — 별자리 그림과 이음 제안의 재료.
       PostgREST 상한(1,000줄)을 넘길 수 있어 쪽으로 나눠 읽는다. */
    async listAllLinks() {
      const out = [];
      for (let from = 0; from < 5000; from += 500) {
        const { data, error } = await client
          .from("book_links")
          .select("id, book_id, linked_book_id, note, kind")
          .order("id")
          .range(from, from + 499);
        if (error) throw error;
        out.push(...data);
        if (data.length < 500) break;
      }
      return out;
    },

    /* 기록이 이미 있는 책들의 id — 일괄 짓기에서 빼놓을 목록 */
    async listSummarizedIds() {
      const out = [];
      for (let from = 0; from < 5000; from += 500) {
        const { data, error } = await client
          .from("book_summaries")
          .select("book_id")
          .order("book_id")
          .range(from, from + 499);
        if (error) throw error;
        out.push(...data.map((r) => r.book_id));
        if (data.length < 500) break;
      }
      return out;
    },

    /* ── 기록의 방 ── */
    async addArchiveItem(item) {
      const { data, error } = await client
        .from("archive_items").insert(item).select().single();
      if (error) throw error;
      return data;
    },

    async removeArchiveItem(id) {
      const { error } = await client.from("archive_items").delete().eq("id", id);
      if (error) throw error;
    },

    async listArchive({ tag = null, search = null } = {}) {
      let qy = client.from("archive_items").select("*").order("created_at", { ascending: false });
      if (tag) qy = qy.contains("tags", [tag]);
      if (search) qy = qy.ilike("title", `%${search}%`);
      const { data, error } = await qy;
      if (error) throw error;
      return data;
    },

    /* ── 책장 사진 들이기 ──
       사진 한 장이 곧 위치 기록이다 — 어느 벽 몇 단을 찍었는지가 함께 남는다.
       파일은 `<uid>/파일명` 으로 올린다. 스토리지 정책이 첫 폴더가 주인의
       uid 인지 보고 통과시키므로, 이 규칙을 어기면 업로드가 거부된다. */
    async uploadIntakePhoto(blob, { wall = null, shelf = null } = {}) {
      const user = await this.currentUser();
      if (!user) throw new Error("주인만 사진을 들일 수 있습니다");

      const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
      const rand = Math.random().toString(36).slice(2, 8);
      // 아이폰 HEIC 처럼 브라우저가 못 여는 형식은 줄이지 못하고 원본 그대로 올라온다
      const type = blob.type || "image/jpeg";
      const ext = (type.split("/")[1] || "jpg").replace("jpeg", "jpg");
      const path = `${user.id}/${stamp}-${rand}.${ext}`;

      // 경로에 시각·난수가 들어 같은 사진이 바뀔 일이 없다 — 브라우저와 CDN 이
      // 하루 동안 붙들고 있어도 된다 (기본값은 한 시간)
      const { error: upErr } = await client.storage
        .from("intake")
        .upload(path, blob, { contentType: type, upsert: false, cacheControl: "86400" });
      if (upErr) throw upErr;

      // 줄을 만들지 못하면 올라간 파일만 남아 떠돈다 — 지우고 실패를 알린다
      const { data, error } = await client
        .from("intake_photos")
        .insert({ storage_path: path, wall, shelf })
        .select()
        .single();
      if (error) {
        await client.storage.from("intake").remove([path]);
        throw error;
      }
      return data;
    },

    async listIntakePhotos({ limit = 60 } = {}) {
      const { data, error } = await client
        .from("intake_photos")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data;
    },

    /* 버킷이 비공개라 <img src> 로 바로 못 쓴다 — 열쇠를 받아온다.
       같은 사진은 같은 열쇠를 돌려준다 (위 signedUrls 참고). */
    async photoUrl(storagePath, seconds = SIGN_SECONDS) {
      const kept = signedUrls.get(storagePath);
      if (kept && kept.exp - Date.now() > SIGN_MARGIN_MS) return kept.url;
      const { data, error } = await client.storage
        .from("intake")
        .createSignedUrl(storagePath, seconds);
      if (error) throw error;
      signedUrls.set(storagePath, { url: data.signedUrl, exp: Date.now() + seconds * 1000 });
      return data.signedUrl;
    },

    /* 손톱 그림이 있는 경로를 한 번만 물어 둔다 — 장마다 「있느냐」고
       물으면 없는 것마다 오류 한 번씩이라 시끄럽다. 목록은 한 번이면 된다. */
    async 썸있는것() {
      /* 카드 열여덟 장이 한꺼번에 묻는다 — 답이 아니라 **묻는 일**을 간직해야
         목록을 한 번만 받는다 (다 받은 뒤에 간직하면 열여덟 번 묻는다) */
      if (썸목록) return 썸목록;
      썸목록 = (async () => {
        const user = await this.currentUser();
        if (!user) { 썸목록 = null; return new Set(); }   // 손님 — 들어오면 다시 묻게
        const { data } = await client.storage
          .from("intake").list(`${user.id}/thumb`, { limit: 500 });
        return new Set((data || []).map((f) => `${user.id}/thumb/${f.name}`));
      })();
      return 썸목록;
    },

    /* 손톱 그림의 주소 — 아직 없으면 null 이다 (부르는 쪽이 원본으로 물러선다) */
    async thumbUrl(storagePath) {
      const 길 = 썸경로(storagePath);
      const 있는것 = await this.썸있는것();
      if (!있는것.has(길)) return null;
      return this.photoUrl(길);
    },

    /* 손톱 그림을 둔다. 경로에 시각·난수가 들어 바뀔 일이 없으니 이레를 붙든다. */
    async putThumb(storagePath, blob) {
      const 길 = 썸경로(storagePath);
      const { error } = await client.storage.from("intake")
        .upload(길, blob, { contentType: "image/jpeg", upsert: true, cacheControl: "604800" });
      if (error) throw error;
      (await this.썸있는것()).add(길);
      return 길;
    },

    /* 이 책을 어느 사진에서 만났는가 — 서표에서 원본 책장 사진을 연다.
       intake 버킷은 비공개라 주인만 서명 주소를 받는다 (방문자는 조용히 실패). */
    async spinePhotoUrl(photoId) {
      const { data, error } = await client
        .from("intake_photos").select("storage_path, wall, shelf")
        .eq("id", photoId).maybeSingle();
      if (error || !data?.storage_path) return null;
      const url = await this.photoUrl(data.storage_path).catch(() => null);
      return url ? { url, wall: data.wall, shelf: data.shelf } : null;
    },

    /* ── 실물 책등 조각 ──
       인식 때 받은 자리 상자(spine_box)로 사진에서 그 책등만 오려 낸다.
       조각은 covers 버킷 <uid>/spines/<책id>.webp 로 산다. */
    async listUncroppedSpines() {
      const { data, error } = await client
        .from("books")
        .select("id, spine_photo_id, spine_box, intake_photos(storage_path)")
        .not("spine_box", "is", null)
        .not("spine_photo_id", "is", null)
        .is("spine_url", null);
      if (error) throw error;
      return data;
    },

    async uploadSpineCrop(bookId, blob) {
      const user = await this.currentUser();
      if (!user) throw new Error("주인만 오려 붙일 수 있습니다");
      const path = `${user.id}/spines/${bookId}.webp`;
      const { error: upErr } = await client.storage
        .from("covers")
        .upload(path, blob, { contentType: "image/webp", upsert: true });
      if (upErr) throw upErr;
      const { error } = await client.from("books")
        .update({ spine_url: path }).eq("id", bookId);
      if (error) throw error;
      return path;
    },

    /* 서가를 그릴 때 조각들의 주소를 만든다.
       covers 버킷이 공개가 되어(공개 서재 전환) 서명이 필요 없다 —
       주소만 조립하면 되고 네트워크도 타지 않는다. 방문자도 같은 길을 쓴다. */
    async signSpineUrls(paths) {
      const map = new Map();
      paths.forEach((p) => {
        const { data } = client.storage.from("covers").getPublicUrl(p);
        if (data?.publicUrl) map.set(p, data.publicUrl);
      });
      return map;
    },

    /* 책등 읽기 — 사진 한 장을 Edge Function 에 넘긴다.
       AI 키는 그 안에만 있다. 사진 한 장에 수십 권이라 오래 걸릴 수 있어
       시간제한을 넉넉히 둔다. */
    async recognizeSpines(photoId) {
      return guard(
        client.functions.invoke("recognize-spines", { body: { photo_id: photoId } }),
        180000,
        "책등 읽기",
      ).then(tellWhy);
    },

    async removeIntakePhoto(photo) {
      const { error } = await client.from("intake_photos").delete().eq("id", photo.id);
      if (error) throw error;
      // 손톱 그림도 함께 — 원본만 지우면 그림이 주인 없이 남는다
      const 길 = 썸경로(photo.storage_path);
      await client.storage.from("intake").remove([photo.storage_path, 길]);
      (await this.썸있는것()).delete(길);
    },

    /* ── 궤짝: 확인이 필요한 책들 ── */
    async listPending() {
      const { data, error } = await client
        .from("intake_candidates")
        // storage_path 는 궤짝에서 책등 사진 조각을 곁들여 보여줄 때 쓴다
        .select("*, intake_photos(wall, shelf, storage_path)")
        .eq("status", "대기")
        .order("created_at");
      if (error) throw error;
      return data;
    },

    /* 후보가 전부 틀렸을 때 — 책을 만들지 않고 궤짝에서만 내린다 */
    async dismissCandidate(candidateId) {
      const { error } = await client
        .from("intake_candidates")
        .update({ status: "버림" })
        .eq("id", candidateId);
      if (error) throw error;
    },

    /* 이미 꽂힌 책과 겹치면(23505) 책을 만들지 않고 후보만 접는다 —
       다른 사진에 같은 책이 두 번 찍힌 것일 뿐이다. { dup: true } 로 알린다. */
    async resolveCandidate(candidateId, book) {
      const { data: inserted, error: e1 } = await client
        .from("books").insert(book).select("id").single();
      if (e1) {
        if (e1.code === "23505") {
          await client.from("intake_candidates")
            .update({ status: "버림" }).eq("id", candidateId);
          return { dup: true };
        }
        throw e1;
      }
      const { error: e2 } = await client
        .from("intake_candidates")
        .update({ status: "확정", resolved_book_id: inserted.id })
        .eq("id", candidateId);
      if (e2) throw e2;
      return { id: inserted.id };
    },
  };

  window.PostLibrosDB = db;
})();
