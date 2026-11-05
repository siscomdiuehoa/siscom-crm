-- SISCOM CRM B3 A2 (20261105000100_b3_activity_tasks). CHI CONG THEM, tuong thich nguoc: cot moi (NULL/DEFAULT), 3 enum moi, 7 CHECK,
--   1 trigger, 2 chi muc rieng phan tren activity; 2 bang moi activity_access (#18) va activity_transfer_request (#19).
-- Thiet ke: docs/B3_ACTIVITIES_DESIGN.md §3.2 #2-#20, §3.3 (OWNER_DECISION 03-04/11/2026; A2 duyet 04/11/2026).
-- Can 20261105000000_b3_activity_type_task da ap TRUOC (gia tri enum 'TASK' - 55P04 neu gop chung).
-- Du lieu cu: KHONG UPDATE hang loat; dong cu (5 loai cu) nhan status DEFAULT 'DONE', version 1, cot moi NULL => thoa moi CHECK.
-- Quyen: KHONG GRANT/REVOKE (A2). siscom_app van chi SELECT tren activity (V3); 2 bang moi nhan SELECT theo quyen mac dinh V3 muc 6
--   (VERIFY B1f se bat cho toi khi chay lai V3 - quy trinh chuan). Mo quyen ghi = APP_GRANTS_V4 o PR A3 (duyet rieng).
-- Rollback viet san (KHONG tu chay; tu choi khi con TASK / du lieu o bang moi / gia tri o cot moi): backend/docs/B3_ACTIVITY_TASKS_ROLLBACK.sql.txt.
-- Ham dung CREATE OR REPLACE (nhu B1.2) de ap lai sau rollback khong loi 42723. Khong co BEGIN/COMMIT tuong minh.
-- Da thu tren PostgreSQL tam cach ly. CHUA ap len database that nao.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'activity_type' AND e.enumlabel = 'TASK') THEN
    RAISE EXCEPTION 'Can 20261105000000_b3_activity_type_task da ap truoc (enum activity_type chua co TASK).';
  END IF;
END $$;

