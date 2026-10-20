-- SISCOM CRM B1.3 auth_core (M1). Chi CONG THEM: 3 enum, 4 bang moi, CHECK/partial unique, ham + trigger.
-- Khong sua bang/cot cu; chi gan THEM trigger len employee_role, role_permission, permission (chan xoa), app_meta (chan duong vong, SoD, khoa bootstrap).
-- Thu tu: Prisma diff (enum/bang/FK/index, sinh offline tu schema.prisma) -> PART B (viet tay).
-- Rollback viet san (KHONG tu chay): backend/docs/B1.3_M1_ROLLBACK.sql. Test rang buoc: backend/docs/B1.3_M1_CONSTRAINT_TESTS.sql.
-- Ma loi (SQLSTATE) de ung dung anh xa: 42501 = APPROVAL_REQUIRED / BOOTSTRAP_CLOSED / chan xoa; 23514 = SOD_VIOLATION / TWO_PERSON / SELF_MODIFICATION / PAYLOAD_HASH / INVALID_STATE;
--   23001 = LAST_ADMIN / LAST_APPROVER / IMMUTABLE / INVALID_TRANSITION / NOT_EXPIRED. Thong diep bat dau bang ma on dinh (vd 'APPROVAL_REQUIRED: ...').
-- Luu y: superuser PostgreSQL va CHU SO HUU bang (hien la siscom_app) van co the DISABLE/DROP trigger -> can tach role migrator/app (xem B1.3.2B_REPORT.md).

-- ===== PRISMA DIFF =====
-- CreateEnum
CREATE TYPE "credential_status" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "privileged_change_type" AS ENUM ('ROLE_GRANT', 'ROLE_REVOKE_CRITICAL', 'PASSWORD_RESET', 'ROLE_PERMISSION_CHANGE');

-- CreateEnum
CREATE TYPE "privileged_change_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'EXECUTED');

-- CreateTable
CREATE TABLE "employee_credential" (
    "employee_id" UUID NOT NULL,
    "password_hash" TEXT NOT NULL,
    "password_algo" VARCHAR(20) NOT NULL,
    "password_params" JSONB NOT NULL,
    "password_changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "must_change_password" BOOLEAN NOT NULL DEFAULT true,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "window_started_at" TIMESTAMPTZ(3),
    "locked_until" TIMESTAMPTZ(3),
    "lock_level" INTEGER NOT NULL DEFAULT 0,
    "token_version" INTEGER NOT NULL DEFAULT 1,
    "status" "credential_status" NOT NULL DEFAULT 'ACTIVE',
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_credential_pkey" PRIMARY KEY ("employee_id")
);

-- CreateTable
CREATE TABLE "auth_session" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employee_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "refresh_hash" VARCHAR(64) NOT NULL,
    "csrf_hash" VARCHAR(64) NOT NULL,
    "issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idle_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "abs_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "rotated_at" TIMESTAMPTZ(3),
    "replaced_by" UUID,
    "revoked_at" TIMESTAMPTZ(3),
    "revoke_reason" VARCHAR(40),
    "mfa_verified_at" TIMESTAMPTZ(3),
    "ip_prefix" VARCHAR(64),
    "ua_short" VARCHAR(200),

    CONSTRAINT "auth_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_token" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employee_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "request_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "password_reset_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "privileged_change_request" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" "privileged_change_type" NOT NULL,
    "subject_employee_id" UUID,
    "subject_role_id" UUID,
    "payload" JSONB NOT NULL,
    "payload_hash" VARCHAR(64) NOT NULL,
    "requested_by" UUID NOT NULL,
    "approved_by" UUID,
    "executed_by" UUID,
    "status" "privileged_change_status" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "executed_at" TIMESTAMPTZ(3),

    CONSTRAINT "privileged_change_request_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auth_session_refresh_hash_key" ON "auth_session"("refresh_hash");

-- CreateIndex
CREATE UNIQUE INDEX "auth_session_replaced_by_key" ON "auth_session"("replaced_by");

-- CreateIndex
CREATE INDEX "auth_session_family_id_idx" ON "auth_session"("family_id");

