B1.5 - tu kiem script kiem HTTPS backend/scripts/windows/demo-lan-tls-verify.mjs (2026-11-02).
Muc dich: chung minh script KHONG dat gia - moi loi co y deu bi bat. Chay tren may lam viec, chi 127.0.0.1, khong Caddy/mkcert/DB/firewall.
CA va chung chi THU tao bang openssl trong thu muc nhap (scratchpad), KHONG commit (co khoa rieng). fake-lan.mjs = may chu gia lap Caddy+backend.
Ket qua (01_tu_kiem_5_kich_ban.txt): dung -> 13/13 PASS, ma 0 | sai CA -> BLOCKED ma 2 | may chu nhan TLS 1.1 -> T5 FAIL ma 1 |
CSRF long -> T9 FAIL ma 1 | cong noi bo mo -> T12 FAIL ma 1 | --ca la file khoa -> tu choi doc, ma 2.
QA Codex PR #199 (2 Important) - 02_qa_codex_t4_t5_truoc_sau.txt (01_ la ket qua cua ban script truoc khi sua):
  TRUOC (48bc8dc): may chu nhan TLS 1.0 + tat rieng 1.1 -> T5 PASS GIA, ma 0 | CA da tin + ket noi doi chung bi reset -> T4 PASS GIA (ECONNRESET), ma 0.
  SAU: 2 truong hop tren -> T5 FAIL / T4 FAIL, ma 1 | reset keo dai -> T4 FAIL "khong ket luan duoc" | CA da tin -> T4 FAIL | TLS 1.0 -> T5 FAIL | dung -> 13/13, ma 0.
Chua chay voi Caddy + mkcert that (cho owner lam B1.5 buoc 2-3).
