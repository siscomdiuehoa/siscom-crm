-- OWNER DECISION 04/11/2026 - CUSTOMER PHONE OPTIONAL: so dien thoai khach hang KHONG con bat buoc.
-- Chi CONG THEM / NOI LONG: khong UPDATE du lieu, khong tao so gia hay gia tri mac dinh.
--  1) phone cho phep NULL (khach chua co so).
--  2) ck_customer_phone: van CAM chuoi rong / chi khoang trang (NULL = "chua co so", khong luu '' hay '   ').
--  3) ck_customer_phone_e164: khong co phone thi phone_e164 phai NULL (khong co dang chuan hoa "mo coi").
-- Du lieu cu: moi dong deu co phone khong rong (NOT NULL + CHECK cu) => thoa ngay ca hai CHECK moi.
-- Rollback: backend/docs/CUSTOMER_PHONE_OPTIONAL_ROLLBACK.sql.txt (tu choi neu da co khach khong co so).

ALTER TABLE "customer" ALTER COLUMN "phone" DROP NOT NULL;

ALTER TABLE customer DROP CONSTRAINT ck_customer_phone;
ALTER TABLE customer ADD CONSTRAINT ck_customer_phone CHECK (phone IS NULL OR btrim(phone) <> '');
ALTER TABLE customer ADD CONSTRAINT ck_customer_phone_e164 CHECK (phone IS NOT NULL OR phone_e164 IS NULL);

COMMENT ON COLUMN customer.phone IS 'So dien thoai cong ty; NULL = chua co so (khong bat buoc tu 04/11/2026). Khong luu chuoi rong.';