-- CreateIndex
CREATE INDEX "auth_session_abs_expires_at_idx" ON "auth_session"("abs_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_token_token_hash_key" ON "password_reset_token"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_token_request_id_key" ON "password_reset_token"("request_id");

-- CreateIndex
CREATE INDEX "password_reset_token_employee_id_idx" ON "password_reset_token"("employee_id");

-- CreateIndex
CREATE INDEX "password_reset_token_created_by_idx" ON "password_reset_token"("created_by");

-- CreateIndex
CREATE INDEX "privileged_change_request_subject_employee_id_idx" ON "privileged_change_request"("subject_employee_id");

-- CreateIndex
CREATE INDEX "privileged_change_request_subject_role_id_idx" ON "privileged_change_request"("subject_role_id");

-- CreateIndex
CREATE INDEX "privileged_change_request_requested_by_idx" ON "privileged_change_request"("requested_by");

-- CreateIndex
CREATE INDEX "privileged_change_request_approved_by_idx" ON "privileged_change_request"("approved_by");

-- CreateIndex
CREATE INDEX "privileged_change_request_executed_by_idx" ON "privileged_change_request"("executed_by");

-- CreateIndex
CREATE INDEX "privileged_change_request_status_expires_at_idx" ON "privileged_change_request"("status", "expires_at");

-- AddForeignKey
ALTER TABLE "employee_credential" ADD CONSTRAINT "employee_credential_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_replaced_by_fkey" FOREIGN KEY ("replaced_by") REFERENCES "auth_session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_token" ADD CONSTRAINT "password_reset_token_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_token" ADD CONSTRAINT "password_reset_token_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_token" ADD CONSTRAINT "password_reset_token_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "privileged_change_request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "privileged_change_request" ADD CONSTRAINT "privileged_change_request_subject_employee_id_fkey" FOREIGN KEY ("subject_employee_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "privileged_change_request" ADD CONSTRAINT "privileged_change_request_subject_role_id_fkey" FOREIGN KEY ("subject_role_id") REFERENCES "role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "privileged_change_request" ADD CONSTRAINT "privileged_change_request_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "privileged_change_request" ADD CONSTRAINT "privileged_change_request_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "privileged_change_request" ADD CONSTRAINT "privileged_change_request_executed_by_fkey" FOREIGN KEY ("executed_by") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===== PART B =====
-- B1. CHECK
ALTER TABLE employee_credential ADD CONSTRAINT ck_cred_hash       CHECK (btrim(password_hash) <> ''),
                                ADD CONSTRAINT ck_cred_algo       CHECK (password_algo ~ '^[a-z0-9][a-z0-9_-]*$'),
                                ADD CONSTRAINT ck_cred_params     CHECK (jsonb_typeof(password_params) = 'object'),
                                ADD CONSTRAINT ck_cred_failed     CHECK (failed_count >= 0),
                                ADD CONSTRAINT ck_cred_window     CHECK (failed_count = 0 OR window_started_at IS NOT NULL),
                                ADD CONSTRAINT ck_cred_lock_level CHECK (lock_level BETWEEN 0 AND 10),
                                ADD CONSTRAINT ck_cred_tv         CHECK (token_version >= 1);

ALTER TABLE auth_session ADD CONSTRAINT ck_sess_refresh_hex CHECK (refresh_hash ~ '^[0-9a-f]{64}$'),
                         ADD CONSTRAINT ck_sess_csrf_hex    CHECK (csrf_hash ~ '^[0-9a-f]{64}$'),
                         ADD CONSTRAINT ck_sess_abs         CHECK (abs_expires_at >= issued_at),
                         ADD CONSTRAINT ck_sess_idle        CHECK (idle_expires_at <= abs_expires_at),
                         ADD CONSTRAINT ck_sess_rotation    CHECK (replaced_by IS NULL OR rotated_at IS NOT NULL),
                         ADD CONSTRAINT ck_sess_not_self    CHECK (replaced_by IS NULL OR replaced_by <> id),
                         ADD CONSTRAINT ck_sess_revoke      CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL)),
                         ADD CONSTRAINT ck_sess_reason_fmt  CHECK (revoke_reason IS NULL OR revoke_reason ~ '^[A-Z][A-Z0-9_]*$');

ALTER TABLE password_reset_token ADD CONSTRAINT ck_prt_hash_hex CHECK (token_hash ~ '^[0-9a-f]{64}$'),
                                 ADD CONSTRAINT ck_prt_attempts CHECK (attempts BETWEEN 0 AND 5),
                                 ADD CONSTRAINT ck_prt_expiry   CHECK (expires_at > created_at AND expires_at <= created_at + interval '30 minutes'),
                                 ADD CONSTRAINT ck_prt_terminal CHECK (used_at IS NULL OR revoked_at IS NULL),
                                 ADD CONSTRAINT ck_prt_not_self CHECK (created_by <> employee_id);