-- 1. Enum moi (#2, #20)
CREATE TYPE "activity_status" AS ENUM ('OPEN', 'DONE', 'CANCELLED');
CREATE TYPE "activity_access_revoke_reason" AS ENUM ('REASSIGNED', 'COMPLETED', 'CANCELLED', 'DELETED', 'CUSTOMER_DELETED', 'EXPIRED', 'ROLE_LOST', 'DUE_CHANGED', 'MANUAL');
CREATE TYPE "activity_transfer_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- 2. Cot moi tren activity (#2-#6): NULL hoac DEFAULT => khong rewrite gia tri cu
ALTER TABLE "activity"
  ADD COLUMN "title" VARCHAR(200),
  ADD COLUMN "due_at" TIMESTAMPTZ(3),
  ADD COLUMN "remind_at" TIMESTAMPTZ(3),
  ADD COLUMN "status" "activity_status" NOT NULL DEFAULT 'DONE',
  ADD COLUMN "completed_at" TIMESTAMPTZ(3),
  ADD COLUMN "completed_by" UUID,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "activity" ADD CONSTRAINT "activity_completed_by_fkey" FOREIGN KEY ("completed_by") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. Tien kiem PHONG HO (thiet ke §3.2, ra soat B6): voi cot vua them NULL/DEFAULT, so vi pham luon 0; ADD CONSTRAINT van tu quet toan bang.
--    Chi de co thong diep ro rang neu ban sao bi sua tay truoc khi ap. KHONG sua du lieu.
DO $$
DECLARE n7 bigint; n8 bigint; n9 bigint; n10 bigint; n15 bigint; n16 bigint; n17 bigint;
BEGIN
  SELECT count(*) INTO n7  FROM public.activity WHERE NOT (type <> 'TASK' OR due_at IS NOT NULL);
  SELECT count(*) INTO n8  FROM public.activity WHERE NOT (status <> 'DONE' OR type <> 'TASK' OR completed_at IS NOT NULL);
  SELECT count(*) INTO n9  FROM public.activity WHERE NOT (remind_at IS NULL OR due_at IS NULL OR remind_at <= due_at);
  SELECT count(*) INTO n10 FROM public.activity WHERE NOT (title IS NULL OR btrim(title) <> '');
  SELECT count(*) INTO n15 FROM public.activity WHERE NOT (type = 'TASK' OR status = 'DONE');
  SELECT count(*) INTO n16 FROM public.activity WHERE NOT ((status = 'DONE' AND type = 'TASK') OR (completed_at IS NULL AND completed_by IS NULL));
  SELECT count(*) INTO n17 FROM public.activity WHERE NOT ((completed_at IS NULL) = (completed_by IS NULL));
  IF n7 + n8 + n9 + n10 + n15 + n16 + n17 > 0 THEN
    RAISE EXCEPTION 'B3 tien kiem: du lieu activity vi pham CHECK (#7=% #8=% #9=% #10=% #15=% #16=% #17=%). Khong sua du lieu; xu ly tay roi ap lai.', n7, n8, n9, n10, n15, n16, n17;
  END IF;
END $$;

-- 4. CHECK #7-#10, #15-#17
ALTER TABLE "activity"
  ADD CONSTRAINT ck_activity_task_due       CHECK (type <> 'TASK' OR due_at IS NOT NULL),
  ADD CONSTRAINT ck_activity_done           CHECK (status <> 'DONE' OR type <> 'TASK' OR completed_at IS NOT NULL),
  ADD CONSTRAINT ck_activity_remind         CHECK (remind_at IS NULL OR due_at IS NULL OR remind_at <= due_at),
  ADD CONSTRAINT ck_activity_title          CHECK (title IS NULL OR btrim(title) <> ''),
  ADD CONSTRAINT ck_activity_status_type    CHECK (type = 'TASK' OR status = 'DONE'),
  ADD CONSTRAINT ck_activity_completed      CHECK ((status = 'DONE' AND type = 'TASK') OR (completed_at IS NULL AND completed_by IS NULL)),
  ADD CONSTRAINT ck_activity_completed_pair CHECK ((completed_at IS NULL) = (completed_by IS NULL));

-- 5. Trigger #11: hoat dong khong "chuyen khach" (mau fn_forbid_code_change). trg_activity_contact (B1.2) van bat UPDATE OF customer_id, khong xung dot.
CREATE OR REPLACE FUNCTION public.fn_activity_customer_fixed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
    RAISE EXCEPTION 'Khong duoc doi khach hang cua hoat dong % (customer_id la co dinh).', OLD.code USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_activity_customer_fixed BEFORE UPDATE OF customer_id ON activity FOR EACH ROW EXECUTE FUNCTION public.fn_activity_customer_fixed();

-- 6. Chi muc rieng phan #12, #13 (Prisma khong mo ta duoc => khong khai @@index; migrate diff bo qua chi muc rieng phan). Chi muc cu giu nguyen.
CREATE INDEX idx_activity_open_due        ON activity (performed_by, due_at) WHERE status = 'OPEN' AND deleted_at IS NULL;
CREATE INDEX idx_activity_customer_active ON activity (customer_id, occurred_at DESC) WHERE deleted_at IS NULL;

-- 7. Bang moi #18 activity_access: quyen theo cong viec cho nguoi ngoai pham vi khach (§5.4). Append-only tru cot thu hoi; created_at do DB dat.
CREATE TABLE "activity_access" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "activity_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "granted_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by" UUID,
    "revoke_reason" "activity_access_revoke_reason",

    CONSTRAINT "activity_access_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "activity_access" ADD CONSTRAINT "activity_access_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "activity_access" ADD CONSTRAINT "activity_access_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "activity_access" ADD CONSTRAINT "activity_access_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "activity_access" ADD CONSTRAINT "activity_access_revoked_by_fkey" FOREIGN KEY ("revoked_by") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "activity_access"
  ADD CONSTRAINT ck_aa_expires_after  CHECK (expires_at > created_at),
  ADD CONSTRAINT ck_aa_expires_cap    CHECK (expires_at <= created_at + interval '720 hours'),
  ADD CONSTRAINT ck_aa_revoke_by      CHECK ((revoked_at IS NULL) = (revoked_by IS NULL)),
  ADD CONSTRAINT ck_aa_revoke_reason  CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL));
