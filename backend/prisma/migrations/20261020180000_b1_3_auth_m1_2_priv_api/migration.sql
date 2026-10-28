-- SISCOM CRM B1.3 M1.2 (20261020180000_b1_3_auth_m1_2_priv_api). CHI CONG THEM: ham + trigger. KHONG sua/thay the doi tuong nao cua M1/M1.1.
-- Muc dich (S2/S3 cua B1.3.2B_REPORT muc 8): cung cap API ghi dac quyen dang SECURITY DEFINER de sau khi tach role (S1, script rieng
--   B1.3_S1_ROLE_SPLIT.sql.txt + B1.3_S1_APP_GRANTS.sql.txt) siscom_app KHONG con quyen ghi truc tiep employee_role/role_permission/
--   privileged_change_request/password_reset_token/password_hash; moi thao tac dac quyen di qua ham duoi day, ham tu dat GUC danh tinh (SET LOCAL
--   trong pham vi ham, tu khoi phuc khi ra khoi ham) va ghi audit_log.
-- GIOI HAN (khong che): danh tinh p_actor do ung dung khai bao. DB KHONG xac thuc duoc nguoi that; ung dung bi chiem (SQLi trong pool co quyen
--   EXECUTE, RCE, lo JWT secret) van dong vai duoc moi nhan vien. Xem B1.3_S1S3_THREAT_MODEL.md.
-- S3: doi password_hash/password_algo/password_params bat buoc tang token_version cung cau lenh; tang token_version => thu hoi moi phien;
--   ACTIVE->DISABLED bat buoc tang token_version; DISABLED->ACTIVE chi kem mat khau moi (= qua ma reset); credential ACTIVE khong dung algo 'none';
--   sau khi dong khoi tao, credential moi phai la placeholder DISABLED/'none' (kich hoat qua PASSWORD_RESET hai nguoi).
-- Phu thuoc: M1 + M1.1 da ap (khoi DO dau file tu kiem).
-- Ma loi: 42501 = APPROVAL_REQUIRED / BOOTSTRAP_OPEN / BOOTSTRAP_CLOSED; 23514 = TOKEN_VERSION_REQUIRED / REENABLE_REQUIRES_RESET / INVALID_STATE /
--   STALE_TOKEN_VERSION / SELF_MODIFICATION / BOOTSTRAP_INCOMPLETE; 23001 = LAST_ADMIN / LAST_APPROVER. Thong diep bat dau bang ma on dinh.
-- Rollback viet san (KHONG tu chay): backend/docs/B1.3_M1_2_ROLLBACK.sql.txt - chay TRUOC rollback M1.1/M1. Test: backend/docs/B1.3_M1_2_CONSTRAINT_TESTS.sql.txt.
-- Quyen EXECUTE: thu hoi khoi PUBLIC tai day; cap cho role nhom siscom_auth_rt trong B1.3_S1_APP_GRANTS.sql.txt (khong cap trong migration).

DO $$ BEGIN
  IF to_regclass('public.employee_credential') IS NULL OR to_regprocedure('public.fn_auth_consume_request(public.privileged_change_type, uuid, uuid, uuid, text, text)') IS NULL
     OR to_regprocedure('public.fn_pcr_exec_guard()') IS NULL OR to_regprocedure('public.fn_auth_employee_status_guard()') IS NULL THEN
    RAISE EXCEPTION 'M1.2 can M1 (20261020000000_b1_3_auth_core) va M1.1 (20261020120000_b1_3_auth_m1_1_guards) da ap truoc.';
  END IF;
END $$;

