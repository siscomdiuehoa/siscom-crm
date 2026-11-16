-- SISCOM CRM Sales S2 (20261117000000_sales_opportunity). CHI CONG THEM, tuong thich nguoc: 3 enum moi, 1 sequence + ham sinh ma CH-0001,
--   2 bang moi (opportunity, opportunity_change), 1 cot NULL tren activity (opportunity_id), CHECK, trigger, chi muc.
-- Thiet ke: docs/SALES_DESIGN.md §4.1 (PR #234, HEAD bb7887c - Owner cho lam S2 truoc khi S1 merge, 16/11/2026).
-- Du lieu cu: KHONG UPDATE. activity cu nhan opportunity_id NULL. Khong seed danh muc (S4), khong cap quyen (S3 - APP_GRANTS_V5).
-- Quyen: KHONG GRANT/REVOKE. Sau tach role, 2 bang moi nhan SELECT cho siscom_app theo quyen mac dinh (V4 muc 6) - da them vao
--   B1.3_S1_APP_SELECT_ALLOWLIST (bang nghiep vu). Quyen ghi = V5 o PR S3.
-- Quy tac phu thuoc MA danh muc (giai doan >= Bao gia => co gia tri; roi Tiep can => co need_summary; loai Thi cong / Cung cap va thi cong
--   => is_project_linked) KHONG nam o DB: CHECK khong tham chieu duoc lookup_item va ma danh muc do S4 nap - kiem o service (S7) + test (T2).
-- Rollback viet san (KHONG tu chay; tu choi khi con du lieu): backend/docs/SALES_S2_ROLLBACK.sql.txt.
-- Ham dung CREATE OR REPLACE de ap lai sau rollback khong loi 42723. Khong co BEGIN/COMMIT tuong minh.
-- Da thu tren PostgreSQL tam cach ly. CHUA ap len database that nao.

-- 1. Enum
CREATE TYPE "opportunity_status" AS ENUM ('OPEN', 'ON_HOLD', 'WON', 'LOST');
CREATE TYPE "opportunity_won_doc_type" AS ENUM ('HOP_DONG', 'DON_DAT_HANG');
CREATE TYPE "opportunity_change_field" AS ENUM ('STAGE', 'STATUS', 'OWNER', 'AMOUNT', 'PROBABILITY', 'CLOSE_DATE', 'HOLD');

-- 2. Ma co hoi CH-0001 (cung cach ma khach hang / nhan vien; qua do rong thi tu mo rong)
CREATE SEQUENCE IF NOT EXISTS public.opportunity_code_seq START WITH 1 INCREMENT BY 1 NO CYCLE;
CREATE OR REPLACE FUNCTION public.fn_next_opportunity_code() RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT 'CH-' || CASE WHEN n < 10000 THEN lpad(n::text, 4, '0') ELSE n::text END FROM (SELECT nextval('public.opportunity_code_seq') AS n) s $$;

-- 3. Bang opportunity (§4.1)
CREATE TABLE "opportunity" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(20) NOT NULL DEFAULT fn_next_opportunity_code(),
    "customer_id" UUID NOT NULL,
    "contact_id" UUID,
    "title" VARCHAR(200) NOT NULL,
    "need_summary" TEXT,
    "type_id" UUID NOT NULL,
    "is_project_linked" BOOLEAN NOT NULL DEFAULT false,
    "project_name" VARCHAR(200),
    "offer_scope" TEXT,
    "stage_id" UUID NOT NULL,
    "status" "opportunity_status" NOT NULL DEFAULT 'OPEN',
    "expected_amount_vnd" BIGINT,
    "probability" SMALLINT NOT NULL DEFAULT 0,
    "probability_overridden" BOOLEAN NOT NULL DEFAULT false,
    "expected_close_date" DATE,
    "owner_id" UUID NOT NULL,
    "hold_until" DATE,
    "hold_reason" TEXT,
    "won_amount_vnd" BIGINT,
    "won_doc_type" "opportunity_won_doc_type",
    "won_doc_no" VARCHAR(100),
    "won_doc_date" DATE,
    "won_doc_url" VARCHAR(1000),
    "lost_reason_id" UUID,
    "lost_note" TEXT,
    "closed_at" TIMESTAMPTZ(3),
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" UUID,
    "delete_reason" VARCHAR(500),

    CONSTRAINT "opportunity_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "opportunity_code_key" ON "opportunity"("code");
CREATE INDEX "opportunity_customer_id_idx" ON "opportunity"("customer_id");
CREATE INDEX "opportunity_owner_id_status_idx" ON "opportunity"("owner_id", "status");
CREATE INDEX "opportunity_stage_id_idx" ON "opportunity"("stage_id");
CREATE INDEX "opportunity_contact_id_idx" ON "opportunity"("contact_id");
CREATE INDEX "opportunity_deleted_at_idx" ON "opportunity"("deleted_at");
ALTER TABLE "opportunity" ADD CONSTRAINT "opportunity_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunity" ADD CONSTRAINT "opportunity_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunity" ADD CONSTRAINT "opportunity_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "lookup_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunity" ADD CONSTRAINT "opportunity_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "lookup_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunity" ADD CONSTRAINT "opportunity_lost_reason_id_fkey" FOREIGN KEY ("lost_reason_id") REFERENCES "lookup_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunity" ADD CONSTRAINT "opportunity_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunity" ADD CONSTRAINT "opportunity_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunity" ADD CONSTRAINT "opportunity_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunity" ADD CONSTRAINT "opportunity_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. CHECK (§4.1): nhat quan status <-> truong bat buoc; khong am; xac suat 0..100; gan du an => ten + pham vi khong rong
ALTER TABLE "opportunity"
  ADD CONSTRAINT ck_opp_code        CHECK (code ~ '^CH-[0-9]{4,}$'),
  ADD CONSTRAINT ck_opp_title       CHECK (btrim(title) <> ''),
  ADD CONSTRAINT ck_opp_need        CHECK (need_summary IS NULL OR btrim(need_summary) <> ''),
  ADD CONSTRAINT ck_opp_project     CHECK (NOT is_project_linked OR (project_name IS NOT NULL AND btrim(project_name) <> '' AND offer_scope IS NOT NULL AND btrim(offer_scope) <> '')),
  ADD CONSTRAINT ck_opp_amount      CHECK (expected_amount_vnd IS NULL OR expected_amount_vnd >= 0),
  ADD CONSTRAINT ck_opp_won_amount  CHECK (won_amount_vnd IS NULL OR won_amount_vnd >= 0),
  ADD CONSTRAINT ck_opp_probability CHECK (probability BETWEEN 0 AND 100),
  ADD CONSTRAINT ck_opp_hold        CHECK (status <> 'ON_HOLD' OR (hold_until IS NOT NULL AND hold_reason IS NOT NULL AND btrim(hold_reason) <> '')),
  ADD CONSTRAINT ck_opp_won         CHECK (status <> 'WON' OR (won_amount_vnd IS NOT NULL AND won_doc_type IS NOT NULL AND won_doc_no IS NOT NULL AND btrim(won_doc_no) <> ''
                                                                AND won_doc_date IS NOT NULL AND won_doc_url IS NOT NULL)),
  ADD CONSTRAINT ck_opp_won_url     CHECK (won_doc_url IS NULL OR won_doc_url ~ '^https://[^[:space:]]+$'),
  ADD CONSTRAINT ck_opp_lost        CHECK (status <> 'LOST' OR lost_reason_id IS NOT NULL),
  ADD CONSTRAINT ck_opp_closed      CHECK ((status IN ('WON', 'LOST')) = (closed_at IS NOT NULL)),
  ADD CONSTRAINT ck_opp_version     CHECK (version >= 1),
  ADD CONSTRAINT ck_opp_deleted     CHECK ((deleted_at IS NULL AND deleted_by IS NULL AND delete_reason IS NULL)
                                           OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND delete_reason IS NOT NULL AND btrim(delete_reason) <> ''));