ALTER TABLE privileged_change_request
  ADD CONSTRAINT ck_pcr_hash_hex    CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT ck_pcr_payload_obj CHECK (jsonb_typeof(payload) = 'object'),
  ADD CONSTRAINT ck_pcr_expiry      CHECK (expires_at > created_at AND expires_at <= created_at + interval '24 hours'),
  ADD CONSTRAINT ck_pcr_not_self    CHECK (subject_employee_id IS NULL OR requested_by <> subject_employee_id),
  ADD CONSTRAINT ck_pcr_two_person  CHECK (approved_by IS NULL OR (approved_by <> requested_by AND approved_by IS DISTINCT FROM subject_employee_id)),
  ADD CONSTRAINT ck_pcr_exec_subj   CHECK (executed_by IS NULL OR executed_by IS DISTINCT FROM subject_employee_id),
  ADD CONSTRAINT ck_pcr_shape       CHECK (
        (type IN ('ROLE_GRANT', 'ROLE_REVOKE_CRITICAL') AND subject_employee_id IS NOT NULL AND subject_role_id IS NOT NULL)
     OR (type = 'PASSWORD_RESET' AND subject_employee_id IS NOT NULL AND subject_role_id IS NULL)
     OR (type = 'ROLE_PERMISSION_CHANGE' AND subject_employee_id IS NULL AND subject_role_id IS NOT NULL
         AND payload->>'op' IN ('ADD', 'REMOVE', 'SET_SCOPE')
         AND coalesce(payload->>'permissionId', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         AND (payload->>'op' = 'REMOVE' OR payload->>'scope' IN ('ALL', 'DEPARTMENT', 'OWN')))),
  ADD CONSTRAINT ck_pcr_state       CHECK (
        (status = 'PENDING' AND approved_by IS NULL AND decided_at IS NULL AND executed_by IS NULL AND executed_at IS NULL)
     OR (status IN ('APPROVED', 'REJECTED') AND approved_by IS NOT NULL AND decided_at IS NOT NULL AND executed_by IS NULL AND executed_at IS NULL)
     OR (status = 'EXECUTED' AND approved_by IS NOT NULL AND decided_at IS NOT NULL AND executed_by IS NOT NULL AND executed_at IS NOT NULL)
     OR (status = 'EXPIRED' AND executed_by IS NULL AND executed_at IS NULL AND (approved_by IS NULL) = (decided_at IS NULL)));

-- B2. Partial unique / chi muc viet tay (Prisma khong mo ta duoc)
CREATE INDEX ix_auth_session_employee_active ON auth_session (employee_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX uq_prt_active_per_employee ON password_reset_token (employee_id) WHERE used_at IS NULL AND revoked_at IS NULL;
CREATE UNIQUE INDEX uq_pcr_pending ON privileged_change_request (type, subject_employee_id, subject_role_id, payload_hash) NULLS NOT DISTINCT WHERE status = 'PENDING';

-- B3. Ham dung chung
-- Phan loai quyen theo ma (permission.code khong doi duoc nho trg_permission_code_fixed). Doi phan loai = migration moi.
--   APPROVE: duyet thay doi dac quyen. REQUEST: nhom "yeu cau/quan tri truy cap". BIZ: quyen kinh doanh (D2: admin khong duoc giu).
CREATE OR REPLACE FUNCTION public.fn_auth_perm_class(p_code text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, public AS $$
  SELECT CASE
    WHEN p_code = 'access.approve' THEN 'APPROVE'
    WHEN p_code IN ('employee.manage', 'role.manage', 'auth.credential.manage', 'auth.reset.request', 'access.request') THEN 'REQUEST'
    WHEN p_code ~ '^(customer|contact|activity|interaction|approval)\.' THEN 'BIZ'
    ELSE 'OTHER' END $$;

-- Che do khoi tao: mo khi app_meta.auth_bootstrap_done CHUA ton tai; dong vinh vien khi da ghi (trg_app_meta_bootstrap_lock).
CREATE OR REPLACE FUNCTION public.fn_auth_bootstrap_open() RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.app_meta WHERE key = 'auth_bootstrap_done') $$;

-- Nhan vien co quyen thuoc nhom p_class qua BAT KY vai tro nao (khong xet trang thai nhan vien: SoD chat hon).
CREATE OR REPLACE FUNCTION public.fn_auth_emp_has_class(p_emp uuid, p_class text) RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM public.employee_role er
                 JOIN public.role_permission rp ON rp.role_id = er.role_id
                 JOIN public.permission p ON p.id = rp.permission_id
                 WHERE er.employee_id = p_emp AND public.fn_auth_perm_class(p.code) = p_class) $$;

-- Nguoi duyet hop le TAI THOI DIEM goi: nhan vien dang lam viec, chua xoa mem, co access.approve.
CREATE OR REPLACE FUNCTION public.fn_auth_emp_can_approve(p_emp uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT p_emp IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.employee e WHERE e.id = p_emp AND e.status = 'ACTIVE' AND e.deleted_at IS NULL)
     AND public.fn_auth_emp_has_class(p_emp, 'APPROVE') $$;

-- Doc bien phien dang uuid (SET LOCAL app.priv_request_id / app.actor_employee_id). Chua dat hoac rong => NULL; sai dinh dang => tu choi.
CREATE OR REPLACE FUNCTION public.fn_auth_setting_uuid(p_name text) RETURNS uuid LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE v text := nullif(btrim(coalesce(current_setting(p_name, true), '')), '');
BEGIN
  IF v IS NULL THEN RETURN NULL; END IF;
  IF v !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'APPROVAL_REQUIRED: bien % khong phai uuid hop le.', p_name USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN v::uuid;
END $$;

-- Tieu thu MOT yeu cau da duyet khop CHINH XAC thao tac dang lam, chuyen no sang EXECUTED trong CUNG transaction.
-- Kiem lai nguoi duyet con access.approve va con han (chong TOCTOU). Tra ve id yeu cau.
CREATE OR REPLACE FUNCTION public.fn_auth_consume_request(p_type public.privileged_change_type, p_employee uuid, p_role uuid,
                                                          p_perm uuid, p_op text, p_scope text) RETURNS uuid LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  v_id    uuid := public.fn_auth_setting_uuid('app.priv_request_id');
  v_actor uuid := public.fn_auth_setting_uuid('app.actor_employee_id');
  r       public.privileged_change_request%ROWTYPE;
BEGIN
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'APPROVAL_REQUIRED: % can yeu cau da duyet (SET LOCAL app.priv_request_id).', p_type USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO r FROM public.privileged_change_request WHERE id = v_id FOR UPDATE;
  IF NOT FOUND OR r.status <> 'APPROVED' OR r.type <> p_type THEN
    RAISE EXCEPTION 'APPROVAL_REQUIRED: yeu cau % khong o trang thai APPROVED hoac sai loai.', v_id USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF clock_timestamp() >= r.expires_at THEN
    RAISE EXCEPTION 'APPROVAL_REQUIRED: yeu cau % da het han.', v_id USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF r.subject_employee_id IS DISTINCT FROM p_employee OR r.subject_role_id IS DISTINCT FROM p_role THEN
    RAISE EXCEPTION 'APPROVAL_REQUIRED: yeu cau % khong khop doi tuong/vai tro.', v_id USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_type = 'ROLE_PERMISSION_CHANGE' AND (r.payload->>'permissionId' IS DISTINCT FROM p_perm::text OR r.payload->>'op' IS DISTINCT FROM p_op
       OR (p_op <> 'REMOVE' AND r.payload->>'scope' IS DISTINCT FROM p_scope)) THEN
    RAISE EXCEPTION 'APPROVAL_REQUIRED: yeu cau % khong khop quyen/thao tac/pham vi.', v_id USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT public.fn_auth_emp_can_approve(r.approved_by) THEN
    RAISE EXCEPTION 'APPROVAL_REQUIRED: nguoi duyet cua yeu cau % khong con quyen access.approve.', v_id USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'APPROVAL_REQUIRED: thieu nguoi thuc thi (SET LOCAL app.actor_employee_id).' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_actor IS NOT DISTINCT FROM r.subject_employee_id THEN
    RAISE EXCEPTION 'SELF_MODIFICATION: nguoi thuc thi la doi tuong cua yeu cau %.', v_id USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.privileged_change_request SET status = 'EXECUTED', executed_by = v_actor, executed_at = now() WHERE id = v_id;
  RETURN v_id;
END $$;

-- B4. privileged_change_request: tao o PENDING, bam payload dung, bat bien, trang thai mot chieu, khong xoa.
CREATE OR REPLACE FUNCTION public.fn_pcr_before_insert() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  NEW.created_at := now();
  IF NEW.status <> 'PENDING' OR NEW.approved_by IS NOT NULL OR NEW.decided_at IS NOT NULL OR NEW.executed_by IS NOT NULL OR NEW.executed_at IS NOT NULL THEN
    RAISE EXCEPTION 'INVALID_STATE: yeu cau moi phai o trang thai PENDING, chua co quyet dinh.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.payload_hash IS DISTINCT FROM encode(sha256(convert_to(NEW.payload::text, 'UTF8')), 'hex') THEN
    RAISE EXCEPTION 'PAYLOAD_HASH: payload_hash phai = sha256(payload::jsonb::text, UTF8) dang hex.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.requested_by IS DISTINCT FROM public.fn_auth_setting_uuid('app.actor_employee_id') THEN
    RAISE EXCEPTION 'APPROVAL_REQUIRED: requested_by phai trung app.actor_employee_id.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.employee e WHERE e.id = NEW.requested_by AND e.status = 'ACTIVE' AND e.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'APPROVAL_REQUIRED: nguoi yeu cau khong con hoat dong.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.type = 'ROLE_PERMISSION_CHANGE' AND NOT EXISTS (SELECT 1 FROM public.permission p WHERE p.id::text = NEW.payload->>'permissionId') THEN
    RAISE EXCEPTION 'Quyen % khong ton tai.', NEW.payload->>'permissionId' USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.fn_pcr_before_update() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.type <> OLD.type OR NEW.subject_employee_id IS DISTINCT FROM OLD.subject_employee_id
     OR NEW.subject_role_id IS DISTINCT FROM OLD.subject_role_id OR NEW.payload <> OLD.payload OR NEW.payload_hash <> OLD.payload_hash
     OR NEW.requested_by <> OLD.requested_by OR NEW.created_at <> OLD.created_at OR NEW.expires_at <> OLD.expires_at THEN
    RAISE EXCEPTION 'IMMUTABLE: noi dung yeu cau % khong duoc sua sau khi tao.', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status = OLD.status THEN
    IF NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'IMMUTABLE: chi duoc doi trang thai yeu cau %, khong sua tai cho.', OLD.id USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT ((OLD.status = 'PENDING' AND NEW.status IN ('APPROVED', 'REJECTED', 'EXPIRED'))
       OR (OLD.status = 'APPROVED' AND NEW.status IN ('EXECUTED', 'EXPIRED'))) THEN
    RAISE EXCEPTION 'INVALID_TRANSITION: % -> % khong hop le (yeu cau %).', OLD.status, NEW.status, OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status IN ('APPROVED', 'REJECTED') THEN
    IF NEW.approved_by IS NULL OR NEW.approved_by = OLD.requested_by OR NEW.approved_by IS NOT DISTINCT FROM OLD.subject_employee_id THEN
      RAISE EXCEPTION 'TWO_PERSON: nguoi quyet dinh phai khac nguoi yeu cau va khac doi tuong (yeu cau %).', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.approved_by IS DISTINCT FROM public.fn_auth_setting_uuid('app.actor_employee_id') THEN
      RAISE EXCEPTION 'APPROVAL_REQUIRED: approved_by phai trung app.actor_employee_id.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT public.fn_auth_emp_can_approve(NEW.approved_by) THEN
      RAISE EXCEPTION 'APPROVAL_REQUIRED: nguoi quyet dinh khong co access.approve hieu luc.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF clock_timestamp() >= OLD.expires_at THEN
      RAISE EXCEPTION 'APPROVAL_REQUIRED: yeu cau % da het han, khong quyet dinh duoc.', OLD.id USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.decided_at := now();
  ELSIF NEW.status = 'EXECUTED' THEN
    NEW.approved_by := OLD.approved_by; NEW.decided_at := OLD.decided_at;
    IF clock_timestamp() >= OLD.expires_at THEN
      RAISE EXCEPTION 'APPROVAL_REQUIRED: yeu cau % da het han, khong thuc thi duoc.', OLD.id USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT public.fn_auth_emp_can_approve(OLD.approved_by) THEN
      RAISE EXCEPTION 'APPROVAL_REQUIRED: nguoi duyet khong con access.approve (yeu cau %).', OLD.id USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.executed_at := now();
  ELSE -- EXPIRED
    IF clock_timestamp() < OLD.expires_at THEN
      RAISE EXCEPTION 'NOT_EXPIRED: yeu cau % chua toi han expires_at.', OLD.id USING ERRCODE = 'restrict_violation';
    END IF;
    NEW.approved_by := OLD.approved_by; NEW.decided_at := OLD.decided_at;
  END IF;
  RETURN NEW;
END $$;

-- Khoa tu van pg_advisory_xact_lock(siscom.rbac): tuan tu hoa thay doi RBAC de LAST_*/SoD khong bi vuot boi 2 giao dich song song (READ COMMITTED).
-- B5. Chan duong vong: employee_role
CREATE OR REPLACE FUNCTION public.fn_auth_employee_role_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE v_admin boolean; v_approve boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('siscom.rbac'));
  IF public.fn_auth_bootstrap_open() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM public.fn_auth_consume_request('ROLE_GRANT', NEW.employee_id, NEW.role_id, NULL, NULL, NULL);
    RETURN NEW;
  END IF;
  -- DELETE: chi vai tro "quan trong" (admin hoac co access.approve) moi can duyet; con lai admin tu go (co audit o ung dung).
  v_admin := EXISTS (SELECT 1 FROM public.role r WHERE r.id = OLD.role_id AND r.code = 'admin');
  v_approve := EXISTS (SELECT 1 FROM public.role_permission rp JOIN public.permission p ON p.id = rp.permission_id
                       WHERE rp.role_id = OLD.role_id AND public.fn_auth_perm_class(p.code) = 'APPROVE');
  IF NOT (v_admin OR v_approve) THEN RETURN OLD; END IF;
  IF v_admin AND NOT EXISTS (
       SELECT 1 FROM public.employee_role er JOIN public.role r ON r.id = er.role_id JOIN public.employee e ON e.id = er.employee_id
       WHERE r.code = 'admin' AND e.status = 'ACTIVE' AND e.deleted_at IS NULL
         AND NOT (er.employee_id = OLD.employee_id AND er.role_id = OLD.role_id)) THEN
    RAISE EXCEPTION 'LAST_ADMIN: khong go vai tro admin cua nguoi admin cuoi cung.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF v_approve AND NOT EXISTS (
       SELECT 1 FROM public.employee_role er JOIN public.role_permission rp ON rp.role_id = er.role_id
       JOIN public.permission p ON p.id = rp.permission_id JOIN public.employee e ON e.id = er.employee_id
       WHERE public.fn_auth_perm_class(p.code) = 'APPROVE' AND e.status = 'ACTIVE' AND e.deleted_at IS NULL
         AND NOT (er.employee_id = OLD.employee_id AND er.role_id = OLD.role_id)) THEN
    RAISE EXCEPTION 'LAST_APPROVER: khong go nguoi co access.approve cuoi cung.' USING ERRCODE = 'restrict_violation';
  END IF;
  PERFORM public.fn_auth_consume_request('ROLE_REVOKE_CRITICAL', OLD.employee_id, OLD.role_id, NULL, NULL, NULL);
  RETURN OLD;