-- ===== S3. Bao ve credential o tang DB (moi duong ghi, ke ca chu so huu) =====
CREATE FUNCTION public.fn_cred_secret_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE v_secret boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'ACTIVE' AND NEW.password_algo = 'none' THEN
      RAISE EXCEPTION 'INVALID_STATE: credential ACTIVE khong duoc dung password_algo none (nhan vien %).', NEW.employee_id USING ERRCODE = 'check_violation';
    END IF;
    IF NOT public.fn_auth_bootstrap_open() AND (NEW.status <> 'DISABLED' OR NEW.password_algo <> 'none') THEN
      RAISE EXCEPTION 'APPROVAL_REQUIRED: sau khi dong khoi tao, credential moi phai la placeholder DISABLED/none; kich hoat qua PASSWORD_RESET (nhan vien %).', NEW.employee_id
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  v_secret := NEW.password_hash IS DISTINCT FROM OLD.password_hash OR NEW.password_algo IS DISTINCT FROM OLD.password_algo
              OR NEW.password_params IS DISTINCT FROM OLD.password_params;
  IF v_secret THEN
    IF NEW.token_version <= OLD.token_version THEN
      RAISE EXCEPTION 'TOKEN_VERSION_REQUIRED: doi mat khau nhan vien % phai tang token_version trong cung cau lenh.', OLD.employee_id USING ERRCODE = 'check_violation';
    END IF;
    NEW.password_changed_at := now();
  END IF;
  IF OLD.status = 'DISABLED' AND NEW.status = 'ACTIVE' AND NOT v_secret THEN
    RAISE EXCEPTION 'REENABLE_REQUIRES_RESET: mo lai credential % chi kem mat khau moi (dat lai bang ma reset).', OLD.employee_id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'ACTIVE' AND NEW.status = 'DISABLED' AND NEW.token_version <= OLD.token_version THEN
    RAISE EXCEPTION 'TOKEN_VERSION_REQUIRED: khoa credential % phai tang token_version trong cung cau lenh.', OLD.employee_id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'ACTIVE' AND NEW.password_algo = 'none' THEN
    RAISE EXCEPTION 'INVALID_STATE: credential ACTIVE khong duoc dung password_algo none (nhan vien %).', OLD.employee_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- token_version tang => moi phien refresh con hieu luc cua nhan vien bi thu hoi (dang xuat moi noi). Chay voi quyen nguoi goi.
CREATE FUNCTION public.fn_cred_revoke_sessions() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE public.auth_session SET revoked_at = now(), revoke_reason = 'TOKEN_VERSION'
   WHERE employee_id = NEW.employee_id AND revoked_at IS NULL;
  RETURN NULL;
END $$;

CREATE TRIGGER trg_cred_secret_guard BEFORE INSERT OR UPDATE ON employee_credential FOR EACH ROW EXECUTE FUNCTION public.fn_cred_secret_guard();
CREATE TRIGGER trg_cred_revoke_sessions AFTER UPDATE OF token_version ON employee_credential FOR EACH ROW
  WHEN (NEW.token_version > OLD.token_version) EXECUTE FUNCTION public.fn_cred_revoke_sessions();

-- ===== Ham noi bo (KHONG SECURITY DEFINER; chi goi tu ham API ben duoi; khong cap EXECUTE cho ai) =====
-- Nguoi thao tac do ung dung khai bao: khoi tao da dong; nhan vien ACTIVE, chua xoa mem, co credential ACTIVE; co quyen nhom p_class (neu khac NULL).
-- KHONG dat GUC o day: set_config(..., true) trong ham co menh de SET bi hoan nguyen khi chinh ham do thoat. Ham API tu dat
--   app.actor_employee_id ngay sau khi goi ham nay; menh de SET cua ham API khoi phuc gia tri cu khi ham API thoat.
CREATE FUNCTION public.fn_auth_api_actor(p_actor uuid, p_class text) RETURNS void LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF public.fn_auth_bootstrap_open() THEN
    RAISE EXCEPTION 'BOOTSTRAP_OPEN: API dac quyen chi dung sau khi dong khoi tao (fn_auth_bootstrap_close).' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_actor IS NULL OR NOT EXISTS (SELECT 1 FROM public.employee e JOIN public.employee_credential c ON c.employee_id = e.id
       WHERE e.id = p_actor AND e.status = 'ACTIVE' AND e.deleted_at IS NULL AND c.status = 'ACTIVE') THEN
    RAISE EXCEPTION 'APPROVAL_REQUIRED: nguoi thao tac % khong hoat dong hoac khong co credential ACTIVE.', p_actor USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_class IS NOT NULL AND NOT public.fn_auth_emp_has_class(p_actor, p_class) THEN
    RAISE EXCEPTION 'APPROVAL_REQUIRED: nguoi thao tac % khong co quyen nhom %.', p_actor, p_class USING ERRCODE = 'insufficient_privilege';
  END IF;
