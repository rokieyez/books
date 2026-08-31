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

  const client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);

  const db = {
    client,

    /* ── 로그인 ── */
    async signIn(email) {
      // 비밀번호 없이 메일로 들어온다.
      // 링크는 지금 보고 있는 주소로 돌아오게 한다 — 로컬이든 배포든 같은 코드로 맞는다.
      // (단, 그 주소가 Supabase 의 Redirect URLs 목록에 있어야 통한다)
      //
      // shouldCreateUser: false — 여긴 가입하는 곳이 아니라 주인이 들어오는 곳이다.
      // 이미 있는 계정이 아니면 메일조차 나가지 않는다.
      // 다만 이건 화면 쪽 잠금일 뿐이다. 진짜 잠금은 Supabase 대시보드에서
      // 신규 가입을 꺼두는 것 — 브라우저를 거치지 않고 API 를 직접 부르면
      // 이 옵션은 무력하다.
      return client.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: location.origin + location.pathname,
          shouldCreateUser: false,
        },
      });
    },
    async signOut() {
      // 재설정·로그아웃은 전체 세션을 끊는다 (지금 이 접속만 남기지 않는다)
      return client.auth.signOut();
    },
    async currentUser() {
      const { data } = await client.auth.getUser();
      return data.user ?? null;
    },

    /* ── 장서 ── */
    async listBooks({ wall = null, search = null, limit = 200 } = {}) {
      let qy = client.from("books").select("*").order("wall").order("shelf").order("slot");
      if (wall) qy = qy.eq("wall", wall);
      if (search) qy = qy.or(`title.ilike.%${search}%,author.ilike.%${search}%`);
      const { data, error } = await qy.limit(limit);
      if (error) throw error;
      return data;
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

    /* ── 기록의 방 ── */
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

    async resolveCandidate(candidateId, book) {
      const { data: inserted, error: e1 } = await client
        .from("books").insert(book).select("id").single();
      if (e1) throw e1;
      const { error: e2 } = await client
        .from("intake_candidates")
        .update({ status: "확정", resolved_book_id: inserted.id })
        .eq("id", candidateId);
      if (e2) throw e2;
      return inserted.id;
    },
  };

  window.PostLibrosDB = db;
})();