END $$;

-- SoD (c): mot nhan vien khong nam ca nhom REQUEST va APPROVE qua nhieu vai tro. Ap dung CA trong che do khoi tao.
CREATE OR REPLACE FUNCTION public.fn_auth_employee_role_sod() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('siscom.rbac'));
  IF public.fn_auth_emp_has_class(NEW.employee_id, 'REQUEST') AND public.fn_auth_emp_has_class(NEW.employee_id, 'APPROVE') THEN
    RAISE EXCEPTION 'SOD_VIOLATION: nhan vien % se nam ca quyen yeu cau va quyen duyet.', NEW.employee_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;

-- B6. Chan duong vong: role_permission (moi INSERT/UPDATE/DELETE, ke ca xoa day chuyen khi xoa role/permission)
CREATE OR REPLACE FUNCTION public.fn_auth_role_permission_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('siscom.rbac'));
  IF public.fn_auth_bootstrap_open() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM public.fn_auth_consume_request('ROLE_PERMISSION_CHANGE', NULL, NEW.role_id, NEW.permission_id, 'ADD', NEW.scope::text);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.role_id <> OLD.role_id OR NEW.permission_id <> OLD.permission_id THEN
      RAISE EXCEPTION 'IMMUTABLE: khong doi role_id/permission_id cua role_permission (xoa + them qua yeu cau).' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.scope IS DISTINCT FROM OLD.scope THEN
      PERFORM public.fn_auth_consume_request('ROLE_PERMISSION_CHANGE', NULL, NEW.role_id, NEW.permission_id, 'SET_SCOPE', NEW.scope::text);
    END IF;
    RETURN NEW;
  END IF;
  -- DELETE
  IF EXISTS (SELECT 1 FROM public.permission p WHERE p.id = OLD.permission_id AND public.fn_auth_perm_class(p.code) = 'APPROVE')
     AND EXISTS (SELECT 1 FROM public.employee_role er JOIN public.employee e ON e.id = er.employee_id
                 WHERE er.role_id = OLD.role_id AND e.status = 'ACTIVE' AND e.deleted_at IS NULL)
     AND NOT EXISTS (
       SELECT 1 FROM public.employee_role er JOIN public.role_permission rp ON rp.role_id = er.role_id
       JOIN public.permission p ON p.id = rp.permission_id JOIN public.employee e ON e.id = er.employee_id
       WHERE public.fn_auth_perm_class(p.code) = 'APPROVE' AND e.status = 'ACTIVE' AND e.deleted_at IS NULL
         AND NOT (rp.role_id = OLD.role_id AND rp.permission_id = OLD.permission_id)) THEN
    RAISE EXCEPTION 'LAST_APPROVER: khong go access.approve khoi nguoi duyet cuoi cung.' USING ERRCODE = 'restrict_violation';
  END IF;
  PERFORM public.fn_auth_consume_request('ROLE_PERMISSION_CHANGE', NULL, OLD.role_id, OLD.permission_id, 'REMOVE', NULL);
  RETURN OLD;
