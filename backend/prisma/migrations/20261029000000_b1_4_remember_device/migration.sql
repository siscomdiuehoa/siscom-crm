-- SISCOM CRM B1.4 (20261029000000_b1_4_remember_device). CHI CONG THEM: 1 bang, 2 ham, 2 trigger bang remember_device, 1 trigger tren employee_credential.
-- KHONG sua doi tuong nao cua B1.2/B1.3 (employee_credential chi them trigger AFTER UPDATE OF token_version). Thiet ke: docs/B1.4_REMEMBER_ME_90D_DESIGN.md (Issue #177).
-- Muc dich: "Ghi nho dang nhap tren thiet bi nay" toi da 90 ngay TU LAN NHAP MAT KHAU. Token ghi nho RIENG (cookie siscom_rmb), DB chi luu SHA-256.
--   1 hang / token; family_id = 1 thiet bi (chuoi rotation, moi token dung mot lan). abs_expires_at bat bien, ke thua qua rotate, DB cuong che tran 90 ngay.
-- Thu hoi theo token_version o tang DB: doi mat khau / khoa credential / reset (deu tang token_version) => thu hoi moi thiet bi nho cua nhan vien.
-- Quyen: KHONG GRANT o day (role co the chua ton tai). Ma tran quyen: backend/docs/B1.3_S1_APP_GRANTS_V3.sql.txt (remember_device CHI thuoc
--   siscom_auth: SELECT, INSERT, UPDATE 5 cot trang thai; siscom_app KHONG quyen nao). DB da tach role: SAU migrate deploy PHAI chay lai V3
--   (quyen mac dinh cap SELECT cho siscom_app tren bang moi; VERIFY B1f bat duoc).
-- Phu thuoc: M1.3 da ap. Rollback viet san (KHONG tu chay): backend/docs/B1.4_REMEMBER_ME_ROLLBACK.sql.txt. Kiem tra cau truc: backend/docs/B1.4_REMEMBER_ME_STRUCTURE_TESTS.sql.txt.
-- Da thu tren PostgreSQL 18 tam cach ly + CI (xem PR). CHUA ap len database that nao.

DO $$ BEGIN
  IF to_regprocedure('public.fn_cred_revoke_reset_tokens()') IS NULL THEN
    RAISE EXCEPTION 'B1.4 can M1.3 (20261021000000_b1_3_auth_m1_3_reset_revocation) da ap truoc.';
  END IF;
END $$;

CREATE TABLE "remember_device" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employee_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "token_version" INTEGER NOT NULL,
    "password_auth_at" TIMESTAMPTZ(3) NOT NULL,
    "abs_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    "last_used_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    "rotated_at" TIMESTAMPTZ(3),
    "replaced_by" UUID,
    "revoked_at" TIMESTAMPTZ(3),
    "revoke_reason" VARCHAR(40),
    "ip_prefix" VARCHAR(64),
    "ua_short" VARCHAR(200),

    CONSTRAINT "remember_device_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_rmb_hash_hex" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
    -- Tran 90 ngay tuyet doi do DB cuong che (7776000 giay = 90 ngay; interval theo giay nen khong phu thuoc mui gio/DST).
    CONSTRAINT "ck_rmb_abs_cap" CHECK ("abs_expires_at" <= "password_auth_at" + interval '7776000 seconds'),
    CONSTRAINT "ck_rmb_abs_after_issue" CHECK ("abs_expires_at" > "issued_at"),
    CONSTRAINT "ck_rmb_revoke_reason" CHECK (("revoked_at" IS NULL) = ("revoke_reason" IS NULL)),
    CONSTRAINT "ck_rmb_rotated_pair" CHECK ("replaced_by" IS NULL OR "rotated_at" IS NOT NULL),
    CONSTRAINT "ck_rmb_version_pos" CHECK ("token_version" >= 1)
);