END $$;

CREATE FUNCTION public.fn_auth_api_audit(p_actor_type text, p_actor uuid, p_action text, p_entity_type text, p_entity_id uuid, p_summary text, p_changes jsonb)
RETURNS void LANGUAGE sql SET search_path = pg_catalog, public, pg_temp AS $$
  INSERT INTO public.audit_log (actor_type, actor_employee_id, action, entity_type, entity_id, summary, changes)
  VALUES (p_actor_type, p_actor, p_action, p_entity_type, p_entity_id, p_summary, p_changes) $$;

-- Mat khau moi phai co dang dung (DB khong kiem duoc do manh/thuat toan bam that; ung dung chiu trach nhiem).
CREATE FUNCTION public.fn_auth_api_check_secret(p_hash text, p_algo text, p_params jsonb) RETURNS void LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF p_hash IS NULL OR btrim(p_hash) = '' OR p_algo IS NULL OR p_algo = 'none' OR p_params IS NULL OR jsonb_typeof(p_params) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_STATE: mat khau moi (hash/algo/params) khong hop le.' USING ERRCODE = 'check_violation';
  END IF;
END $$;

-- ===== API dac quyen (SECURITY DEFINER, chu so huu = siscom_migrator sau S1). =====
-- Moi ham: search_path co dinh (pg_temp CUOI), moi ten bang dat tien to public., GUC danh tinh dat lai rong khi vao va tu khoi phuc khi ra.
-- Trigger M1/M1.1 van chay day du ben trong (hai nguoi, SoD, LAST_*, TOCTOU, S5) - ham chi la cua duy nhat, khong noi long quy tac nao.

-- Tao yeu cau (nguoi yeu cau co quyen nhom REQUEST). payload_hash do DB tinh. Thoi han 1..1440 phut tinh tu now().
CREATE FUNCTION public.fn_auth_api_request_create(p_actor uuid, p_type public.privileged_change_type, p_subject_employee uuid, p_subject_role uuid,
                                                  p_payload jsonb, p_ttl_minutes integer) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp SET app.actor_employee_id = '' SET app.priv_request_id = '' AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.fn_auth_api_actor(p_actor, 'REQUEST');
  PERFORM set_config('app.actor_employee_id', p_actor::text, true);
  IF p_ttl_minutes IS NULL OR p_ttl_minutes < 1 OR p_ttl_minutes > 1440 THEN
    RAISE EXCEPTION 'INVALID_STATE: thoi han yeu cau phai tu 1 den 1440 phut.' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO public.privileged_change_request (type, subject_employee_id, subject_role_id, payload, payload_hash, requested_by, expires_at)
  VALUES (p_type, p_subject_employee, p_subject_role, p_payload, encode(sha256(convert_to(p_payload::text, 'UTF8')), 'hex'), p_actor,
          now() + make_interval(mins => p_ttl_minutes))
  RETURNING id INTO v_id;
  PERFORM public.fn_auth_api_audit('USER', p_actor, 'PRIV_REQUEST_CREATE', 'privileged_change_request', v_id, p_type::text,
    jsonb_build_object('type', p_type, 'subjectEmployeeId', p_subject_employee, 'subjectRoleId', p_subject_role));
  RETURN v_id;
END $$;

-- Duyet / tu choi (nguoi quyet dinh co quyen nhom APPROVE; trigger M1 kiem hai nguoi, con han, access.approve).
CREATE FUNCTION public.fn_auth_api_request_decide(p_actor uuid, p_request uuid, p_approve boolean) RETURNS public.privileged_change_status
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp SET app.actor_employee_id = '' SET app.priv_request_id = '' AS $$
DECLARE v_status public.privileged_change_status;
BEGIN
  PERFORM public.fn_auth_api_actor(p_actor, 'APPROVE');
  PERFORM set_config('app.actor_employee_id', p_actor::text, true);
  IF p_approve IS NULL THEN
    RAISE EXCEPTION 'INVALID_STATE: p_approve phai la true/false.' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.privileged_change_request
     SET status = (CASE WHEN p_approve THEN 'APPROVED' ELSE 'REJECTED' END)::public.privileged_change_status, approved_by = p_actor
   WHERE id = p_request AND status = 'PENDING'
  RETURNING status INTO v_status;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_STATE: yeu cau % khong ton tai hoac khong o PENDING.', p_request USING ERRCODE = 'check_violation';
  END IF;
  PERFORM public.fn_auth_api_audit('USER', p_actor, CASE WHEN p_approve THEN 'PRIV_REQUEST_APPROVE' ELSE 'PRIV_REQUEST_REJECT' END,
    'privileged_change_request', p_request, NULL, NULL);
  RETURN v_status;