END $$;

-- SoD (a)(b)(c) khi them/doi quyen cua vai tro. Khong co co bo qua, ke ca khi da duoc duyet hoac dang khoi tao.
CREATE OR REPLACE FUNCTION public.fn_auth_role_permission_sod() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE v_role text; v_class text; v_emp uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('siscom.rbac'));
  SELECT r.code INTO v_role FROM public.role r WHERE r.id = NEW.role_id;
  SELECT public.fn_auth_perm_class(p.code) INTO v_class FROM public.permission p WHERE p.id = NEW.permission_id;
  IF v_role = 'admin' AND v_class IN ('BIZ', 'APPROVE') THEN
    RAISE EXCEPTION 'SOD_VIOLATION: vai tro admin khong duoc giu quyen kinh doanh hoac access.approve.' USING ERRCODE = 'check_violation';
  END IF;
  IF v_class IN ('REQUEST', 'APPROVE') THEN
    IF EXISTS (SELECT 1 FROM public.role_permission rp JOIN public.permission p ON p.id = rp.permission_id
               WHERE rp.role_id = NEW.role_id AND public.fn_auth_perm_class(p.code) = 'REQUEST')
       AND EXISTS (SELECT 1 FROM public.role_permission rp JOIN public.permission p ON p.id = rp.permission_id
                   WHERE rp.role_id = NEW.role_id AND public.fn_auth_perm_class(p.code) = 'APPROVE') THEN
      RAISE EXCEPTION 'SOD_VIOLATION: vai tro % se co ca quyen yeu cau va quyen duyet.', v_role USING ERRCODE = 'check_violation';
    END IF;
    FOR v_emp IN SELECT er.employee_id FROM public.employee_role er WHERE er.role_id = NEW.role_id LOOP
      IF public.fn_auth_emp_has_class(v_emp, 'REQUEST') AND public.fn_auth_emp_has_class(v_emp, 'APPROVE') THEN
        RAISE EXCEPTION 'SOD_VIOLATION: nhan vien % se nam ca quyen yeu cau va quyen duyet.', v_emp USING ERRCODE = 'check_violation';
      END IF;
    END LOOP;
  END IF;
  RETURN NULL;
