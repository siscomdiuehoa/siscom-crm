-- SISCOM CRM B1.2 crm_core (ghep tu dong boi assemble-b122-migration.cjs)
-- Thu tu: A (extension/sequence/ham) -> Prisma diff (bang/FK/index) -> B (CHECK/partial unique/trigger/tim kiem)

-- ===== PART A =====
CREATE EXTENSION IF NOT EXISTS pg_trgm  WITH SCHEMA public;   -- extension "trusted"; can quyen CREATE tren database
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;   -- idem

-- A1. Sequence ma. nextval an toan khi dong thoi, KHONG rollback => co the co "lo" so, khong bao gio cap lai ma.
CREATE SEQUENCE IF NOT EXISTS public.customer_code_seq START WITH 1 INCREMENT BY 1 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS public.employee_code_seq START WITH 1 INCREMENT BY 1 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS public.contact_code_seq  START WITH 1 INCREMENT BY 1 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS public.activity_code_seq START WITH 1 INCREMENT BY 1 NO CYCLE;

-- A2. Ham sinh ma: KH-00001 / NV-0001 / LH-000001 / TT-000001 (qua do rong thi tu mo rong)
CREATE OR REPLACE FUNCTION public.fn_next_customer_code() RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT 'KH-' || CASE WHEN n < 100000 THEN lpad(n::text, 5, '0') ELSE n::text END FROM (SELECT nextval('public.customer_code_seq') AS n) s $$;
CREATE OR REPLACE FUNCTION public.fn_next_employee_code() RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT 'NV-' || CASE WHEN n < 10000 THEN lpad(n::text, 4, '0') ELSE n::text END FROM (SELECT nextval('public.employee_code_seq') AS n) s $$;
CREATE OR REPLACE FUNCTION public.fn_next_contact_code() RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT 'LH-' || CASE WHEN n < 1000000 THEN lpad(n::text, 6, '0') ELSE n::text END FROM (SELECT nextval('public.contact_code_seq') AS n) s $$;
CREATE OR REPLACE FUNCTION public.fn_next_activity_code() RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT 'TT-' || CASE WHEN n < 1000000 THEN lpad(n::text, 6, '0') ELSE n::text END FROM (SELECT nextval('public.activity_code_seq') AS n) s $$;