END $$;

-- Chuyen yeu cau qua han sang EXPIRED (khong can nguoi thao tac; trigger M1 chi cho khi da qua han). Tra ve true neu da chuyen.
CREATE FUNCTION public.fn_auth_api_request_expire(p_request uuid) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp SET app.actor_employee_id = '' SET app.priv_request_id = '' AS $$
BEGIN
  UPDATE public.privileged_change_request SET status = 'EXPIRED'
   WHERE id = p_request AND status IN ('PENDING', 'APPROVED') AND clock_timestamp() >= expires_at;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM public.fn_auth_api_audit('SYSTEM', NULL, 'PRIV_REQUEST_EXPIRE', 'privileged_change_request', p_request, NULL, NULL);
  RETURN true;
END $$;

-- Thuc thi ROLE_GRANT da duyet (nguoi thuc thi co quyen nhom REQUEST; trigger M1 tieu thu yeu cau, M1.1 kiem nguoi thuc thi).
CREATE FUNCTION public.fn_auth_api_role_grant(p_actor uuid, p_request uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp SET app.actor_employee_id = '' SET app.priv_request_id = '' AS $$
DECLARE r public.privileged_change_request%ROWTYPE;
BEGIN
  PERFORM public.fn_auth_api_actor(p_actor, 'REQUEST');
  PERFORM set_config('app.actor_employee_id', p_actor::text, true);
  SELECT * INTO r FROM public.privileged_change_request WHERE id = p_request;
  IF NOT FOUND OR r.type <> 'ROLE_GRANT' THEN
    RAISE EXCEPTION 'APPROVAL_REQUIRED: % khong phai yeu cau ROLE_GRANT.', p_request USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM set_config('app.priv_request_id', p_request::text, true);
  INSERT INTO public.employee_role (employee_id, role_id) VALUES (r.subject_employee_id, r.subject_role_id);
  PERFORM public.fn_auth_api_audit('USER', p_actor, 'ROLE_GRANT', 'employee', r.subject_employee_id, NULL,
    jsonb_build_object('roleId', r.subject_role_id, 'requestId', p_request));
END $$;

-- Go vai tro. Vai tro thuong: khong can yeu cau (p_request NULL). Vai tro quan trong (admin/access.approve): trigger M1 doi ROLE_REVOKE_CRITICAL.
-- Neu truyen p_request ma yeu cau KHONG bi tieu thu (vai tro khong quan trong) => loi, hoan tac.
CREATE FUNCTION public.fn_auth_api_role_revoke(p_actor uuid, p_employee uuid, p_role uuid, p_request uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp SET app.actor_employee_id = '' SET app.priv_request_id = '' AS $$
BEGIN
  PERFORM public.fn_auth_api_actor(p_actor, 'REQUEST');
  PERFORM set_config('app.actor_employee_id', p_actor::text, true);
  IF p_request IS NOT NULL THEN PERFORM set_config('app.priv_request_id', p_request::text, true); END IF;
  DELETE FROM public.employee_role WHERE employee_id = p_employee AND role_id = p_role;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_STATE: nhan vien % khong giu vai tro %.', p_employee, p_role USING ERRCODE = 'check_violation';
  END IF;
  IF p_request IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.privileged_change_request q WHERE q.id = p_request AND q.status = 'EXECUTED') THEN
    RAISE EXCEPTION 'INVALID_STATE: yeu cau % khong duoc tieu thu (vai tro khong quan trong?).', p_request USING ERRCODE = 'check_violation';
  END IF;
  PERFORM public.fn_auth_api_audit('USER', p_actor, 'ROLE_REVOKE', 'employee', p_employee, NULL,
    jsonb_build_object('roleId', p_role, 'requestId', p_request));
END $$;

-- Thuc thi ROLE_PERMISSION_CHANGE da duyet theo payload (op ADD | SET_SCOPE | REMOVE). Yeu cau phai duoc tieu thu, neu khong => loi.
CREATE FUNCTION public.fn_auth_api_role_permission_change(p_actor uuid, p_request uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp SET app.actor_employee_id = '' SET app.priv_request_id = '' AS $$
DECLARE r public.privileged_change_request%ROWTYPE; v_perm uuid; v_op text;
BEGIN
  PERFORM public.fn_auth_api_actor(p_actor, 'REQUEST');
  PERFORM set_config('app.actor_employee_id', p_actor::text, true);
  SELECT * INTO r FROM public.privileged_change_request WHERE id = p_request;
  IF NOT FOUND OR r.type <> 'ROLE_PERMISSION_CHANGE' THEN
    RAISE EXCEPTION 'APPROVAL_REQUIRED: % khong phai yeu cau ROLE_PERMISSION_CHANGE.', p_request USING ERRCODE = 'insufficient_privilege';
  END IF;
  v_perm := (r.payload->>'permissionId')::uuid; v_op := r.payload->>'op';
  PERFORM set_config('app.priv_request_id', p_request::text, true);
  IF v_op = 'ADD' THEN
    INSERT INTO public.role_permission (role_id, permission_id, scope) VALUES (r.subject_role_id, v_perm, (r.payload->>'scope')::public.permission_scope);
  ELSIF v_op = 'SET_SCOPE' THEN
    UPDATE public.role_permission SET scope = (r.payload->>'scope')::public.permission_scope WHERE role_id = r.subject_role_id AND permission_id = v_perm;
  ELSE
    DELETE FROM public.role_permission WHERE role_id = r.subject_role_id AND permission_id = v_perm;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.privileged_change_request q WHERE q.id = p_request AND q.status = 'EXECUTED') THEN
    RAISE EXCEPTION 'INVALID_STATE: yeu cau % khong duoc tieu thu (khong co dong role_permission khop / scope khong doi).', p_request USING ERRCODE = 'check_violation';
  END IF;
  PERFORM public.fn_auth_api_audit('USER', p_actor, 'ROLE_PERMISSION_CHANGE', 'role', r.subject_role_id, v_op,
    jsonb_build_object('permissionId', v_perm, 'op', v_op, 'scope', r.payload->>'scope', 'requestId', p_request));
END $$;

-- Phat hanh ma reset theo PASSWORD_RESET da duyet. Ung dung sinh ma ngau nhien, chi gui SHA-256 hex; ma cu con hieu luc bi thu hoi. TTL 1..30 phut.
CREATE FUNCTION public.fn_auth_api_reset_token_issue(p_actor uuid, p_request uuid, p_token_hash text, p_ttl_minutes integer) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp SET app.actor_employee_id = '' SET app.priv_request_id = '' AS $$
DECLARE r public.privileged_change_request%ROWTYPE; v_id uuid;
BEGIN
  PERFORM public.fn_auth_api_actor(p_actor, 'REQUEST');
  PERFORM set_config('app.actor_employee_id', p_actor::text, true);
  SELECT * INTO r FROM public.privileged_change_request WHERE id = p_request;
  IF NOT FOUND OR r.type <> 'PASSWORD_RESET' THEN
    RAISE EXCEPTION 'APPROVAL_REQUIRED: % khong phai yeu cau PASSWORD_RESET.', p_request USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_ttl_minutes IS NULL OR p_ttl_minutes < 1 OR p_ttl_minutes > 30 THEN
    RAISE EXCEPTION 'INVALID_STATE: thoi han ma reset phai tu 1 den 30 phut.' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.password_reset_token SET revoked_at = now()
   WHERE employee_id = r.subject_employee_id AND used_at IS NULL AND revoked_at IS NULL;
  PERFORM set_config('app.priv_request_id', p_request::text, true);
  INSERT INTO public.password_reset_token (employee_id, token_hash, request_id, created_by, expires_at)
  VALUES (r.subject_employee_id, p_token_hash, p_request, p_actor, now() + make_interval(mins => p_ttl_minutes))
  RETURNING id INTO v_id;
  PERFORM public.fn_auth_api_audit('USER', p_actor, 'PASSWORD_RESET_ISSUE', 'employee', r.subject_employee_id, NULL,
    jsonb_build_object('tokenId', v_id, 'requestId', p_request));
  RETURN v_id;
END $$;

-- Dat lai mat khau bang MA RESET GOC (khong phai hash): DB tu bam va so khop => SQLi chi doc duoc token_hash KHONG dung duoc ham nay.
-- Tra ve ma (khong RAISE) de so lan thu sai duoc COMMIT: OK | NO_TOKEN | EXPIRED | LOCKED | INVALID | EMPLOYEE_INACTIVE.
-- Ung dung PHAI COMMIT ca khi khac OK va chi hien thong bao chung cho nguoi dung (khong lo ly do).
CREATE FUNCTION public.fn_auth_api_reset_password(p_employee uuid, p_token text, p_hash text, p_algo text, p_params jsonb) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp SET app.actor_employee_id = '' SET app.priv_request_id = '' AS $$
DECLARE t public.password_reset_token%ROWTYPE;
BEGIN
  PERFORM public.fn_auth_api_check_secret(p_hash, p_algo, p_params);
  SELECT * INTO t FROM public.password_reset_token WHERE employee_id = p_employee AND used_at IS NULL AND revoked_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN 'NO_TOKEN'; END IF;
  IF clock_timestamp() >= t.expires_at THEN
    UPDATE public.password_reset_token SET revoked_at = now() WHERE id = t.id;
    PERFORM public.fn_auth_api_audit('ANONYMOUS', NULL, 'PASSWORD_RESET_EXPIRED', 'employee', p_employee, NULL, jsonb_build_object('tokenId', t.id));
    RETURN 'EXPIRED';
  END IF;
  IF t.attempts >= 5 THEN
    UPDATE public.password_reset_token SET revoked_at = now() WHERE id = t.id;
    RETURN 'LOCKED';
  END IF;
  IF p_token IS NULL OR encode(sha256(convert_to(p_token, 'UTF8')), 'hex') <> t.token_hash THEN
    UPDATE public.password_reset_token SET attempts = attempts + 1, revoked_at = CASE WHEN attempts + 1 >= 5 THEN now() END WHERE id = t.id;
    PERFORM public.fn_auth_api_audit('ANONYMOUS', NULL, 'PASSWORD_RESET_FAILED', 'employee', p_employee, NULL,
      jsonb_build_object('tokenId', t.id, 'attempts', t.attempts + 1));
    RETURN 'INVALID';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.employee e WHERE e.id = p_employee AND e.status = 'ACTIVE' AND e.deleted_at IS NULL) THEN
    RETURN 'EMPLOYEE_INACTIVE';
  END IF;
  UPDATE public.password_reset_token SET used_at = now() WHERE id = t.id;
  UPDATE public.employee_credential
     SET password_hash = p_hash, password_algo = p_algo, password_params = p_params, must_change_password = false, status = 'ACTIVE',
         token_version = token_version + 1, failed_count = 0, window_started_at = NULL, locked_until = NULL, lock_level = 0, updated_at = now()
   WHERE employee_id = p_employee;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_STATE: nhan vien % chua co credential.', p_employee USING ERRCODE = 'check_violation';
  END IF;
  PERFORM public.fn_auth_api_audit('ANONYMOUS', NULL, 'PASSWORD_RESET_DONE', 'employee', p_employee, NULL, jsonb_build_object('tokenId', t.id));
  RETURN 'OK';