-- 5. Trigger
-- 5a. Danh muc dung loai va dang hoat dong khi GAN MOI (mau fn_customer_lookups_*; dung chung fn_assert_lookup cua B1.2)
CREATE OR REPLACE FUNCTION public.fn_opportunity_lookups() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.type_id IS DISTINCT FROM OLD.type_id THEN PERFORM public.fn_assert_lookup(NEW.type_id, 'opportunity_type'); END IF;
  IF TG_OP = 'INSERT' OR NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN PERFORM public.fn_assert_lookup(NEW.stage_id, 'opportunity_stage'); END IF;
  IF TG_OP = 'INSERT' OR NEW.lost_reason_id IS DISTINCT FROM OLD.lost_reason_id THEN PERFORM public.fn_assert_lookup(NEW.lost_reason_id, 'opportunity_lost_reason'); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_opportunity_lookups BEFORE INSERT OR UPDATE ON opportunity FOR EACH ROW EXECUTE FUNCTION public.fn_opportunity_lookups();
-- 5b. Co hoi khong "chuyen khach" (mau fn_activity_customer_fixed) + ma co dinh (dung chung fn_forbid_code_change)
CREATE OR REPLACE FUNCTION public.fn_opportunity_customer_fixed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
    RAISE EXCEPTION 'Khong duoc doi khach hang cua co hoi % (customer_id la co dinh).', OLD.code USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_opportunity_customer_fixed BEFORE UPDATE OF customer_id ON opportunity FOR EACH ROW EXECUTE FUNCTION public.fn_opportunity_customer_fixed();
