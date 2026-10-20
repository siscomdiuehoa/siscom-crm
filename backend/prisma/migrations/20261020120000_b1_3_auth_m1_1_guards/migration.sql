-- SISCOM CRM B1.3 M1.1 (20261020120000_b1_3_auth_m1_1_guards). CHI CONG THEM: 2 ham + 2 trigger. KHONG sua/thay the doi tuong nao cua M1.
-- Ly do tach khoi M1: M1 (20261020000000_b1_3_auth_core) da ap tren ban sao thu => giu nguyen checksum va bang chung; sua S4/S5 bang migration moi.
-- Phu thuoc M1: privileged_change_request, fn_auth_bootstrap_open(), fn_auth_perm_class(text), fn_auth_setting_uuid(text), khoa advisory 'siscom.rbac'.
-- S4: doi employee.status/deleted_at khong vuot LAST_ADMIN/LAST_APPROVER (ke ca song song, nhieu dong 1 cau lenh); chan kich hoat lai nguoi dang giu vai tro
--     admin/access.approve. Che do khoi tao (chua co app_meta.auth_bootstrap_done) giu nguyen: khong kiem, nhu trigger employee_role cua M1.
-- S5: chuyen privileged_change_request APPROVED -> EXECUTED chi qua fn_auth_consume_request goi tu trigger bao ve (employee_role/role_permission/
--     password_reset_token); executed_by = app.actor_employee_id, nguoi thuc thi ACTIVE + chua xoa mem, app.priv_request_id = id yeu cau.
-- Ma loi: 23001 = LAST_ADMIN / LAST_APPROVER; 42501 = APPROVAL_REQUIRED (kich hoat lai / thuc thi sai duong). Thong diep bat dau bang ma on dinh.
-- Rollback viet san (KHONG tu chay): backend/docs/B1.3_M1_1_ROLLBACK.sql.txt - phai chay TRUOC rollback M1. Test: backend/docs/B1.3_M1_1_CONSTRAINT_TESTS.sql.txt.
-- Gioi han con lai: S1-S3 (chu so huu bang / GUC danh tinh do siscom_app tu dat / ghi password_hash truc tiep) - xem B1.3.2B_REPORT.md muc 8.

DO $$ BEGIN
  IF to_regclass('public.privileged_change_request') IS NULL OR to_regprocedure('public.fn_auth_bootstrap_open()') IS NULL
     OR to_regprocedure('public.fn_auth_perm_class(text)') IS NULL OR to_regprocedure('public.fn_auth_setting_uuid(text)') IS NULL THEN
    RAISE EXCEPTION 'M1.1 can M1 (20261020000000_b1_3_auth_core) da ap truoc.';
  END IF;
END $$;