END $$;

-- Doi mat khau cua CHINH MINH. Ung dung PHAI xac minh mat khau cu truoc (DB khong kiem duoc argon2). p_expected_token_version = token_version
-- trong access token dang dung (chong ghi chong). Tang token_version => moi phien bi thu hoi; ung dung cap phien moi. Tra ve token_version moi.
CREATE FUNCTION public.fn_auth_api_change_own_password(p_actor uuid, p_expected_token_version integer, p_hash text, p_algo text, p_params jsonb) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp SET app.actor_employee_id = '' SET app.priv_request_id = '' AS $$
DECLARE v_tv integer;
BEGIN
  PERFORM public.fn_auth_api_actor(p_actor, NULL);
  PERFORM set_config('app.actor_employee_id', p_actor::text, true);
  PERFORM public.fn_auth_api_check_secret(p_hash, p_algo, p_params);
  UPDATE public.employee_credential
     SET password_hash = p_hash, password_algo = p_algo, password_params = p_params, must_change_password = false,
         token_version = token_version + 1, updated_at = now()
   WHERE employee_id = p_actor AND status = 'ACTIVE' AND token_version = p_expected_token_version
  RETURNING token_version INTO v_tv;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'STALE_TOKEN_VERSION: token_version cua nhan vien % da doi; dang nhap lai.', p_actor USING ERRCODE = 'check_violation';
  END IF;
  PERFORM public.fn_auth_api_audit('USER', p_actor, 'PASSWORD_CHANGE', 'employee', p_actor, NULL, NULL);
  RETURN v_tv;