CREATE TRIGGER trg_opportunity_code_fixed BEFORE UPDATE ON opportunity FOR EACH ROW EXECUTE FUNCTION public.fn_forbid_code_change();
-- 5c. Nguoi lien he cua co hoi phai thuoc CUNG khach (mau fn_check_activity_contact)
CREATE OR REPLACE FUNCTION public.fn_check_opportunity_contact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.contact_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.contact WHERE id = NEW.contact_id AND customer_id = NEW.customer_id) THEN
    RAISE EXCEPTION 'Lien he % khong thuoc khach hang cua co hoi.', NEW.contact_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_opportunity_contact BEFORE INSERT OR UPDATE OF contact_id, customer_id ON opportunity FOR EACH ROW EXECUTE FUNCTION public.fn_check_opportunity_contact();
-- 5d. Lien he da gan co hoi khong duoc chuyen sang khach khac (bo sung trg_contact_customer_fixed cua B1.2 - ham B1.2 GIU NGUYEN, trigger rieng)
CREATE OR REPLACE FUNCTION public.fn_contact_customer_fixed_opp() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id AND EXISTS (SELECT 1 FROM public.opportunity WHERE contact_id = OLD.id) THEN
    RAISE EXCEPTION 'Khong doi khach hang cua lien he % khi da gan co hoi.', OLD.code USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_contact_customer_fixed_opp BEFORE UPDATE OF customer_id ON contact FOR EACH ROW EXECUTE FUNCTION public.fn_contact_customer_fixed_opp();

-- 6. Bang opportunity_change: lich su (chi them; khong sua, khong xoa - dung chung fn_block_mutation nhu audit_log)
CREATE TABLE "opportunity_change" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "opportunity_id" UUID NOT NULL,
    "field" "opportunity_change_field" NOT NULL,
    "old_value" TEXT,
    "new_value" TEXT,
    "reason" VARCHAR(500),
    "changed_by" UUID NOT NULL,
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opportunity_change_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "opportunity_change_opportunity_id_changed_at_idx" ON "opportunity_change"("opportunity_id", "changed_at");
ALTER TABLE "opportunity_change" ADD CONSTRAINT "opportunity_change_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunity_change" ADD CONSTRAINT "opportunity_change_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunity_change" ADD CONSTRAINT ck_oc_reason CHECK (reason IS NULL OR btrim(reason) <> '');
CREATE TRIGGER trg_opportunity_change_append_only BEFORE UPDATE OR DELETE ON opportunity_change FOR EACH ROW EXECUTE FUNCTION public.fn_block_mutation();
CREATE TRIGGER trg_opportunity_change_no_truncate BEFORE TRUNCATE ON opportunity_change FOR EACH STATEMENT EXECUTE FUNCTION public.fn_block_mutation();

-- 7. activity.opportunity_id (NULL; hoat dong cu de NULL) + cung khach voi co hoi
ALTER TABLE "activity" ADD COLUMN "opportunity_id" UUID;
CREATE INDEX "activity_opportunity_id_idx" ON "activity"("opportunity_id");
ALTER TABLE "activity" ADD CONSTRAINT "activity_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE OR REPLACE FUNCTION public.fn_check_activity_opportunity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.opportunity_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.opportunity WHERE id = NEW.opportunity_id AND customer_id = NEW.customer_id) THEN
    RAISE EXCEPTION 'Co hoi % khong thuoc khach hang cua hoat dong.', NEW.opportunity_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_activity_opportunity BEFORE INSERT OR UPDATE OF opportunity_id, customer_id ON activity FOR EACH ROW EXECUTE FUNCTION public.fn_check_activity_opportunity();

-- 8. Tai lieu trong DB
COMMENT ON TABLE  opportunity                    IS 'Sales S2 §4.1: co hoi kinh doanh (HVAC; chua luu linh vuc). Quy tac theo ma danh muc kiem o service (S7).';
COMMENT ON COLUMN opportunity.is_project_linked  IS 'Gan voi du an/cong trinh; true => project_name + offer_scope bat buoc (ck_opp_project). Loai Thi cong/Cung cap va thi cong => luon true (service).';
COMMENT ON COLUMN opportunity.probability        IS '0..100; mac dinh theo giai doan (service); probability_overridden = sua tay';
COMMENT ON COLUMN opportunity.won_doc_url        IS 'Duong dan chung tu (Google Drive) - khai bao cua nguoi dung, KHONG duoc xac minh; chi https://';
COMMENT ON TABLE  opportunity_change             IS 'Sales S2: lich su doi giai doan/trang thai/nguoi phu trach/gia tri/xac suat/ngay chot/tam hoan; chi them';
COMMENT ON COLUMN activity.opportunity_id        IS 'Sales S2: hoat dong/cong viec gan co hoi (cung khach - trg_activity_opportunity); NULL voi dong cu';
