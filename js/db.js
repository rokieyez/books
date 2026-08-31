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
      // 비밀번호 없이 메일 링크로 들어온다
      return client.auth.signInWithOtp({ email });
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