END $$;

-- B7. Ma reset: chi phat hanh khi co yeu cau PASSWORD_RESET da duyet (khong co ngoai le khoi tao). Bat bien, khong xoa.
CREATE OR REPLACE FUNCTION public.fn_prt_before_insert() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE v_req uuid := public.fn_auth_setting_uuid('app.priv_request_id');
BEGIN
  NEW.created_at := now();
  IF NEW.used_at IS NOT NULL OR NEW.revoked_at IS NOT NULL OR NEW.attempts <> 0 THEN
    RAISE EXCEPTION 'INVALID_STATE: ma reset moi phai chua dung, chua thu hoi, attempts = 0.' USING ERRCODE = 'check_violation';
  END IF;
  IF v_req IS NULL OR NEW.request_id IS DISTINCT FROM v_req THEN
    RAISE EXCEPTION 'APPROVAL_REQUIRED: request_id cua ma reset phai trung app.priv_request_id.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.created_by IS DISTINCT FROM public.fn_auth_setting_uuid('app.actor_employee_id') THEN
    RAISE EXCEPTION 'APPROVAL_REQUIRED: created_by phai trung app.actor_employee_id.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public.fn_auth_consume_request('PASSWORD_RESET', NEW.employee_id, NULL, NULL, NULL, NULL);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.fn_prt_before_update() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.employee_id <> OLD.employee_id OR NEW.token_hash <> OLD.token_hash OR NEW.request_id <> OLD.request_id
     OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at OR NEW.expires_at <> OLD.expires_at THEN
    RAISE EXCEPTION 'IMMUTABLE: khong sua noi dung ma reset %.', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  IF (OLD.used_at IS NOT NULL OR OLD.revoked_at IS NOT NULL) AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'IMMUTABLE: ma reset % da dung/thu hoi, khong doi duoc.', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.attempts < OLD.attempts THEN
    RAISE EXCEPTION 'IMMUTABLE: attempts cua ma reset khong duoc giam.' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

