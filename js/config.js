/* Supabase 접속 정보
 *
 * 이 키(publishable)는 브라우저에 실려 나가도록 설계된 공개 키다 — 비밀이 아니다.
 * 안전한 이유는 키가 숨겨져서가 아니라 모든 표에 RLS 가 걸려 있어서다.
 * 따라서 RLS 를 끄거나 정책을 느슨하게 바꾸는 순간 이 키는 위험해진다.
 * service_role 키는 절대 이 파일에 두지 말 것 (Edge Function 안에서만 쓴다).
 */
window.POST_LIBROS_CONFIG = {
  supabaseUrl: "https://gaeumegwhxxnfvrhbknp.supabase.co",
  supabaseKey: "sb_publishable_NI4gjQ3YePIO90H7YjHjfA_m_H0udRy",
};
