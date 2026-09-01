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
    async listBooks({ wall = null, search = null, limit = 5000, page = 500 } = {}) {
      const out = [];
      for (let from = 0; from < limit; from += page) {
        // id 까지 걸어야 쪽이 어긋나지 않는다 — 벽·단·자리는 겹칠 수 있다
        let qy = client.from("books").select("*")
          .order("wall").order("shelf").order("slot").order("id");
        if (wall) qy = qy.eq("wall", wall);
        if (search) qy = qy.or(`title.ilike.%${search}%,author.ilike.%${search}%`);
        const to = Math.min(from + page, limit) - 1;
        const { data, error } = await qy.range(from, to);
        if (error) throw error;
        out.push(...data);
        if (data.length < to - from + 1) break;   // 마지막 쪽이었다
      }
      return out;
    },

    async countBooks() {
      const { count, error } = await client
        .from("books")
        .select("*", { count: "exact", head: true });
      if (error) throw error;
      return count;
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
      );
    },

    /* 궤짝 확정 — 확신이 낮아 궤짝에 담긴 후보를 알라딘에 물어,
       강하게 일치하면(0.75 이상) 그 서지로 바로 꽂는다.
       한 번에 여러 권을 도니 넉넉히 기다린다. */
    async confirmCrate(limit = 20) {
      return guard(
        client.functions.invoke("enrich-books", { body: { crate: true, limit } }),
        180000,
        "궤짝 확정",
      );
    },

    /* 바코드 입고 — ISBN 하나로 서지가 완성된 책을 꽂는다 */
    async addByIsbn(isbn) {
      return guard(
        client.functions.invoke("enrich-books", { body: { add_isbn: isbn } }),
        30000,
        "바코드 입고",
      );
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
      );
    },

    /* 책을 뺀다 — 잘못 읽힌 것을 지운다.
       요약은 book_id 를 따라 함께 지워진다 (on delete cascade). */
    async removeBook(id) {
      const { error } = await client.from("books").delete().eq("id", id);
      if (error) throw error;
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
      );
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

      const { error: upErr } = await client.storage
        .from("intake")
        .upload(path, blob, { contentType: type, upsert: false });
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

    /* 버킷이 비공개라 <img src> 로 바로 못 쓴다 — 한 시간짜리 열쇠를 받아온다 */
    async photoUrl(storagePath, seconds = 3600) {
      const { data, error } = await client.storage
        .from("intake")
        .createSignedUrl(storagePath, seconds);
      if (error) throw error;
      return data.signedUrl;
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

    /* 서가를 그릴 때 조각들의 서명 주소를 한 번에 받는다.
       토큰 갱신 때 서가를 다시 그리지 않으므로, 주소는 하루를 살아야 한다 */
    async signSpineUrls(paths, seconds = 86400) {
      if (!paths.length) return new Map();
      const { data, error } = await client.storage
        .from("covers")
        .createSignedUrls(paths, seconds);
      if (error) throw error;
      const map = new Map();
      (data || []).forEach((d, i) => {
        if (d?.signedUrl && !d.error) map.set(paths[i], d.signedUrl);
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
      );
    },

    async removeIntakePhoto(photo) {
      const { error } = await client.from("intake_photos").delete().eq("id", photo.id);
      if (error) throw error;
      await client.storage.from("intake").remove([photo.storage_path]);
    },

    /* ── 궤짝: 확인이 필요한 책들 ── */
    async listPending() {
      const { data, error } = await client
        .from("intake_candidates")
        .select("*, intake_photos(wall, shelf)")
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