-- A3. Bo dau tieng Viet, khong phan biet hoa/thuong. IMMUTABLE de dung duoc trong chi muc bieu thuc.
--     U+0111 = d gach, U+0110 = D gach (dung chr() de khong phu thuoc ma hoa file). normalize() yeu cau database UTF8.
CREATE OR REPLACE FUNCTION public.f_vn_fold(p text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT lower(replace(replace(public.unaccent('public.unaccent'::regdictionary, normalize(p, NFC)), chr(273), 'd'), chr(272), 'D')) $$;

-- A4. Ham trigger dung chung
CREATE OR REPLACE FUNCTION public.fn_forbid_code_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION 'Khong duoc doi ma % cua bang % (ma da phat hanh la co dinh).', OLD.code, TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.fn_lookup_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.code IS DISTINCT FROM OLD.code OR NEW.type IS DISTINCT FROM OLD.type THEN
    RAISE EXCEPTION 'Khong duoc doi type/code cua danh muc (% / %). Hay sua label_vi hoac dat is_active = false.', OLD.type, OLD.code USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.fn_block_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Bang % khong cho phep % (chi them / chi vo hieu hoa).', TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege';
END $$;

-- Danh muc phai dung loai va dang hoat dong khi GAN MOI (khong dung OLD o nhanh INSERT)
CREATE OR REPLACE FUNCTION public.fn_assert_lookup(p_id uuid, p_type text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.lookup_item WHERE id = p_id AND type = p_type AND is_active) THEN
    RAISE EXCEPTION 'Danh muc % khong hop le hoac da ngung su dung.', p_type USING ERRCODE = 'foreign_key_violation';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.fn_customer_lookups_ins() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.fn_assert_lookup(NEW.industry_id, 'industry');
  PERFORM public.fn_assert_lookup(NEW.source_id,   'source');
  PERFORM public.fn_assert_lookup(NEW.province_id, 'province');
  PERFORM public.fn_assert_lookup(NEW.tier_id,     'customer_tier');
  PERFORM public.fn_assert_lookup(NEW.status_id,   'customer_status');
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.fn_customer_lookups_upd() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.industry_id IS DISTINCT FROM OLD.industry_id THEN PERFORM public.fn_assert_lookup(NEW.industry_id, 'industry'); END IF;
  IF NEW.source_id   IS DISTINCT FROM OLD.source_id   THEN PERFORM public.fn_assert_lookup(NEW.source_id,   'source'); END IF;
  IF NEW.province_id IS DISTINCT FROM OLD.province_id THEN PERFORM public.fn_assert_lookup(NEW.province_id, 'province'); END IF;
  IF NEW.tier_id     IS DISTINCT FROM OLD.tier_id     THEN PERFORM public.fn_assert_lookup(NEW.tier_id,     'customer_tier'); END IF;
  IF NEW.status_id   IS DISTINCT FROM OLD.status_id   THEN PERFORM public.fn_assert_lookup(NEW.status_id,   'customer_status'); END IF;
  RETURN NEW;
END $$;

-- Hoat dong chi tro toi lien he CUA CUNG khach hang; lien he da co hoat dong khong duoc chuyen khach hang
CREATE OR REPLACE FUNCTION public.fn_check_activity_contact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.contact_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.contact WHERE id = NEW.contact_id AND customer_id = NEW.customer_id) THEN
    RAISE EXCEPTION 'Lien he % khong thuoc khach hang cua hoat dong.', NEW.contact_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.fn_contact_customer_fixed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id AND EXISTS (SELECT 1 FROM public.activity WHERE contact_id = OLD.id) THEN
    RAISE EXCEPTION 'Khong doi khach hang cua lien he % khi da co hoat dong lien quan.', OLD.code USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

-- ===== PRISMA DIFF =====
-- CreateEnum
CREATE TYPE "activity_type" AS ENUM ('CALL', 'EMAIL', 'MEETING', 'SITE_SURVEY', 'NOTE');

-- CreateEnum
CREATE TYPE "assignment_role" AS ENUM ('OWNER', 'SUPPORT');

-- CreateEnum
CREATE TYPE "employee_status" AS ENUM ('ACTIVE', 'ON_LEAVE', 'RESIGNED');

-- CreateEnum
CREATE TYPE "permission_scope" AS ENUM ('ALL', 'DEPARTMENT', 'OWN');

-- CreateEnum
CREATE TYPE "revenue_basis" AS ENUM ('ESTIMATED', 'DEMO');

-- CreateTable
CREATE TABLE "lookup_item" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" VARCHAR(30) NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "label_vi" VARCHAR(200) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lookup_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "department" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "parent_id" UUID,
    "head_employee_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(20) NOT NULL DEFAULT fn_next_employee_code(),
    "full_name" VARCHAR(200) NOT NULL,
    "email" VARCHAR(254),
    "phone" VARCHAR(40),
    "department_id" UUID,
    "position_title" VARCHAR(120),
    "manager_id" UUID,
    "status" "employee_status" NOT NULL DEFAULT 'ACTIVE',
    "hire_date" DATE,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" UUID,

    CONSTRAINT "employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_confirmed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permission" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(80) NOT NULL,
    "description" TEXT,

    CONSTRAINT "permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permission" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "scope" "permission_scope" NOT NULL DEFAULT 'ALL',

    CONSTRAINT "role_permission_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "employee_role" (
    "employee_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "granted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_role_pkey" PRIMARY KEY ("employee_id","role_id")
);

