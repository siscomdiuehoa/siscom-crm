-- SISCOM CRM P1 (20261124000000_p1_account_admin) - man hinh quan ly tai khoan. CHI CONG THEM: 4 ham SECURITY DEFINER.
--   Khong bang moi, khong cot moi, khong CHECK / trigger moi, khong sua ham fn_auth_* hien co, khong ma quyen moi, khong dung role_permission.
-- Thiet ke: docs/P1_ACCOUNT_ADMIN_DESIGN.md (Owner duyet 23/11/2026: mot nguoi thao tac = Quan tri CRM, nhom APPROVE).
-- Bon ham nay la phan database CHUA co cho P1 (cac buoc con lai dung san fn_auth_api_* cua M1.2):
--   fn_auth_api_employee_create  - tao ban ghi nhan vien (truoc day chi chu so huu INSERT duoc)
--   fn_auth_api_employee_update  - sua ho ten / email / phong ban / chuc danh, khoa lac quan theo updated_at
--   fn_auth_api_must_change_set  - bat "buoc doi mat khau" sau khi dat mat khau tam (thay cau UPDATE truc tiep cua FV-5)
--   fn_auth_api_account_audit    - ghi mot dong nhat ky mang ten NGUOI BAM cho thao tac P1 (cac ham M1.2 ghi duoi ten tai khoan he thong)
-- Ca bon: nguoi goi phai hoat dong, co credential ACTIVE va thuoc nhom APPROVE (fn_auth_api_actor) - tuc Quan tri CRM.
-- Ma loi = TIEN TO thong bao (ung dung doc tien to, nhu LAST_ADMIN / SELF_MODIFICATION cua M1):
--   EMAIL_TAKEN (23505) | VERSION_CONFLICT (40001) | SYSTEM_ACCOUNT, SELF_MODIFICATION, INVALID_STATE (23514) | APPROVAL_REQUIRED, BOOTSTRAP_OPEN (42501)
-- Quyen: REVOKE ALL FROM PUBLIC o cuoi tep; role duoc goi cap o backend/docs/B1.3_S1_APP_GRANTS_V6.sql.txt (siscom_acct).
-- Rollback viet san (KHONG tu chay): backend/docs/P1_ACCOUNT_ADMIN_ROLLBACK.sql.txt. Bai kiem: backend/docs/P1_ACCOUNT_ADMIN_TESTS.sql.txt.

-- Chuan hoa + kiem ho ten / email / phong ban dung chung cho create va update. Tra ve gia tri da cat khoang trang.
CREATE FUNCTION public.fn_auth_api_employee_fields(p_full_name text, p_email text, p_department uuid, p_position text, p_exclude uuid,
                                                   OUT o_full_name text, OUT o_email text, OUT o_position text)
  LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  o_full_name := btrim(coalesce(p_full_name, ''));
  o_email := btrim(coalesce(p_email, ''));
  o_position := nullif(btrim(coalesce(p_position, '')), '');
  IF o_full_name = '' OR length(o_full_name) > 200 THEN
    RAISE EXCEPTION 'INVALID_STATE: ho ten phai co tu 1 den 200 ky tu.' USING ERRCODE = 'check_violation';
  END IF;
  IF o_email = '' OR length(o_email) > 254 OR o_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'INVALID_STATE: email khong hop le.' USING ERRCODE = 'check_violation';
  END IF;
  IF o_position IS NOT NULL AND length(o_position) > 120 THEN
    RAISE EXCEPTION 'INVALID_STATE: chuc danh toi da 120 ky tu.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_department IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.department d WHERE d.id = p_department AND d.is_active) THEN
    RAISE EXCEPTION 'INVALID_STATE: phong ban khong ton tai hoac da dong.' USING ERRCODE = 'check_violation';
  END IF;
  -- Cung dieu kien voi chi muc uq_employee_email_active (nhan vien chua xoa, khong phan biet hoa thuong).
  IF EXISTS (SELECT 1 FROM public.employee e WHERE lower(e.email) = lower(o_email) AND e.deleted_at IS NULL AND e.id IS DISTINCT FROM p_exclude) THEN
    RAISE EXCEPTION 'EMAIL_TAKEN: email da duoc mot nhan vien khac dung.' USING ERRCODE = 'unique_violation';
  END IF;
END $$;

