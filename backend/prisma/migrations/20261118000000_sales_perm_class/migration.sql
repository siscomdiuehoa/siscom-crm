-- SISCOM CRM Sales S5 (20261118000000_sales_perm_class). CHI THAY MOT HAM: fn_auth_perm_class xep them tien to "opportunity." vao nhom BIZ.
-- Ly do: SoD cua M1 (fn_auth_role_permission_sod) cam vai tro `admin` (quan tri he thong ky thuat) giu quyen nhom BIZ. Regex cu chi co
--   customer|contact|activity|interaction|approval => 10 ma opportunity.* cua Sales (docs/SALES_DESIGN.md §5.2) roi vao nhom OTHER va KHONG duoc
--   SoD bao ve; D6 (Owner): "Quan tri he thong khong xem du lieu nghiep vu". Ghi chu cua M1: "Doi = migration moi".
-- Khong tao/sua bang, cot, chi muc, du lieu. Khong GRANT/REVOKE (CREATE OR REPLACE giu chu so huu va quyen EXECUTE hien co).
--
-- DONG BO (PR240-R1-01): KHOA -> TIEN KIEM -> THAY HAM nam trong MOT cau lenh DO (nguyen tu du client gui file theo cach nao), khoa giu toi het
--   transaction chua cau lenh:
--   (1) LOCK TABLE permission, role_permission IN SHARE ROW EXCLUSIVE MODE: chan MOI lenh INSERT/UPDATE/DELETE cua giao dich khac tren hai bang
--       (ke ca lenh khong dung khoa tu van), van cho doc. Giao dich ghi dang mo => migration CHO no ket thuc roi moi tien kiem (thay dong da
--       commit); migration dang giu khoa => lenh ghi CHO, sau do trigger SoD danh gia theo ham MOI.
--   (2) pg_advisory_xact_lock('siscom.rbac'): cung khoa voi moi trigger RBAC cua M1 (employee_role, role_permission).
--   Thu tu khoa THONG NHAT voi script ADD/REMOVE/rollback cua S5: bang (permission, role_permission) TRUOC, khoa tu van SAU - trung voi thu tu cua
--   lenh ghi role_permission (khoa bang luc bat dau cau lenh, khoa tu van trong trigger) => khong tao vong cho.
-- TU CHOI neu da co vai tro `admin` giu quyen opportunity.* (xep lai se tao trang thai vi pham SoD co san) - xu ly tay qua yeu cau 2 nguoi truoc.
-- Rollback viet san (KHONG tu chay; tu choi khi con ma opportunity.* trong permission): backend/docs/SALES_S5_PERM_CLASS_ROLLBACK.sql.txt.
-- Kiem hai ket noi (ca hai thu tu): scripts/ci/sales-s5-concurrency.mjs M1/M2. Da thu tren PostgreSQL tam cach ly. CHUA ap len database that nao.
DO $mig$
BEGIN
  IF to_regprocedure('public.fn_auth_perm_class(text)') IS NULL THEN
    RAISE EXCEPTION 'Sales S5: thieu fn_auth_perm_class(text) (chua ap M1).';
  END IF;
  LOCK TABLE public.permission, public.role_permission IN SHARE ROW EXCLUSIVE MODE;
  PERFORM pg_advisory_xact_lock(hashtext('siscom.rbac'));
  IF EXISTS (SELECT 1 FROM public.role_permission rp JOIN public.permission p ON p.id = rp.permission_id JOIN public.role r ON r.id = rp.role_id
             WHERE r.code = 'admin' AND p.code ~ '^opportunity\.') THEN
    RAISE EXCEPTION 'TU CHOI: vai tro admin dang giu quyen opportunity.* - go qua yeu cau 2 nguoi truoc khi ap migration nay.';
  END IF;
  EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.fn_auth_perm_class(p_code text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, public AS $body$
  SELECT CASE
    WHEN p_code = 'access.approve' THEN 'APPROVE'
    WHEN p_code IN ('employee.manage', 'role.manage', 'auth.credential.manage', 'auth.reset.request', 'access.request') THEN 'REQUEST'
    WHEN p_code ~ '^(customer|contact|activity|interaction|approval|opportunity)\.' THEN 'BIZ'
    ELSE 'OTHER' END $body$
  $fn$;
  EXECUTE $cm$COMMENT ON FUNCTION public.fn_auth_perm_class(text) IS 'B1.3 + Sales S5: phan loai quyen APPROVE/REQUEST/BIZ/OTHER cho SoD (BIZ gom opportunity.*). Doi = migration moi.'$cm$;
END $mig$;