-- CreateTable
CREATE TABLE "customer" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(20) NOT NULL DEFAULT fn_next_customer_code(),
    "name" VARCHAR(300) NOT NULL,
    "short_name" VARCHAR(120),
    "tax_id" VARCHAR(14),
    "industry_id" UUID,
    "source_id" UUID,
    "province_id" UUID,
    "tier_id" UUID NOT NULL,
    "status_id" UUID NOT NULL,
    "address" TEXT,
    "phone" VARCHAR(40) NOT NULL,
    "phone_e164" VARCHAR(20),
    "email" VARCHAR(254),
    "website" VARCHAR(255),
    "owner_id" UUID,
    "note" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "revenue_vnd" BIGINT NOT NULL DEFAULT 0,
    "revenue_basis" "revenue_basis" NOT NULL DEFAULT 'ESTIMATED',
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "legacy_id" VARCHAR(40),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" UUID,
    "delete_reason" TEXT,
    "restored_at" TIMESTAMPTZ(3),
    "restored_by" UUID,

    CONSTRAINT "customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(20) NOT NULL DEFAULT fn_next_contact_code(),
    "customer_id" UUID NOT NULL,
    "full_name" VARCHAR(200) NOT NULL,
    "title" VARCHAR(120),
    "phone" VARCHAR(40),
    "email" VARCHAR(254),
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" UUID,

    CONSTRAINT "contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(20) NOT NULL DEFAULT fn_next_activity_code(),
    "customer_id" UUID NOT NULL,
    "contact_id" UUID,
    "type" "activity_type" NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "content" TEXT NOT NULL,
    "outcome" TEXT,
    "next_action_at" TIMESTAMPTZ(3),
    "performed_by" UUID,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" UUID,

    CONSTRAINT "activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_assignment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "role" "assignment_role" NOT NULL DEFAULT 'OWNER',
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_by" UUID,
    "ended_at" TIMESTAMPTZ(3),
    "reason" TEXT,

    CONSTRAINT "customer_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_type" VARCHAR(12) NOT NULL DEFAULT 'USER',
    "actor_employee_id" UUID,
    "actor_role" VARCHAR(40),
    "action" VARCHAR(40) NOT NULL,
    "entity_type" VARCHAR(40) NOT NULL,
    "entity_id" UUID,
    "entity_code" VARCHAR(40),
    "summary" TEXT,
    "changes" JSONB,
    "request_id" VARCHAR(64),

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lookup_item_type_is_active_sort_order_idx" ON "lookup_item"("type", "is_active", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "lookup_item_type_code_key" ON "lookup_item"("type", "code");

-- CreateIndex
CREATE UNIQUE INDEX "department_code_key" ON "department"("code");

-- CreateIndex
CREATE INDEX "department_parent_id_idx" ON "department"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_code_key" ON "employee"("code");

-- CreateIndex
CREATE INDEX "employee_department_id_idx" ON "employee"("department_id");

-- CreateIndex
CREATE INDEX "employee_manager_id_idx" ON "employee"("manager_id");

-- CreateIndex
CREATE INDEX "employee_status_idx" ON "employee"("status");

-- CreateIndex
CREATE INDEX "employee_deleted_at_idx" ON "employee"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "role_code_key" ON "role"("code");

-- CreateIndex
CREATE UNIQUE INDEX "permission_code_key" ON "permission"("code");

-- CreateIndex
CREATE INDEX "role_permission_permission_id_idx" ON "role_permission"("permission_id");

-- CreateIndex
CREATE INDEX "employee_role_role_id_idx" ON "employee_role"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_code_key" ON "customer"("code");

-- CreateIndex
CREATE UNIQUE INDEX "customer_legacy_id_key" ON "customer"("legacy_id");

-- CreateIndex
CREATE INDEX "customer_owner_id_idx" ON "customer"("owner_id");

-- CreateIndex
CREATE INDEX "customer_tier_id_idx" ON "customer"("tier_id");

-- CreateIndex
CREATE INDEX "customer_status_id_idx" ON "customer"("status_id");

-- CreateIndex
CREATE INDEX "customer_industry_id_idx" ON "customer"("industry_id");