END $$;

-- Tao credential placeholder (DISABLED, algo none, khong dang nhap duoc) cho nhan vien moi; kich hoat bang PASSWORD_RESET hai nguoi.
CREATE FUNCTION public.fn_auth_api_credential_create(p_actor uuid, p_employee uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp SET app.actor_employee_id = '' SET app.priv_request_id = '' AS $$
BEGIN
  PERFORM public.fn_auth_api_actor(p_actor, 'REQUEST');
  PERFORM set_config('app.actor_employee_id', p_actor::text, true);
  IF p_employee IS NOT DISTINCT FROM p_actor THEN
    RAISE EXCEPTION 'SELF_MODIFICATION: khong tu tao credential cho chinh minh.' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO public.employee_credential (employee_id, password_hash, password_algo, password_params, must_change_password, status)
  VALUES (p_employee, '!', 'none', '{}'::jsonb, true, 'DISABLED');
  PERFORM public.fn_auth_api_audit('USER', p_actor, 'CREDENTIAL_CREATE', 'employee', p_employee, NULL, NULL);
END $$;

-- Khoa credential (ACTIVE -> DISABLED, tang token_version => thu hoi moi phien). Khong khoa admin / nguoi duyet cuoi cung con dang nhap duoc.
CREATE FUNCTION public.fn_auth_api_credential_disable(p_actor uuid, p_employee uuid, p_reason text) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp SET app.actor_employee_id = '' SET app.priv_request_id = '' AS $$
DECLARE v_tv integer;
BEGIN
  PERFORM public.fn_auth_api_actor(p_actor, 'REQUEST');
  PERFORM set_config('app.actor_employee_id', p_actor::text, true);
  PERFORM pg_advisory_xact_lock(hashtext('siscom.rbac'));
  IF EXISTS (SELECT 1 FROM public.employee_role er JOIN public.role r ON r.id = er.role_id WHERE er.employee_id = p_employee AND r.code = 'admin')
     AND NOT EXISTS (SELECT 1 FROM public.employee_role er JOIN public.role r ON r.id = er.role_id JOIN public.employee e ON e.id = er.employee_id
                     JOIN public.employee_credential c ON c.employee_id = e.id
                     WHERE r.code = 'admin' AND e.status = 'ACTIVE' AND e.deleted_at IS NULL AND c.status = 'ACTIVE' AND e.id <> p_employee) THEN
    RAISE EXCEPTION 'LAST_ADMIN: khong khoa credential cua admin cuoi cung con dang nhap duoc (%).', p_employee USING ERRCODE = 'restrict_violation';
  END IF;
  IF public.fn_auth_emp_has_class(p_employee, 'APPROVE')
     AND NOT EXISTS (SELECT 1 FROM public.employee e JOIN public.employee_credential c ON c.employee_id = e.id
                     WHERE e.id <> p_employee AND c.status = 'ACTIVE' AND public.fn_auth_emp_can_approve(e.id)) THEN
    RAISE EXCEPTION 'LAST_APPROVER: khong khoa credential cua nguoi duyet cuoi cung con dang nhap duoc (%).', p_employee USING ERRCODE = 'restrict_violation';
  END IF;
  UPDATE public.employee_credential SET status = 'DISABLED', token_version = token_version + 1, updated_at = now()
   WHERE employee_id = p_employee AND status = 'ACTIVE'
  RETURNING token_version INTO v_tv;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_STATE: nhan vien % khong co credential ACTIVE.', p_employee USING ERRCODE = 'check_violation';
  END IF;
  PERFORM public.fn_auth_api_audit('USER', p_actor, 'CREDENTIAL_DISABLE', 'employee', p_employee, left(p_reason, 200), NULL);
  RETURN v_tv;
END $$;

-- ===== Dong che do khoi tao (CHI nguoi van hanh, chay bang chu so huu; KHONG cap cho ung dung) =====
-- Cung transaction: khoa siscom.rbac, kiem con >= 1 admin va >= 1 nguoi duyet hieu luc co credential ACTIVE, roi ghi khoa (M1.1 ra soat #4).
CREATE FUNCTION public.fn_auth_bootstrap_close(p_marker text) RETURNS void LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('siscom.rbac'));
  IF NOT public.fn_auth_bootstrap_open() THEN
    RAISE EXCEPTION 'BOOTSTRAP_CLOSED: che do khoi tao da dong.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.employee_role er JOIN public.role r ON r.id = er.role_id JOIN public.employee e ON e.id = er.employee_id
                 JOIN public.employee_credential c ON c.employee_id = e.id
                 WHERE r.code = 'admin' AND e.status = 'ACTIVE' AND e.deleted_at IS NULL AND c.status = 'ACTIVE')
     OR NOT EXISTS (SELECT 1 FROM public.employee e JOIN public.employee_credential c ON c.employee_id = e.id
                    WHERE c.status = 'ACTIVE' AND public.fn_auth_emp_can_approve(e.id)) THEN
    RAISE EXCEPTION 'BOOTSTRAP_INCOMPLETE: can >= 1 admin va >= 1 nguoi duyet (access.approve) hieu luc, co credential ACTIVE.' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO public.app_meta (key, value) VALUES ('auth_bootstrap_done', coalesce(nullif(btrim(p_marker), ''), 'closed'));