CREATE UNIQUE INDEX "remember_device_token_hash_key" ON "remember_device"("token_hash");
CREATE UNIQUE INDEX "remember_device_replaced_by_key" ON "remember_device"("replaced_by");
CREATE INDEX "remember_device_family_id_idx" ON "remember_device"("family_id");
CREATE INDEX "remember_device_abs_expires_at_idx" ON "remember_device"("abs_expires_at");
-- Thiet bi dang hoat dong cua mot nhan vien (dem gioi han 5 thiet bi, liet ke): token hien hanh cua moi family.
CREATE INDEX "remember_device_active_idx" ON "remember_device"("employee_id") WHERE "revoked_at" IS NULL AND "rotated_at" IS NULL;

ALTER TABLE "remember_device" ADD CONSTRAINT "remember_device_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "remember_device" ADD CONSTRAINT "remember_device_replaced_by_fkey" FOREIGN KEY ("replaced_by") REFERENCES "remember_device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Bat bien (cung mau fn_sess_before_update): dinh danh/han tuyet doi khong sua; hang da thu hoi khong mo lai; rotated_at dat mot lan.
CREATE FUNCTION public.fn_rmb_before_update() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.employee_id <> OLD.employee_id OR NEW.family_id <> OLD.family_id OR NEW.token_hash <> OLD.token_hash
     OR NEW.token_version <> OLD.token_version OR NEW.password_auth_at <> OLD.password_auth_at OR NEW.abs_expires_at <> OLD.abs_expires_at
     OR NEW.issued_at <> OLD.issued_at THEN
    RAISE EXCEPTION 'IMMUTABLE: khong sua dinh danh/han tuyet doi cua remember_device %.', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.rotated_at IS NOT NULL AND NEW.rotated_at IS DISTINCT FROM OLD.rotated_at THEN
    RAISE EXCEPTION 'IMMUTABLE: rotated_at cua remember_device % da dat.', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.replaced_by IS NOT NULL AND NEW.replaced_by IS NOT NULL AND NEW.replaced_by <> OLD.replaced_by THEN
    RAISE EXCEPTION 'IMMUTABLE: replaced_by cua remember_device % da dat.', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.revoked_at IS NOT NULL AND (NEW.revoked_at IS DISTINCT FROM OLD.revoked_at OR NEW.revoke_reason IS DISTINCT FROM OLD.revoke_reason
       OR NEW.last_used_at IS DISTINCT FROM OLD.last_used_at) THEN
    RAISE EXCEPTION 'IMMUTABLE: remember_device % da thu hoi, khong mo lai.', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_rmb_before_update BEFORE UPDATE ON remember_device FOR EACH ROW EXECUTE FUNCTION public.fn_rmb_before_update();

-- token_version tang (doi mat khau / khoa credential / reset) => thu hoi moi thiet bi nho con hieu luc cua nhan vien.
-- SECURITY DEFINER: nguoi ghi token_version co the khong co quyen UPDATE tren remember_device (cung ly do M1.3).
CREATE FUNCTION public.fn_cred_revoke_remember() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  UPDATE public.remember_device SET revoked_at = now(), revoke_reason = 'TOKEN_VERSION'
   WHERE employee_id = NEW.employee_id AND revoked_at IS NULL;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.fn_cred_revoke_remember() FROM PUBLIC;

CREATE TRIGGER trg_cred_revoke_remember AFTER UPDATE OF token_version ON employee_credential FOR EACH ROW
  WHEN (NEW.token_version > OLD.token_version) EXECUTE FUNCTION public.fn_cred_revoke_remember();

COMMENT ON TABLE public.remember_device IS 'B1.4: thiet bi nho dang nhap (toi da 90 ngay tu lan nhap mat khau). 1 hang/token; family_id = thiet bi; token_hash = SHA-256 hex, khong luu chuoi goc.';
COMMENT ON FUNCTION public.fn_cred_revoke_remember() IS 'B1.4: token_version tang (doi mat khau/khoa) => thu hoi moi remember_device cua nhan vien.';