-- S4. "Hieu luc" = status ACTIVE va chua xoa mem (cung dinh nghia voi fn_auth_emp_can_approve va LAST_* cua M1).
-- Roi hieu luc: LAST_ADMIN/LAST_APPROVER. Vao hieu luc (kich hoat lai/khoi phuc xoa mem): tu choi neu dang giu vai tro admin hoac co access.approve
--   (quy trinh: go vai tro quan trong qua ROLE_REVOKE_CRITICAL -> kich hoat lai -> cap lai qua ROLE_GRANT, deu hai nguoi).
-- Khoa advisory truoc moi truy van: tuan tu hoa voi employee_role/role_permission (M1) va giua cac lan doi trang thai (READ COMMITTED).
-- Ham VOLATILE: moi truy van sau khi lay khoa dung snapshot moi => thay thay doi da commit cua giao dich vua nha khoa, va cac dong da xu ly truoc
--   trong cung cau lenh (UPDATE nhieu dong).
CREATE FUNCTION public.fn_auth_employee_status_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE v_was boolean; v_now boolean; v_admin boolean; v_approve boolean;
BEGIN
  v_was := OLD.status = 'ACTIVE' AND OLD.deleted_at IS NULL;
  v_now := NEW.status = 'ACTIVE' AND NEW.deleted_at IS NULL;
  IF v_was = v_now THEN RETURN NEW; END IF;
  -- REPEATABLE READ giu snapshot cu sau khi cho khoa => hai phien cung vuot LAST_* ma khong loi tuan tu hoa. SERIALIZABLE an toan (SSI).
  IF current_setting('transaction_isolation') = 'repeatable read' THEN
    RAISE EXCEPTION 'APPROVAL_REQUIRED: doi trang thai hieu luc nhan vien % can READ COMMITTED hoac SERIALIZABLE.', OLD.id USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('siscom.rbac'));
  IF public.fn_auth_bootstrap_open() THEN RETURN NEW; END IF;
  v_admin := EXISTS (SELECT 1 FROM public.employee_role er JOIN public.role r ON r.id = er.role_id
                     WHERE er.employee_id = OLD.id AND r.code = 'admin');
  v_approve := EXISTS (SELECT 1 FROM public.employee_role er JOIN public.role_permission rp ON rp.role_id = er.role_id
                       JOIN public.permission p ON p.id = rp.permission_id
                       WHERE er.employee_id = OLD.id AND public.fn_auth_perm_class(p.code) = 'APPROVE');
  IF NOT (v_admin OR v_approve) THEN RETURN NEW; END IF;
  IF v_now THEN
    RAISE EXCEPTION 'APPROVAL_REQUIRED: khong kich hoat lai nhan vien % dang giu vai tro admin/access.approve (go vai tro qua ROLE_REVOKE_CRITICAL truoc, cap lai qua ROLE_GRANT).', OLD.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_admin AND NOT EXISTS (
       SELECT 1 FROM public.employee_role er JOIN public.role r ON r.id = er.role_id JOIN public.employee e ON e.id = er.employee_id
       WHERE r.code = 'admin' AND e.status = 'ACTIVE' AND e.deleted_at IS NULL AND er.employee_id <> OLD.id) THEN
    RAISE EXCEPTION 'LAST_ADMIN: khong cho admin cuoi cung (%) roi trang thai hoat dong.', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  IF v_approve AND NOT EXISTS (
       SELECT 1 FROM public.employee_role er JOIN public.role_permission rp ON rp.role_id = er.role_id
       JOIN public.permission p ON p.id = rp.permission_id JOIN public.employee e ON e.id = er.employee_id
       WHERE public.fn_auth_perm_class(p.code) = 'APPROVE' AND e.status = 'ACTIVE' AND e.deleted_at IS NULL AND er.employee_id <> OLD.id) THEN
    RAISE EXCEPTION 'LAST_APPROVER: khong cho nguoi co access.approve cuoi cung (%) roi trang thai hoat dong.', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

-- S5. Chay SAU trg_pcr_before_update cua M1 (thu tu ten trigger), chi o nhanh APPROVED -> EXECUTED.
-- pg_trigger_depth() >= 2: UPDATE nay phai nam trong fn_auth_consume_request duoc goi tu trigger cua thao tac dac quyen (do sau 1),
--   nen UPDATE truc tiep hay SELECT fn_auth_consume_request(...) truc tiep (do sau 1) deu bi tu choi.
CREATE FUNCTION public.fn_pcr_exec_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  v_req   uuid := public.fn_auth_setting_uuid('app.priv_request_id');
  v_actor uuid := public.fn_auth_setting_uuid('app.actor_employee_id');
BEGIN
  IF pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'APPROVAL_REQUIRED: yeu cau % chi chuyen EXECUTED khi thuc thi thao tac da duyet (fn_auth_consume_request trong trigger).', OLD.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_req IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'APPROVAL_REQUIRED: app.priv_request_id khong trung yeu cau %.', OLD.id USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_actor IS NULL OR NEW.executed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'APPROVAL_REQUIRED: executed_by phai trung app.actor_employee_id (yeu cau %).', OLD.id USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.employee e WHERE e.id = v_actor AND e.status = 'ACTIVE' AND e.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'APPROVAL_REQUIRED: nguoi thuc thi yeu cau % khong con hoat dong.', OLD.id USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_employee_status_guard BEFORE UPDATE ON employee FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.deleted_at IS DISTINCT FROM NEW.deleted_at)
  EXECUTE FUNCTION public.fn_auth_employee_status_guard();
CREATE TRIGGER trg_pcr_exec_guard BEFORE UPDATE ON privileged_change_request FOR EACH ROW
  WHEN (OLD.status = 'APPROVED' AND NEW.status = 'EXECUTED')
  EXECUTE FUNCTION public.fn_pcr_exec_guard();

COMMENT ON FUNCTION public.fn_auth_employee_status_guard() IS 'B1.3 M1.1 (S4): LAST_ADMIN/LAST_APPROVER khi roi hieu luc; chan kich hoat lai nguoi giu vai tro quan trong. Bo qua khi dang khoi tao.';
COMMENT ON FUNCTION public.fn_pcr_exec_guard() IS 'B1.3 M1.1 (S5): EXECUTED chi qua fn_auth_consume_request trong trigger; executed_by = actor ACTIVE; priv_request_id = id.';