END $$;

-- ===== Quyen EXECUTE: khong ai ngoai chu so huu (cap lai co chu dich trong B1.3_S1_APP_GRANTS.sql.txt) =====
REVOKE ALL ON FUNCTION public.fn_auth_api_actor(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_auth_api_audit(text, uuid, text, text, uuid, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_auth_api_check_secret(text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_auth_api_request_create(uuid, public.privileged_change_type, uuid, uuid, jsonb, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_auth_api_request_decide(uuid, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_auth_api_request_expire(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_auth_api_role_grant(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_auth_api_role_revoke(uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_auth_api_role_permission_change(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_auth_api_reset_token_issue(uuid, uuid, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_auth_api_reset_password(uuid, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_auth_api_change_own_password(uuid, integer, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_auth_api_credential_create(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_auth_api_credential_disable(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_auth_bootstrap_close(text) FROM PUBLIC;

COMMENT ON FUNCTION public.fn_cred_secret_guard() IS 'B1.3 M1.2 (S3): doi mat khau/khoa => tang token_version; mo lai chi kem mat khau moi; sau khoi tao chi tao placeholder DISABLED/none.';
COMMENT ON FUNCTION public.fn_cred_revoke_sessions() IS 'B1.3 M1.2 (S3): token_version tang => thu hoi moi phien con hieu luc (revoke_reason TOKEN_VERSION).';
COMMENT ON FUNCTION public.fn_auth_api_reset_password(uuid, text, text, text, jsonb) IS 'B1.3 M1.2 (S3): dat lai mat khau bang ma reset GOC (DB tu bam). Tra ma, khong RAISE, de so lan sai duoc COMMIT.';
COMMENT ON FUNCTION public.fn_auth_bootstrap_close(text) IS 'B1.3 M1.2: dong khoi tao co khoa siscom.rbac va kiem admin/nguoi duyet hieu luc. Chi nguoi van hanh (chu so huu).';
