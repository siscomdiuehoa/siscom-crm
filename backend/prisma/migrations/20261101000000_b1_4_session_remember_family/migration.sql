-- SISCOM CRM B1.4 (20261101000000_b1_4_session_remember_family). CHI CONG THEM: 1 cot null + 1 chi muc rieng phan tren auth_session.
-- Owner duyet 2026-11-01 (Remember Me cau 3): thu hoi MOT thiet bi ghi nho (hoac moi thiet bi) phai thu hoi luon phien THUONG dang mo
--   da duoc KHOI PHUC tu thiet bi do. Phien khoi phuc ghi remember_family_id = family_id cua thiet bi; phien dang nhap bang mat khau = NULL.
-- Tuong thich nguoc: cot NULL, khong default, khong rang buoc moi => backend ban cu van chay (khong ghi/doc cot nay).
-- Quyen: siscom_auth da co INSERT, UPDATE CAP BANG tren auth_session (V3) => tu dong bao gom cot moi; siscom_app khong co quyen nao tren
--   auth_session (V3, P3c) => khong doi. Van nen chay lai V3 + VERIFY/VERIFY_AUTH sau migrate tren DB da tach role (quy trinh chuan).
-- Rollback viet san (KHONG tu chay): backend/docs/B1.4_SESSION_REMEMBER_FAMILY_ROLLBACK.sql.txt.
-- Da thu tren PostgreSQL tam cach ly (CI). CHUA ap len database that nao.

DO $$ BEGIN
  IF to_regclass('public.remember_device') IS NULL THEN
    RAISE EXCEPTION 'Can 20261029000000_b1_4_remember_device da ap truoc.';
  END IF;
END $$;

ALTER TABLE "auth_session" ADD COLUMN "remember_family_id" UUID;

-- Tra phien con song theo thiet bi khi thu hoi (DELETE /auth/remember/devices/:id, revoke-all).
CREATE INDEX "idx_sess_remember_family_active" ON "auth_session" ("remember_family_id")
  WHERE "remember_family_id" IS NOT NULL AND "revoked_at" IS NULL;

COMMENT ON COLUMN "auth_session"."remember_family_id" IS 'B1.4: family_id cua thiet bi ghi nho da khoi phuc phien nay (NULL = dang nhap bang mat khau). Thu hoi thiet bi => thu hoi phien.';