CREATE FUNCTION public.fn_auth_api_employee_create(p_actor uuid, p_full_name text, p_email text, p_department uuid, p_position text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp SET app.actor_employee_id = '' SET app.priv_request_id = '' AS $$
DECLARE f record; v_id uuid;
BEGIN
  PERFORM public.fn_auth_api_actor(p_actor, 'APPROVE');
  PERFORM set_config('app.actor_employee_id', p_actor::text, true);
  SELECT * INTO f FROM public.fn_auth_api_employee_fields(p_full_name, p_email, p_department, p_position, NULL);
  BEGIN
    INSERT INTO public.employee (full_name, email, department_id, position_title, status)
    VALUES (f.o_full_name, f.o_email, p_department, f.o_position, 'ACTIVE')
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    -- Hai nguoi cung tao mot email: lan kiem o tren da qua, chi muc duy nhat bat lai.
    RAISE EXCEPTION 'EMAIL_TAKEN: email da duoc mot nhan vien khac dung.' USING ERRCODE = 'unique_violation';
  END;
  PERFORM public.fn_auth_api_audit('USER', p_actor, 'EMPLOYEE_CREATE', 'employee', v_id, 'P1 account-admin',
    jsonb_build_object('departmentId', p_department, 'hasPosition', f.o_position IS NOT NULL));
  RETURN v_id;
END $$;

CREATE FUNCTION public.fn_auth_api_employee_update(p_actor uuid, p_employee uuid, p_expected_updated_at timestamptz, p_full_name text, p_email text,
                                                   p_department uuid, p_position text) RETURNS timestamptz
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp SET app.actor_employee_id = '' SET app.priv_request_id = '' AS $$
DECLARE e public.employee%ROWTYPE; f record; v_changes jsonb := '{}'::jsonb; v_new timestamptz;
BEGIN
  PERFORM public.fn_auth_api_actor(p_actor, 'APPROVE');
  PERFORM set_config('app.actor_employee_id', p_actor::text, true);
  SELECT * INTO e FROM public.employee WHERE id = p_employee AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_STATE: nhan vien khong ton tai hoac da xoa.' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM public.employee_role er JOIN public.role r ON r.id = er.role_id WHERE er.employee_id = p_employee AND r.code = 'admin') THEN
    RAISE EXCEPTION 'SYSTEM_ACCOUNT: khong sua tai khoan he thong qua man hinh quan ly tai khoan.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_expected_updated_at IS NULL OR e.updated_at <> p_expected_updated_at THEN
    RAISE EXCEPTION 'VERSION_CONFLICT: thong tin nhan vien vua duoc nguoi khac sua.' USING ERRCODE = 'serialization_failure';
  END IF;
  SELECT * INTO f FROM public.fn_auth_api_employee_fields(p_full_name, p_email, p_department, p_position, p_employee);
  IF e.full_name IS DISTINCT FROM f.o_full_name THEN v_changes := v_changes || jsonb_build_object('full_name', jsonb_build_object('old', e.full_name, 'new', f.o_full_name)); END IF;
  IF e.email IS DISTINCT FROM f.o_email THEN v_changes := v_changes || jsonb_build_object('email', jsonb_build_object('old', e.email, 'new', f.o_email)); END IF;
  IF e.department_id IS DISTINCT FROM p_department THEN v_changes := v_changes || jsonb_build_object('department_id', jsonb_build_object('old', e.department_id, 'new', p_department)); END IF;
  IF e.position_title IS DISTINCT FROM f.o_position THEN v_changes := v_changes || jsonb_build_object('position_title', jsonb_build_object('old', e.position_title, 'new', f.o_position)); END IF;
  IF v_changes = '{}'::jsonb THEN RETURN e.updated_at; END IF;
  -- Moc moi PHAI lon hon moc cu ke ca khi hai lan luu roi vao cung mot mili giay / cung mot transaction (updated_at la timestamptz(3)).
  v_new := greatest(date_trunc('milliseconds', clock_timestamp()), e.updated_at + interval '1 millisecond');
  BEGIN
    UPDATE public.employee SET full_name = f.o_full_name, email = f.o_email, department_id = p_department, position_title = f.o_position, updated_at = v_new
     WHERE id = p_employee;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'EMAIL_TAKEN: email da duoc mot nhan vien khac dung.' USING ERRCODE = 'unique_violation';
  END;
  PERFORM public.fn_auth_api_audit('USER', p_actor, 'EMPLOYEE_UPDATE', 'employee', p_employee, 'P1 account-admin', v_changes);
  RETURN v_new;
END $$;

CREATE FUNCTION public.fn_auth_api_must_change_set(p_actor uuid, p_employee uuid, p_expected_token_version integer) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp SET app.actor_employee_id = '' SET app.priv_request_id = '' AS $$
DECLARE n integer;
BEGIN
  PERFORM public.fn_auth_api_actor(p_actor, 'APPROVE');
  PERFORM set_config('app.actor_employee_id', p_actor::text, true);
  IF p_employee IS NOT DISTINCT FROM p_actor THEN
    RAISE EXCEPTION 'SELF_MODIFICATION: khong tu dat co buoc doi mat khau cho chinh minh.' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.employee_credential SET must_change_password = true, updated_at = now()
   WHERE employee_id = p_employee AND status = 'ACTIVE' AND token_version = p_expected_token_version AND must_change_password = false;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'INVALID_STATE: khong bat duoc yeu cau doi mat khau (credential khong ACTIVE, sai token_version, hoac co da bat).' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM public.fn_auth_api_audit('USER', p_actor, 'PASSWORD_MUST_CHANGE_SET', 'employee', p_employee, 'P1 account-admin', NULL);
END $$;

CREATE FUNCTION public.fn_auth_api_account_audit(p_actor uuid, p_action text, p_employee uuid, p_changes jsonb) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp SET app.actor_employee_id = '' SET app.priv_request_id = '' AS $$
BEGIN
  PERFORM public.fn_auth_api_actor(p_actor, 'APPROVE');
  PERFORM set_config('app.actor_employee_id', p_actor::text, true);
  IF p_action IS NULL OR p_action NOT IN ('ACCOUNT_CREATE', 'ACCOUNT_ROLE_CHANGE', 'ACCOUNT_PASSWORD_RESET', 'ACCOUNT_DISABLE', 'ACCOUNT_ENABLE') THEN
    RAISE EXCEPTION 'INVALID_STATE: hanh dong nhat ky tai khoan khong hop le.' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.employee WHERE id = p_employee) THEN
    RAISE EXCEPTION 'INVALID_STATE: nhan vien khong ton tai.' USING ERRCODE = 'check_violation';
  END IF;
  -- Khong bao gio de mat khau / hash / ma dat lai lot vao nhat ky: tu choi moi khoa (ke ca long nhau) co ten goi y bi mat.
  IF p_changes IS NOT NULL AND EXISTS (
       SELECT 1 FROM jsonb_path_query(p_changes, '$.** ? (@.type() == "object").keyvalue()') kv WHERE kv->>'key' ~* 'password|hash|token|secret') THEN
    RAISE EXCEPTION 'INVALID_STATE: noi dung nhat ky khong duoc chua mat khau, hash hay ma dat lai.' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM public.fn_auth_api_audit('USER', p_actor, p_action, 'employee', p_employee, 'P1 account-admin', p_changes);