-- B8. Credential va phien
CREATE OR REPLACE FUNCTION public.fn_cred_before_update() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.employee_id <> OLD.employee_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'IMMUTABLE: khong doi employee_id/created_at cua credential.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.token_version < OLD.token_version THEN
    RAISE EXCEPTION 'IMMUTABLE: token_version chi duoc tang.' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.fn_sess_before_update() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.employee_id <> OLD.employee_id OR NEW.family_id <> OLD.family_id OR NEW.refresh_hash <> OLD.refresh_hash
     OR NEW.csrf_hash <> OLD.csrf_hash OR NEW.issued_at <> OLD.issued_at OR NEW.abs_expires_at <> OLD.abs_expires_at THEN
    RAISE EXCEPTION 'IMMUTABLE: khong sua dinh danh/han tuyet doi cua phien %.', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.rotated_at IS NOT NULL AND NEW.rotated_at IS DISTINCT FROM OLD.rotated_at THEN
    RAISE EXCEPTION 'IMMUTABLE: rotated_at cua phien % da dat.', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  -- replaced_by: dat mot lan; chi duoc ve NULL (FK ON DELETE SET NULL khi don phien thay the).
  IF OLD.replaced_by IS NOT NULL AND NEW.replaced_by IS NOT NULL AND NEW.replaced_by <> OLD.replaced_by THEN
    RAISE EXCEPTION 'IMMUTABLE: replaced_by cua phien % da dat.', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.revoked_at IS NOT NULL AND (NEW.revoked_at IS DISTINCT FROM OLD.revoked_at OR NEW.revoke_reason IS DISTINCT FROM OLD.revoke_reason
       OR NEW.idle_expires_at IS DISTINCT FROM OLD.idle_expires_at OR NEW.last_used_at IS DISTINCT FROM OLD.last_used_at) THEN
    RAISE EXCEPTION 'IMMUTABLE: phien % da thu hoi, khong mo lai/gia han.', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

-- B9. Khoa che do khoi tao vinh vien: khong sua/xoa/truncate khoa auth_bootstrap_done.
CREATE OR REPLACE FUNCTION public.fn_app_meta_bootstrap_lock() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    IF NOT public.fn_auth_bootstrap_open() THEN
      RAISE EXCEPTION 'BOOTSTRAP_CLOSED: khong TRUNCATE app_meta sau khi da khoi tao xac thuc.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NULL;
  END IF;
  IF OLD.key = 'auth_bootstrap_done' THEN
    RAISE EXCEPTION 'BOOTSTRAP_CLOSED: khoa auth_bootstrap_done khong duoc sua/xoa.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

-- B10. Gan trigger
CREATE TRIGGER trg_pcr_before_insert BEFORE INSERT ON privileged_change_request FOR EACH ROW EXECUTE FUNCTION public.fn_pcr_before_insert();
CREATE TRIGGER trg_pcr_before_update BEFORE UPDATE ON privileged_change_request FOR EACH ROW EXECUTE FUNCTION public.fn_pcr_before_update();
CREATE TRIGGER trg_pcr_no_delete     BEFORE DELETE ON privileged_change_request FOR EACH ROW EXECUTE FUNCTION public.fn_block_mutation();
CREATE TRIGGER trg_pcr_no_truncate   BEFORE TRUNCATE ON privileged_change_request FOR EACH STATEMENT EXECUTE FUNCTION public.fn_block_mutation();

