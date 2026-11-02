B1.5 - tu kiem script kiem HTTPS backend/scripts/windows/demo-lan-tls-verify.mjs (2026-11-02).
Muc dich: chung minh script KHONG dat gia - moi loi co y deu bi bat. Chay tren may lam viec, chi 127.0.0.1, khong Caddy/mkcert/DB/firewall.
CA va chung chi THU tao bang openssl trong thu muc nhap (scratchpad), KHONG commit (co khoa rieng). fake-lan.mjs = may chu gia lap Caddy+backend.
Ket qua (01_tu_kiem_5_kich_ban.txt): dung -> 13/13 PASS, ma 0 | sai CA -> BLOCKED ma 2 | may chu nhan TLS 1.1 -> T5 FAIL ma 1 |
CSRF long -> T9 FAIL ma 1 | cong noi bo mo -> T12 FAIL ma 1 | --ca la file khoa -> tu choi doc, ma 2.
Chua chay voi Caddy + mkcert that (cho owner lam B1.5 buoc 2-3).