END $$;

-- Khong ai duoc goi mac dinh; ham noi bo employee_fields chi duoc goi tu ben trong hai ham SECURITY DEFINER o tren (chay bang chu so huu).
REVOKE ALL ON FUNCTION public.fn_auth_api_employee_fields(text, text, uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_auth_api_employee_create(uuid, text, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_auth_api_employee_update(uuid, uuid, timestamptz, text, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_auth_api_must_change_set(uuid, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_auth_api_account_audit(uuid, text, uuid, jsonb) FROM PUBLIC;

COMMENT ON FUNCTION public.fn_auth_api_employee_fields(text, text, uuid, text, uuid) IS 'P1: (noi bo) chuan hoa + kiem ho ten / email / phong ban / chuc danh; EMAIL_TAKEN khi trung nhan vien chua xoa.';
COMMENT ON FUNCTION public.fn_auth_api_employee_create(uuid, text, text, uuid, text) IS 'P1: tao nhan vien ACTIVE (nguoi goi nhom APPROVE). Khong tao credential, khong cap vai tro.';
COMMENT ON FUNCTION public.fn_auth_api_employee_update(uuid, uuid, timestamptz, text, text, uuid, text) IS 'P1: sua ho ten / email / phong ban / chuc danh theo khoa lac quan updated_at; tu choi tai khoan he thong (vai tro admin).';
COMMENT ON FUNCTION public.fn_auth_api_must_change_set(uuid, uuid, integer) IS 'P1: bat must_change_password cho credential ACTIVE dung token_version vua dat lai; khong tu dat cho chinh minh.';
COMMENT ON FUNCTION public.fn_auth_api_account_audit(uuid, text, uuid, jsonb) IS 'P1: ghi nhat ky ACCOUNT_* mang ten nguoi bam; tu choi noi dung co khoa goi y bi mat.';