CREATE TRIGGER trg_employee_role_guard       BEFORE INSERT OR DELETE ON employee_role FOR EACH ROW EXECUTE FUNCTION public.fn_auth_employee_role_guard();
CREATE TRIGGER trg_employee_role_no_update   BEFORE UPDATE ON employee_role FOR EACH ROW EXECUTE FUNCTION public.fn_block_mutation();
CREATE TRIGGER trg_employee_role_no_truncate BEFORE TRUNCATE ON employee_role FOR EACH STATEMENT EXECUTE FUNCTION public.fn_block_mutation();
CREATE TRIGGER trg_employee_role_sod         AFTER INSERT ON employee_role FOR EACH ROW EXECUTE FUNCTION public.fn_auth_employee_role_sod();

CREATE TRIGGER trg_role_permission_guard       BEFORE INSERT OR UPDATE OR DELETE ON role_permission FOR EACH ROW EXECUTE FUNCTION public.fn_auth_role_permission_guard();
CREATE TRIGGER trg_role_permission_no_truncate BEFORE TRUNCATE ON role_permission FOR EACH STATEMENT EXECUTE FUNCTION public.fn_block_mutation();
CREATE TRIGGER trg_role_permission_sod         AFTER INSERT OR UPDATE ON role_permission FOR EACH ROW EXECUTE FUNCTION public.fn_auth_role_permission_sod();

CREATE TRIGGER trg_prt_before_insert BEFORE INSERT ON password_reset_token FOR EACH ROW EXECUTE FUNCTION public.fn_prt_before_insert();
CREATE TRIGGER trg_prt_before_update BEFORE UPDATE ON password_reset_token FOR EACH ROW EXECUTE FUNCTION public.fn_prt_before_update();
CREATE TRIGGER trg_prt_no_delete     BEFORE DELETE ON password_reset_token FOR EACH ROW EXECUTE FUNCTION public.fn_block_mutation();
CREATE TRIGGER trg_prt_no_truncate   BEFORE TRUNCATE ON password_reset_token FOR EACH STATEMENT EXECUTE FUNCTION public.fn_block_mutation();

CREATE TRIGGER trg_cred_before_update BEFORE UPDATE ON employee_credential FOR EACH ROW EXECUTE FUNCTION public.fn_cred_before_update();
CREATE TRIGGER trg_cred_no_delete     BEFORE DELETE ON employee_credential FOR EACH ROW EXECUTE FUNCTION public.fn_block_mutation();
CREATE TRIGGER trg_cred_no_truncate   BEFORE TRUNCATE ON employee_credential FOR EACH STATEMENT EXECUTE FUNCTION public.fn_block_mutation();

CREATE TRIGGER trg_permission_guard_delete BEFORE DELETE ON permission FOR EACH ROW WHEN (public.fn_auth_perm_class(OLD.code) IN ('APPROVE', 'REQUEST')) EXECUTE FUNCTION public.fn_block_mutation();

CREATE TRIGGER trg_sess_before_update BEFORE UPDATE ON auth_session FOR EACH ROW EXECUTE FUNCTION public.fn_sess_before_update();

CREATE TRIGGER trg_app_meta_bootstrap_lock     BEFORE UPDATE OR DELETE ON app_meta FOR EACH ROW EXECUTE FUNCTION public.fn_app_meta_bootstrap_lock();
CREATE TRIGGER trg_app_meta_bootstrap_truncate BEFORE TRUNCATE ON app_meta FOR EACH STATEMENT EXECUTE FUNCTION public.fn_app_meta_bootstrap_lock();

-- B11. Chu thich
COMMENT ON TABLE  employee_credential       IS 'B1.3: 1 credential / nhan vien. Khong xoa cung; vo hieu = DISABLED. token_version chi tang.';
COMMENT ON TABLE  auth_session              IS 'B1.3: phien refresh (rotation theo family_id). refresh_hash/csrf_hash = SHA-256 hex, khong luu chuoi goc.';
COMMENT ON TABLE  password_reset_token      IS 'B1.3: ma reset mot lan, chi phat hanh qua yeu cau PASSWORD_RESET da duyet; 1 ma con hieu luc / nhan vien.';
COMMENT ON TABLE  privileged_change_request IS 'B1.3 (D11): yeu cau hai nguoi. Bat bien, trang thai mot chieu, khong xoa. approved_by = nguoi quyet dinh.';
COMMENT ON COLUMN privileged_change_request.payload_hash IS 'encode(sha256(convert_to(payload::jsonb::text, ''UTF8'')), ''hex'') - trigger kiem khi tao.';
COMMENT ON FUNCTION public.fn_auth_perm_class(text) IS 'B1.3: phan loai quyen APPROVE/REQUEST/BIZ/OTHER cho SoD. Doi = migration moi.';