CREATE UNIQUE INDEX uq_activity_access_active ON activity_access (activity_id, employee_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_activity_access_employee_active ON activity_access (employee_id) WHERE revoked_at IS NULL;
CREATE OR REPLACE FUNCTION public.fn_activity_access_created_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.created_at := now();  -- moc cap quyen do DB dat; expires_at tinh trong cung cau INSERT bang now() (§5.4) => khong lech voi CHECK
  RETURN NEW;
END $$;
CREATE TRIGGER trg_activity_access_created_at BEFORE INSERT ON activity_access FOR EACH ROW EXECUTE FUNCTION public.fn_activity_access_created_at();
CREATE OR REPLACE FUNCTION public.fn_activity_access_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Quyen theo viec % da thu hoi, khong sua lai.', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.activity_id IS DISTINCT FROM OLD.activity_id OR NEW.employee_id IS DISTINCT FROM OLD.employee_id
     OR NEW.granted_by IS DISTINCT FROM OLD.granted_by OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'Quyen theo viec % chi duoc thu hoi (revoked_*), khong doi cot khac (doi han = thu hoi + cap lai).', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_activity_access_append_only BEFORE UPDATE ON activity_access FOR EACH ROW EXECUTE FUNCTION public.fn_activity_access_append_only();

-- 8. Bang moi #19 activity_transfer_request: de xuat chuyen viec co duyet (§5.5). Nguoi de xuat = from_employee_id. PENDING -> trang thai khac dung 1 lan.
CREATE TABLE "activity_transfer_request" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "activity_id" UUID NOT NULL,
    "from_employee_id" UUID NOT NULL,
    "to_employee_id" UUID NOT NULL,
    "reason" VARCHAR(200) NOT NULL,
    "status" "activity_transfer_status" NOT NULL DEFAULT 'PENDING',
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "decision_note" VARCHAR(200),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_transfer_request_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "activity_transfer_request" ADD CONSTRAINT "activity_transfer_request_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "activity_transfer_request" ADD CONSTRAINT "activity_transfer_request_from_employee_id_fkey" FOREIGN KEY ("from_employee_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "activity_transfer_request" ADD CONSTRAINT "activity_transfer_request_to_employee_id_fkey" FOREIGN KEY ("to_employee_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "activity_transfer_request" ADD CONSTRAINT "activity_transfer_request_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "activity_transfer_request"
  ADD CONSTRAINT ck_atr_from_to      CHECK (from_employee_id <> to_employee_id),
  ADD CONSTRAINT ck_atr_pending      CHECK ((status = 'PENDING') = (decided_at IS NULL)),
  ADD CONSTRAINT ck_atr_decided_pair CHECK ((decided_at IS NULL) = (decided_by IS NULL)),
  ADD CONSTRAINT ck_atr_reason       CHECK (btrim(reason) <> '');
CREATE UNIQUE INDEX uq_activity_transfer_pending ON activity_transfer_request (activity_id) WHERE status = 'PENDING';
CREATE OR REPLACE FUNCTION public.fn_activity_transfer_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'PENDING' THEN
    RAISE EXCEPTION 'De xuat chuyen viec % da quyet dinh (%), khong sua lai.', OLD.id, OLD.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.activity_id IS DISTINCT FROM OLD.activity_id OR NEW.from_employee_id IS DISTINCT FROM OLD.from_employee_id
     OR NEW.to_employee_id IS DISTINCT FROM OLD.to_employee_id OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'De xuat chuyen viec % chi duoc quyet dinh (status/decided_*), khong doi noi dung.', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status = 'PENDING' THEN
    RAISE EXCEPTION 'De xuat chuyen viec % dang PENDING: chi duoc chuyen sang APPROVED/REJECTED/WITHDRAWN.', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_activity_transfer_state BEFORE UPDATE ON activity_transfer_request FOR EACH ROW EXECUTE FUNCTION public.fn_activity_transfer_state();

-- 9. Tai lieu trong DB (#14)
COMMENT ON COLUMN activity.title        IS 'B3: tieu de ngan (TASK/MEETING), NULL voi dong cu; UI hien 80 ky tu dau cua content khi NULL';
COMMENT ON COLUMN activity.due_at       IS 'B3: han cong viec; bat buoc voi TASK (ck_activity_task_due)';
COMMENT ON COLUMN activity.remind_at    IS 'B3: moc nhac, <= due_at (ck_activity_remind)';
COMMENT ON COLUMN activity.status       IS 'B3: chi TASK dung OPEN/DONE/CANCELLED; 5 loai cu luon DONE (ck_activity_status_type)';
COMMENT ON COLUMN activity.completed_at IS 'B3: moc hoan thanh, chi khi TASK DONE (ck_activity_completed, ck_activity_completed_pair)';
COMMENT ON COLUMN activity.completed_by IS 'B3: nguoi hoan thanh, di doi voi completed_at';
COMMENT ON COLUMN activity.version      IS 'B3: khoa lac quan nhu customer.version';
COMMENT ON TABLE  activity_access           IS 'B3 §5.4: quyen theo cong viec (mot TASK + the khach toi thieu) cho nguoi ngoai pham vi khach; co han, thu hoi, append-only';
COMMENT ON TABLE  activity_transfer_request IS 'B3 §5.5: de xuat chuyen viec co duyet; moi viec toi da 1 PENDING';
