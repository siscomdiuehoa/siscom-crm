-- SISCOM CRM B1.3 M1.3 (20261021000000_b1_3_auth_m1_3_reset_revocation). CHI CONG THEM: 1 ham + 1 trigger. KHONG sua doi tuong nao cua M1/M1.1/M1.2.
-- Ly do (ra soat S1-S3, muc do MEDIUM): ma reset mat khau CHUA DUNG van con hieu luc sau khi nhan vien doi mat khau hoac bi khoa credential
--   (token_version tang). Ke tan cong giu ma cu (lo qua email/IM) van dat lai duoc mat khau => duy tri chiem quyen sau khi nguoi dung da doi mat khau.
-- Sua: token_version tang => thu hoi moi ma reset chua dung/chua thu hoi cua nhan vien do (cung transaction, moi duong ghi, ke ca chu so huu).
-- Luong hop le khong bi anh huong: fn_auth_api_reset_password danh dau ma da dung (used_at) TRUOC khi tang token_version nen ma do khong bi thu hoi lan nua;
--   ma moi phat hanh SAU khi khoa/doi mat khau khong bi anh huong (trigger chi chay luc token_version tang).
-- Ham SECURITY DEFINER vi nguoi ghi token_version co the la siscom_app (duoc UPDATE token_version) nhung KHONG co quyen tren password_reset_token.
-- Phu thuoc: M1.2 da ap. Rollback viet san (KHONG tu chay): backend/docs/B1.3_M1_3_ROLLBACK.sql.txt. Kiem tra cau truc: backend/docs/B1.3_M1_3_STRUCTURE_TESTS.sql.txt.
-- CHUA CHAY tren PostgreSQL.

DO $$ BEGIN
  IF to_regprocedure('public.fn_cred_revoke_sessions()') IS NULL OR to_regprocedure('public.fn_auth_api_reset_password(uuid, text, text, text, jsonb)') IS NULL THEN
    RAISE EXCEPTION 'M1.3 can M1.2 (20261020180000_b1_3_auth_m1_2_priv_api) da ap truoc.';
  END IF;
END $$;

CREATE FUNCTION public.fn_cred_revoke_reset_tokens() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  UPDATE public.password_reset_token SET revoked_at = now()
   WHERE employee_id = NEW.employee_id AND used_at IS NULL AND revoked_at IS NULL;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.fn_cred_revoke_reset_tokens() FROM PUBLIC;

CREATE TRIGGER trg_cred_revoke_reset_tokens AFTER UPDATE OF token_version ON employee_credential FOR EACH ROW
  WHEN (NEW.token_version > OLD.token_version) EXECUTE FUNCTION public.fn_cred_revoke_reset_tokens();

COMMENT ON FUNCTION public.fn_cred_revoke_reset_tokens() IS 'B1.3 M1.3: token_version tang (doi mat khau/khoa) => thu hoi ma reset chua dung cua nhan vien.';