-- CreateIndex
CREATE INDEX "customer_province_id_idx" ON "customer"("province_id");

-- CreateIndex
CREATE INDEX "customer_deleted_at_idx" ON "customer"("deleted_at");

-- CreateIndex
CREATE INDEX "customer_phone_e164_idx" ON "customer"("phone_e164");

-- CreateIndex
CREATE UNIQUE INDEX "contact_code_key" ON "contact"("code");

-- CreateIndex
CREATE INDEX "contact_customer_id_idx" ON "contact"("customer_id");

-- CreateIndex
CREATE INDEX "contact_deleted_at_idx" ON "contact"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "activity_code_key" ON "activity"("code");

-- CreateIndex
CREATE INDEX "activity_customer_id_occurred_at_idx" ON "activity"("customer_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "activity_next_action_at_idx" ON "activity"("next_action_at");

-- CreateIndex
CREATE INDEX "activity_performed_by_idx" ON "activity"("performed_by");

-- CreateIndex
CREATE INDEX "activity_contact_id_idx" ON "activity"("contact_id");

-- CreateIndex
CREATE INDEX "customer_assignment_customer_id_idx" ON "customer_assignment"("customer_id");

-- CreateIndex
CREATE INDEX "customer_assignment_employee_id_idx" ON "customer_assignment"("employee_id");

-- CreateIndex
CREATE INDEX "audit_log_entity_type_entity_id_idx" ON "audit_log"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_log_entity_type_entity_code_idx" ON "audit_log"("entity_type", "entity_code");

-- CreateIndex
CREATE INDEX "audit_log_occurred_at_idx" ON "audit_log"("occurred_at");

-- CreateIndex
CREATE INDEX "audit_log_actor_employee_id_idx" ON "audit_log"("actor_employee_id");

-- AddForeignKey
ALTER TABLE "department" ADD CONSTRAINT "department_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department" ADD CONSTRAINT "department_head_employee_id_fkey" FOREIGN KEY ("head_employee_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee" ADD CONSTRAINT "employee_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee" ADD CONSTRAINT "employee_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee" ADD CONSTRAINT "employee_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_role" ADD CONSTRAINT "employee_role_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_role" ADD CONSTRAINT "employee_role_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer" ADD CONSTRAINT "customer_industry_id_fkey" FOREIGN KEY ("industry_id") REFERENCES "lookup_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer" ADD CONSTRAINT "customer_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "lookup_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer" ADD CONSTRAINT "customer_province_id_fkey" FOREIGN KEY ("province_id") REFERENCES "lookup_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer" ADD CONSTRAINT "customer_tier_id_fkey" FOREIGN KEY ("tier_id") REFERENCES "lookup_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer" ADD CONSTRAINT "customer_status_id_fkey" FOREIGN KEY ("status_id") REFERENCES "lookup_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer" ADD CONSTRAINT "customer_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer" ADD CONSTRAINT "customer_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer" ADD CONSTRAINT "customer_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer" ADD CONSTRAINT "customer_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer" ADD CONSTRAINT "customer_restored_by_fkey" FOREIGN KEY ("restored_by") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact" ADD CONSTRAINT "contact_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact" ADD CONSTRAINT "contact_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact" ADD CONSTRAINT "contact_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact" ADD CONSTRAINT "contact_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity" ADD CONSTRAINT "activity_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity" ADD CONSTRAINT "activity_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity" ADD CONSTRAINT "activity_performed_by_fkey" FOREIGN KEY ("performed_by") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity" ADD CONSTRAINT "activity_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity" ADD CONSTRAINT "activity_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity" ADD CONSTRAINT "activity_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_assignment" ADD CONSTRAINT "customer_assignment_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_assignment" ADD CONSTRAINT "customer_assignment_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_assignment" ADD CONSTRAINT "customer_assignment_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_employee_id_fkey" FOREIGN KEY ("actor_employee_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===== PART B =====
-- B1. CHECK
ALTER TABLE lookup_item ADD CONSTRAINT ck_lookup_type_fmt CHECK (type ~ '^[a-z][a-z0-9_]*$'),
                        ADD CONSTRAINT ck_lookup_code_fmt CHECK (code ~ '^[A-Z0-9][A-Z0-9_]*$'),
                        ADD CONSTRAINT ck_lookup_label    CHECK (btrim(label_vi) <> '');

ALTER TABLE customer ADD CONSTRAINT ck_customer_name  CHECK (btrim(name) <> ''),
                     ADD CONSTRAINT ck_customer_phone CHECK (btrim(phone) <> ''),
                     ADD CONSTRAINT ck_customer_tax   CHECK (tax_id IS NULL OR tax_id ~ '^[0-9]{10}(-[0-9]{3})?$'),
                     ADD CONSTRAINT ck_customer_code  CHECK (code ~ '^KH-[0-9]{5,}$'),
                     ADD CONSTRAINT ck_customer_rev   CHECK (revenue_vnd >= 0),
                     ADD CONSTRAINT ck_customer_ver   CHECK (version >= 1),
                     ADD CONSTRAINT ck_customer_del   CHECK (deleted_at IS NOT NULL OR deleted_by IS NULL),
                     ADD CONSTRAINT ck_customer_rest  CHECK (restored_at IS NOT NULL OR restored_by IS NULL);

ALTER TABLE employee ADD CONSTRAINT ck_employee_name CHECK (btrim(full_name) <> ''),
                     ADD CONSTRAINT ck_employee_code CHECK (code ~ '^NV-[0-9]{4,}$'),
                     ADD CONSTRAINT ck_employee_del  CHECK (deleted_at IS NOT NULL OR deleted_by IS NULL),
                     ADD CONSTRAINT ck_employee_mgr  CHECK (manager_id IS NULL OR manager_id <> id);

ALTER TABLE department ADD CONSTRAINT ck_dept_name CHECK (btrim(name) <> ''),
                       ADD CONSTRAINT ck_dept_tree CHECK (parent_id IS NULL OR parent_id <> id);

ALTER TABLE contact ADD CONSTRAINT ck_contact_name  CHECK (btrim(full_name) <> ''),
                    ADD CONSTRAINT ck_contact_code  CHECK (code ~ '^LH-[0-9]{6,}$'),
                    ADD CONSTRAINT ck_contact_reach CHECK (btrim(coalesce(phone, '')) <> '' OR btrim(coalesce(email, '')) <> ''),
                    ADD CONSTRAINT ck_contact_del   CHECK (deleted_at IS NOT NULL OR deleted_by IS NULL);

ALTER TABLE activity ADD CONSTRAINT ck_activity_content CHECK (btrim(content) <> ''),
                     ADD CONSTRAINT ck_activity_code    CHECK (code ~ '^TT-[0-9]{6,}$'),
                     ADD CONSTRAINT ck_activity_del     CHECK (deleted_at IS NOT NULL OR deleted_by IS NULL);

ALTER TABLE customer_assignment ADD CONSTRAINT ck_assign_period CHECK (ended_at IS NULL OR ended_at >= assigned_at);

ALTER TABLE audit_log ADD CONSTRAINT ck_audit_actor_type CHECK (actor_type IN ('USER', 'SYSTEM', 'MIGRATION', 'ANONYMOUS')),
                      ADD CONSTRAINT ck_audit_actor_req  CHECK (actor_type <> 'USER' OR actor_employee_id IS NOT NULL);

-- B2. Partial unique (Prisma khong mo ta duoc)
CREATE UNIQUE INDEX uq_customer_tax_id_active ON customer (tax_id) WHERE tax_id IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_contact_primary_active ON contact (customer_id) WHERE is_primary AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_assignment_owner_active ON customer_assignment (customer_id) WHERE role = 'OWNER' AND ended_at IS NULL;
CREATE UNIQUE INDEX uq_employee_email_active ON employee (lower(email)) WHERE email IS NOT NULL AND deleted_at IS NULL;

-- B3. Tim kiem khong dau: truy van phai dung CHINH XAC bieu thuc public.f_vn_fold(cot) va dieu kien deleted_at IS NULL.
CREATE INDEX ix_customer_name_fold  ON customer USING gin (public.f_vn_fold(name)       public.gin_trgm_ops) WHERE deleted_at IS NULL;
CREATE INDEX ix_customer_short_fold ON customer USING gin (public.f_vn_fold(short_name) public.gin_trgm_ops) WHERE deleted_at IS NULL;
CREATE INDEX ix_contact_name_fold   ON contact  USING gin (public.f_vn_fold(full_name)  public.gin_trgm_ops) WHERE deleted_at IS NULL;
CREATE INDEX ix_customer_phone_trgm ON customer USING gin (phone public.gin_trgm_ops) WHERE deleted_at IS NULL;

-- Tim khach hang theo ten cong ty / ten viet tat / ma / MST / TEN NGUOI LIEN HE, khong dau, khong phan biet hoa-thuong.
-- Tu khoa < 2 ky tu tra ve rong; ky tu % _ \ duoc coi la ky tu thuong. Tra ve (id, diem tuong dong), da loc khach da xoa mem.
CREATE OR REPLACE FUNCTION public.fn_customer_search(p_q text, p_limit int DEFAULT 50)
RETURNS TABLE (id uuid, score real) LANGUAGE sql STABLE AS $$
  WITH pat AS (
    SELECT t, '%' || replace(replace(replace(t, '\', '\\'), '%', '\%'), '_', '\_') || '%' AS p
    FROM (SELECT public.f_vn_fold(btrim(p_q)) AS t) q WHERE length(t) >= 2)
  SELECT c.id,
         greatest(public.similarity(public.f_vn_fold(c.name), pat.t),
                  coalesce(public.similarity(public.f_vn_fold(c.short_name), pat.t), 0),
                  coalesce((SELECT max(public.similarity(public.f_vn_fold(ct.full_name), pat.t)) FROM public.contact ct
                            WHERE ct.customer_id = c.id AND ct.deleted_at IS NULL AND public.f_vn_fold(ct.full_name) LIKE pat.p), 0))::real
  FROM public.customer c CROSS JOIN pat
  WHERE c.deleted_at IS NULL AND (
        public.f_vn_fold(c.name) LIKE pat.p
     OR public.f_vn_fold(c.short_name) LIKE pat.p
     OR lower(c.code) LIKE pat.p
     OR c.tax_id LIKE pat.p
     OR EXISTS (SELECT 1 FROM public.contact ct WHERE ct.customer_id = c.id AND ct.deleted_at IS NULL AND public.f_vn_fold(ct.full_name) LIKE pat.p))
  ORDER BY 2 DESC, c.name
  LIMIT p_limit $$;

-- B4. Ho tro khoi phuc xoa mem: liet ke khach dang hoat dong dang giu cung MST
CREATE OR REPLACE FUNCTION public.fn_customer_restore_conflicts(p_customer_id uuid)
RETURNS TABLE (conflict_code text, conflict_name text) LANGUAGE sql STABLE AS $$
  SELECT a.code::text, a.name::text
  FROM public.customer d JOIN public.customer a ON a.tax_id = d.tax_id AND a.deleted_at IS NULL AND a.id <> d.id
  WHERE d.id = p_customer_id AND d.deleted_at IS NOT NULL AND d.tax_id IS NOT NULL $$;

-- B5. Trigger danh muc
CREATE TRIGGER trg_lookup_immutable     BEFORE UPDATE ON lookup_item FOR EACH ROW EXECUTE FUNCTION public.fn_lookup_immutable();
CREATE TRIGGER trg_customer_lookups_ins BEFORE INSERT ON customer    FOR EACH ROW EXECUTE FUNCTION public.fn_customer_lookups_ins();
CREATE TRIGGER trg_customer_lookups_upd BEFORE UPDATE ON customer    FOR EACH ROW EXECUTE FUNCTION public.fn_customer_lookups_upd();

-- B6. Ma khong doi sau khi phat hanh
CREATE TRIGGER trg_customer_code_fixed   BEFORE UPDATE ON customer   FOR EACH ROW EXECUTE FUNCTION public.fn_forbid_code_change();
CREATE TRIGGER trg_employee_code_fixed   BEFORE UPDATE ON employee   FOR EACH ROW EXECUTE FUNCTION public.fn_forbid_code_change();
CREATE TRIGGER trg_contact_code_fixed    BEFORE UPDATE ON contact    FOR EACH ROW EXECUTE FUNCTION public.fn_forbid_code_change();
CREATE TRIGGER trg_activity_code_fixed   BEFORE UPDATE ON activity   FOR EACH ROW EXECUTE FUNCTION public.fn_forbid_code_change();
CREATE TRIGGER trg_department_code_fixed BEFORE UPDATE ON department FOR EACH ROW EXECUTE FUNCTION public.fn_forbid_code_change();
CREATE TRIGGER trg_role_code_fixed       BEFORE UPDATE ON "role"     FOR EACH ROW EXECUTE FUNCTION public.fn_forbid_code_change();
CREATE TRIGGER trg_permission_code_fixed BEFORE UPDATE ON permission FOR EACH ROW EXECUTE FUNCTION public.fn_forbid_code_change();

-- B7. Nhan vien khong xoa cung; nhat ky chi them; hoat dong <-> lien he cung khach hang
CREATE TRIGGER trg_employee_no_delete BEFORE DELETE ON employee FOR EACH ROW EXECUTE FUNCTION public.fn_block_mutation();
CREATE TRIGGER trg_audit_append_only  BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION public.fn_block_mutation();
CREATE TRIGGER trg_audit_no_truncate  BEFORE TRUNCATE ON audit_log FOR EACH STATEMENT EXECUTE FUNCTION public.fn_block_mutation();
CREATE TRIGGER trg_activity_contact   BEFORE INSERT OR UPDATE OF contact_id, customer_id ON activity FOR EACH ROW EXECUTE FUNCTION public.fn_check_activity_contact();
CREATE TRIGGER trg_contact_customer_fixed BEFORE UPDATE OF customer_id ON contact FOR EACH ROW EXECUTE FUNCTION public.fn_contact_customer_fixed();

-- B8. Neu sau nay tach role (siscom_migrator / siscom_app): thu quyen ghi nhat ky khoi role ung dung.
-- (Voi 1 role nhu B1.1, chu so huu van tu cap lai duoc quyen — lop bao ve chinh la trigger B7.)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'siscom_app') AND current_user <> 'siscom_app' THEN
    EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM siscom_app';
  END IF;
END $$;

-- B9. Chu thich
COMMENT ON COLUMN customer.revenue_vnd   IS 'TAM THOI (tuong thich B0): doanh thu du kien/minh hoa, KHONG phai doanh thu thuc te. Xem revenue_basis.';
COMMENT ON COLUMN customer.revenue_basis IS 'ESTIMATED = du kien; DEMO = minh hoa B0. Doanh thu thuc te se suy ra tu hop dong o B2.';
COMMENT ON COLUMN customer.created_by    IS 'NULL = he thong/import. Thao tac cua nguoi dung PHAI co gia tri (service bat buoc).';
COMMENT ON COLUMN audit_log.actor_type   IS 'USER (bat buoc co actor_employee_id) | SYSTEM | MIGRATION | ANONYMOUS';
COMMENT ON TABLE  audit_log              IS 'Chi them. UPDATE/DELETE/TRUNCATE bi trigger chan.';
COMMENT ON FUNCTION public.fn_customer_search(text, int) IS 'Tim khach hang khong dau theo ten cong ty/viet tat/ma/MST/ten lien he.';
