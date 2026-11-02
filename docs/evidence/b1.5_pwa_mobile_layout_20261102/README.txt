B1.5 buoc 4 - bang chung do bo cuc dien thoai va PWA (2026-11-02). Ma: nhanh feat/b1.5-pwa-mobile-layout (tu main db43479).
Cong cu: Chrome (khung trinh duyet tich hop Claude Desktop, gia lap viewport; < 768 px gia lap Chrome Android UA "Pixel 8").
Giao dien da dang nhap dung API GIA cuc bo (127.0.0.1:4691, khong DB, khong bi mat; tra /auth/me, /customers rong, /lookups) - chi de ve bo cuc.
KHONG do duoc tren Safari iOS that / iPhone that va Android that: can owner thu theo docs/B1.5_OWNER_ACCEPTANCE_CHECKLIST.md.
Chi so: sw = document.documentElement.scrollWidth (> be rong = tran ngang). "chuong trong" = .sg-bell.right <= .sg-topbar.right - 1.

1) Man hinh dang nhap (chua dang nhap)
| Be rong | TRUOC (main) | SAU (nhanh) |
| 390 | sw=396 (form 16..396, lech 6 px) - LOI | sw=390, form 16..374 (358 px) |
| 320 | (chua do truoc) | lan sua 1: sw=381 (luoi trong form 340 px) -> lan sua 2: sw=320, 0 phan tu tran |
| 360 / 412 / 430 / 768 | - | sw = be rong, 0 phan tu tran |
| 1366 | form 380 px giua man hinh | form 380 px giua man hinh (khong doi) |

2) Thanh tren cung (da dang nhap, #/customers)
| Be rong | TRUOC (main) | SAU (nhanh) |
| 390 | topbar scrollWidth 439 > clientWidth 356; chuong r=410, avatar r=456 nam ngoai thanh (r=374); tieu de rong 0 - LOI | chuong 319..359 nam trong; tieu de "Quan ly khach hang" 104 px; nut Doi mat khau / Dang xuat chi con bieu tuong 35 px (aria-label + title giu ten); avatar an |
| 320 | - | chuong trong; tieu de 34 px (chat nhung khong vo); sw=320 |
| 360 | - | chuong trong; tieu de 74 px; sw=360 |
| 430 | - | chuong trong; tieu de 144 px; sw=430 |
| 768 | - | chuong trong; tieu de 376 px; nhan chu an (<=768), avatar hien |
| 1366 | nhan "Doi mat khau", "Dang xuat" hien | khong doi: nhan hien day du, avatar hien, sw=1366 |
Ghi chu: phan "tran" 7 px con lai trong .sg-topbar la bong bong tooltip cua chuong (opacity 0, absolute) co tu truoc, khong gay cuon ngang trang.

3) PWA tren ban build (vite preview cua dist/, UA Android)
manifest.webmanifest: 200 application/manifest+json; start_url/scope = goc ung dung; icons/icon-192.png 192x192, icon-512.png 512x512, icon-maskable-512.png 512x512 (image/png, 200); apple-touch-icon.png 200 image/png 180x180.
Khong co service worker (co y: khong cache /api tren thiet bi).

4) Test tu dong: tests/mobilePwa.test.mjs 4 ca - RED tren ma goc 3/4 FAIL (ca manifest dat vi thu muc public/ moi), GREEN 4/4. Toan bo test FE: 511/511.
