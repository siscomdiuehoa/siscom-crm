-- SISCOM CRM Sales S8b (20261119000000_sales_activity_auto_kind). CHI CONG THEM, tuong thich nguoc: 1 cot NULL tren activity + 1 CHECK + 1 chi muc
--   unique rieng phan. Thiet ke: docs/SALES_DESIGN.md §6.13 ("Khong trung", "Nhan dien") va §5.5(e).
-- Muc dich: danh dau CONG VIEC TU SINH cua co hoi - HOLD_REMINDER (viec nhac khi Tam hoan) va WIN_HANDOVER (viec "Ban giao thuc hien" khi Thang) -
--   de (a) nhan dien dung viec can cap nhat / dong ma KHONG dua vao tieu de, KHONG dong moi viec cua co hoi; (b) chot o DB: moi co hoi toi da
--   MOT viec nhac va MOT viec ban giao dang mo, ke ca khi hai yeu cau chay dong thoi.
-- Du lieu cu: KHONG UPDATE. Moi activity hien co nhan opportunity_auto_kind NULL (viec thuong) - CHECK va chi muc khong ap cho dong NULL.
-- Quyen: KHONG GRANT/REVOKE. siscom_app da co INSERT/UPDATE muc BANG tren activity (APP_GRANTS_V5 muc 2b) => cot moi ghi duoc, khong can V6.
-- Dieu kien chi muc = dung dieu kien truy van "viec tu sinh cua lan hien tai" trong service (status = 'OPEN' AND deleted_at IS NULL) de truy van va
--   rang buoc khong lech nhau (ghi chu review PR #234 R2). Them "opportunity_auto_kind IS NOT NULL": tuong duong ve rang buoc (NULL khong trung nhau)
--   va chi muc chi chua viec tu sinh.
-- Rollback viet san (KHONG tu chay; tu choi khi con viec tu sinh, ke ca da xoa mem): backend/docs/SALES_S8_AUTO_KIND_ROLLBACK.sql.txt.
-- Da thu tren PostgreSQL tam cach ly. CHUA ap len database that nao.
ALTER TABLE "activity" ADD COLUMN "opportunity_auto_kind" VARCHAR(20);

ALTER TABLE "activity" ADD CONSTRAINT ck_activity_opp_auto_kind
  CHECK (opportunity_auto_kind IS NULL OR (opportunity_auto_kind IN ('HOLD_REMINDER', 'WIN_HANDOVER') AND type = 'TASK' AND opportunity_id IS NOT NULL));

CREATE UNIQUE INDEX uq_activity_opp_auto_open ON "activity" (opportunity_id, opportunity_auto_kind)
  WHERE opportunity_auto_kind IS NOT NULL AND status = 'OPEN' AND deleted_at IS NULL;

COMMENT ON COLUMN activity.opportunity_auto_kind IS 'Sales S8b: viec tu sinh cua co hoi - HOLD_REMINDER | WIN_HANDOVER; NULL = viec thuong. Chi TASK gan co hoi (ck_activity_opp_auto_kind); moi co hoi toi da 1 viec dang mo moi loai (uq_activity_opp_auto_open).';
