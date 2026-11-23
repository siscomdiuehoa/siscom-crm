-- SISCOM CRM Bao gia Q2 (20261125000000_quotes). CHI CONG THEM, tuong thich nguoc: 3 enum, 1 sequence + ham sinh ma BG-0001, 2 ham kiem JSON,
--   5 bang moi (quote_template, quote_user_default, quote, quote_version, quote_line), CHECK, chi muc duy nhat (U-1..U-4), 4 ham trigger,
--   1 chi muc duy nhat moi tren opportunity (id, customer_id) lam dich cho khoa ngoai ghep, va THAY MOT HAM fn_auth_perm_class (them tien to "quote.").
-- Thiet ke: docs/QUOTES_DESIGN.md v7 muc 5 (PR #266, Owner duyet dac ta 24/11/2026). Ma quy tac R-Q*, C-*, U-* trong file nay la ma cua tai lieu do.
-- Du lieu cu: KHONG UPDATE bang nao. opportunity KHONG them cot. Nap san DUNG MOT dong quote_template trung tinh "chung" (khong phai du lieu that).
-- Quyen: KHONG GRANT/REVOKE. Sau tach role, 5 bang moi nhan SELECT cho siscom_app theo quyen mac dinh (V4 muc 6) - da them vao
--   B1.3_S1_APP_SELECT_ALLOWLIST. Quyen ghi + ma quyen quote.* = PR Q3. siscom_auth, siscom_acct: khong co quyen nao tren 5 bang.
-- Ma loi: moi RAISE cua trigger mang CONSTRAINT = '<MA>' (vi du QUOTE_VERSION_LOCKED) de ung dung doi thanh ma loi co dinh, khong tra nguyen van.
--   SQLSTATE: 23001 (restrict_violation) cho bat bien / khoa / trang thai; 23514 (check_violation) cho du lieu khong dat dieu kien gui.
-- Khoa: R-Q1 (gui), R-Q7 (chap nhan), R-Q8 (doi dang theo duoi), R-Q9 (xoa mem) deu tu lay DIEM KHOA CHUNG = dong opportunity FOR UPDATE (muc 5.4);
--   trigger khong khoa dong quote / quote_version nao khac ngoai dong chinh cau lenh dang ghi. R-Q2c khoa dong phien ban cha FOR SHARE.
-- Rollback viet san (KHONG tu chay; tu choi khi con du lieu / con ma quote.*): backend/docs/QUOTES_Q2_ROLLBACK.sql.txt.
-- Ham dung CREATE OR REPLACE de ap lai sau rollback khong loi 42723. Khong co BEGIN/COMMIT tuong minh.
-- Da thu tren PostgreSQL tam cach ly. CHUA ap len database that nao.

-- 1. Enum
CREATE TYPE "quote_version_status" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED');
CREATE TYPE "quote_vat_mode" AS ENUM ('QUOTE', 'LINE');
CREATE TYPE "quote_line_kind" AS ENUM ('ITEM', 'SECTION');

-- 2. Ma bao gia BG-0001 [QB8] (cung cach ma co hoi CH-0001)
CREATE SEQUENCE IF NOT EXISTS public.quote_code_seq START WITH 1 INCREMENT BY 1 NO CYCLE;
CREATE OR REPLACE FUNCTION public.fn_next_quote_code() RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT 'BG-' || CASE WHEN n < 10000 THEN lpad(n::text, 4, '0') ELSE n::text END FROM (SELECT nextval('public.quote_code_seq') AS n) s $$;

-- 3. Ham kiem JSON (IMMUTABLE, dung trong CHECK)
-- C-6: columns = mang 0..10 phan tu { key: ^[a-z][a-z0-9_]{0,19}$, label 1..40 ky tu khong rong, unit <= 20 ky tu }, dung 3 khoa, key khong trung.
CREATE OR REPLACE FUNCTION public.fn_quote_columns_ok(p jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, public AS $$
DECLARE e jsonb; seen text[] := '{}'; k text;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'array' OR jsonb_array_length(p) > 10 THEN RETURN false; END IF;
  FOR e IN SELECT x FROM jsonb_array_elements(p) AS t(x) LOOP
    IF jsonb_typeof(e) <> 'object' THEN RETURN false; END IF;
    IF (SELECT count(*) FROM jsonb_object_keys(e)) <> 3 OR NOT (e ? 'key' AND e ? 'label' AND e ? 'unit') THEN RETURN false; END IF;
    IF jsonb_typeof(e -> 'key') <> 'string' OR jsonb_typeof(e -> 'label') <> 'string' OR jsonb_typeof(e -> 'unit') <> 'string' THEN RETURN false; END IF;
    k := e ->> 'key';
    IF k !~ '^[a-z][a-z0-9_]{0,19}$' OR k = ANY (seen) THEN RETURN false; END IF;
    IF btrim(e ->> 'label') = '' OR char_length(e ->> 'label') > 40 OR char_length(e ->> 'unit') > 20 THEN RETURN false; END IF;
    seen := seen || k;
  END LOOP;
  RETURN true;
END $$;
-- C-7: extra = doi tuong JSON, toi da 10 khoa, moi gia tri la chuoi <= 200 ky tu. "Khoa thuoc danh sach cot cua phien ban" kiem o R-Q10.
CREATE OR REPLACE FUNCTION public.fn_quote_extra_ok(p jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, public AS $$
DECLARE r record; n int := 0;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RETURN false; END IF;
  FOR r IN SELECT key, value FROM jsonb_each(p) LOOP
    n := n + 1;
    IF n > 10 OR jsonb_typeof(r.value) <> 'string' OR char_length(r.value #>> '{}') > 200 THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END $$;

-- 4. quote_template: loai bao gia [QB17]. Khong xoa cung (R-Q12); ngung dung = is_active false.
CREATE TABLE "quote_template" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "intro" VARCHAR(300) NOT NULL DEFAULT '',
    "default_terms" VARCHAR(4000) NOT NULL DEFAULT '',
    "default_valid_days" SMALLINT NOT NULL DEFAULT 15,
    "default_vat" SMALLINT NOT NULL DEFAULT 10,
    "vat_mode" "quote_vat_mode" NOT NULL DEFAULT 'QUOTE',
    "columns" JSONB NOT NULL DEFAULT '[]',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_template_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "quote_template_code_key" ON "quote_template"("code");
ALTER TABLE "quote_template" ADD CONSTRAINT "quote_template_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quote_template" ADD CONSTRAINT "quote_template_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quote_template"
  ADD CONSTRAINT ck_qt_code       CHECK (code ~ '^[a-z0-9][a-z0-9-]{0,29}$'),
  ADD CONSTRAINT ck_qt_name       CHECK (btrim(name) <> ''),
  ADD CONSTRAINT ck_qt_title      CHECK (btrim(title) <> ''),
  ADD CONSTRAINT ck_qt_valid_days CHECK (default_valid_days BETWEEN 1 AND 365),
  ADD CONSTRAINT ck_qt_vat        CHECK (default_vat IN (8, 10)),
  ADD CONSTRAINT ck_qt_columns    CHECK (public.fn_quote_columns_ok(columns)),
  ADD CONSTRAINT ck_qt_version    CHECK (version >= 1);

-- 5. quote_user_default: mac dinh ca nhan [QB15]; moi nhan vien toi da mot dong
CREATE TABLE "quote_user_default" (
    "employee_id" UUID NOT NULL,
    "quoter_title" VARCHAR(120),
    "quoter_phone" VARCHAR(30),
    "quoter_email" VARCHAR(254),
    "payment_info" VARCHAR(2000) NOT NULL DEFAULT '',
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_user_default_pkey" PRIMARY KEY ("employee_id")
);
ALTER TABLE "quote_user_default" ADD CONSTRAINT "quote_user_default_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 6. quote: mot bao gia cua mot co hoi. Khoa ngoai GHEP (opportunity_id, customer_id) -> opportunity (id, customer_id): bao gia luon cung khach voi
--    co hoi (cung cach contact_id_customer_id_key cua Sales S2). opportunity.customer_id da bat bien (trg_opportunity_customer_fixed).
CREATE UNIQUE INDEX "opportunity_id_customer_id_key" ON "opportunity"("id", "customer_id");
CREATE TABLE "quote" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(20) NOT NULL DEFAULT fn_next_quote_code(),
    "opportunity_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "item_name" VARCHAR(120) NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" UUID,
    "delete_reason" VARCHAR(500),

    CONSTRAINT "quote_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "quote_code_key" ON "quote"("code");
CREATE INDEX "quote_opportunity_id_idx" ON "quote"("opportunity_id");
CREATE INDEX "quote_customer_id_idx" ON "quote"("customer_id");
CREATE INDEX "quote_template_id_idx" ON "quote"("template_id");
CREATE INDEX "quote_deleted_at_idx" ON "quote"("deleted_at");
ALTER TABLE "quote" ADD CONSTRAINT "quote_opportunity_id_customer_id_fkey" FOREIGN KEY ("opportunity_id", "customer_id") REFERENCES "opportunity"("id", "customer_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "quote" ADD CONSTRAINT "quote_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "quote_template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quote" ADD CONSTRAINT "quote_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quote" ADD CONSTRAINT "quote_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quote"
  ADD CONSTRAINT ck_q_code      CHECK (code ~ '^BG-[0-9]{4,}$'),
  ADD CONSTRAINT ck_q_item_name CHECK (item_name <> '' AND item_name = btrim(item_name)),
  ADD CONSTRAINT ck_q_version   CHECK (version >= 1),
  ADD CONSTRAINT ck_q_deleted   CHECK ((deleted_at IS NULL AND deleted_by IS NULL AND delete_reason IS NULL)
                                       OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND delete_reason IS NOT NULL AND btrim(delete_reason) <> ''));
-- U-3: moi co hoi toi da mot bao gia dang theo duoi
CREATE UNIQUE INDEX "uq_quote_primary_per_opportunity" ON "quote"("opportunity_id") WHERE is_primary AND deleted_at IS NULL;

-- 7. quote_version: mot phien ban; MOI thu hien tren ban in doc tu day va tu quote_line (muc 4.3)
CREATE TABLE "quote_version" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "quote_id" UUID NOT NULL,
    "version_no" SMALLINT NOT NULL,
    "status" "quote_version_status" NOT NULL DEFAULT 'DRAFT',
    "code_snapshot" VARCHAR(20) NOT NULL,
    "item_name" VARCHAR(120) NOT NULL,
    "print_template" VARCHAR(30) NOT NULL,
    "template_name" VARCHAR(120) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "columns" JSONB NOT NULL,
    "vat_mode" "quote_vat_mode" NOT NULL,
    "quote_date" DATE,
    "valid_until" DATE,
    "client_name" VARCHAR(200),
    "client_contact" VARCHAR(200),
    "client_company" VARCHAR(200),
    "client_phone" VARCHAR(30),
    "client_email" VARCHAR(254),
    "client_address" VARCHAR(500),
    "project_name" VARCHAR(200),
    "quoter_name" VARCHAR(200) NOT NULL,
    "quoter_title" VARCHAR(120),
    "quoter_phone" VARCHAR(30),
    "quoter_email" VARCHAR(254),
    "intro" VARCHAR(300) NOT NULL DEFAULT '',
    "terms" VARCHAR(4000) NOT NULL DEFAULT '',
    "payment_info" VARCHAR(2000) NOT NULL DEFAULT '',
    "subtotal_vnd" BIGINT NOT NULL DEFAULT 0,
    "base8_vnd" BIGINT NOT NULL DEFAULT 0,
    "base10_vnd" BIGINT NOT NULL DEFAULT 0,
    "vat8_vnd" BIGINT NOT NULL DEFAULT 0,
    "vat10_vnd" BIGINT NOT NULL DEFAULT 0,
    "total_vnd" BIGINT NOT NULL DEFAULT 0,
    "note" VARCHAR(2000),
    "reject_reason" VARCHAR(500),
    "accepted_opportunity_id" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_by" UUID,
    "sent_at" TIMESTAMPTZ(3),
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(3),

    CONSTRAINT "quote_version_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "quote_version_quote_id_version_no_key" ON "quote_version"("quote_id", "version_no");
ALTER TABLE "quote_version" ADD CONSTRAINT "quote_version_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quote_version" ADD CONSTRAINT "quote_version_accepted_opportunity_id_fkey" FOREIGN KEY ("accepted_opportunity_id") REFERENCES "opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quote_version" ADD CONSTRAINT "quote_version_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quote_version" ADD CONSTRAINT "quote_version_sent_by_fkey" FOREIGN KEY ("sent_by") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quote_version" ADD CONSTRAINT "quote_version_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quote_version"
  ADD CONSTRAINT ck_qv_version_no CHECK (version_no BETWEEN 1 AND 999),
  ADD CONSTRAINT ck_qv_texts      CHECK (btrim(code_snapshot) <> '' AND btrim(item_name) <> '' AND btrim(print_template) <> '' AND btrim(template_name) <> ''
                                         AND btrim(title) <> '' AND btrim(quoter_name) <> ''),
  ADD CONSTRAINT ck_qv_columns    CHECK (public.fn_quote_columns_ok(columns)),
  -- C-2
  ADD CONSTRAINT ck_qv_totals     CHECK (subtotal_vnd >= 0 AND base8_vnd >= 0 AND base10_vnd >= 0 AND vat8_vnd >= 0 AND vat10_vnd >= 0 AND total_vnd >= 0
                                         AND subtotal_vnd = base8_vnd + base10_vnd AND subtotal_vnd <= 9000000000000000),
  -- C-3 (chia nguyen bigint; so khong am nen (x * p + 50) / 100 = lam tron 0,5 len)
  ADD CONSTRAINT ck_qv_vat        CHECK (vat8_vnd = (base8_vnd * 8 + 50) / 100 AND vat10_vnd = (base10_vnd * 10 + 50) / 100
                                         AND total_vnd = subtotal_vnd + vat8_vnd + vat10_vnd),
  -- C-4 (+ nhap thi chua co thong tin gui)
  ADD CONSTRAINT ck_qv_sent       CHECK ((status = 'DRAFT' AND sent_by IS NULL AND sent_at IS NULL)
                                         OR (status <> 'DRAFT' AND quote_date IS NOT NULL AND valid_until IS NOT NULL AND sent_by IS NOT NULL
                                             AND sent_at IS NOT NULL AND valid_until >= quote_date)),
  -- C-5
  ADD CONSTRAINT ck_qv_decided    CHECK ((status IN ('ACCEPTED', 'REJECTED')) = (decided_by IS NOT NULL) AND (status IN ('ACCEPTED', 'REJECTED')) = (decided_at IS NOT NULL)
                                         AND (status = 'REJECTED') = (reject_reason IS NOT NULL) AND (reject_reason IS NULL OR btrim(reject_reason) <> '')),
  -- C-8
  ADD CONSTRAINT ck_qv_accepted   CHECK ((accepted_opportunity_id IS NOT NULL) = (status = 'ACCEPTED'));
-- U-1, U-2, U-4
CREATE UNIQUE INDEX "uq_quote_version_one_draft" ON "quote_version"("quote_id") WHERE status = 'DRAFT';
CREATE UNIQUE INDEX "uq_quote_version_one_accepted" ON "quote_version"("quote_id") WHERE status = 'ACCEPTED';
CREATE UNIQUE INDEX "uq_quote_version_accepted_opportunity" ON "quote_version"("accepted_opportunity_id") WHERE accepted_opportunity_id IS NOT NULL;

-- 8. quote_line: dong hang / dong tieu de nhom
CREATE TABLE "quote_line" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "quote_version_id" UUID NOT NULL,
    "line_no" SMALLINT NOT NULL,
    "kind" "quote_line_kind" NOT NULL DEFAULT 'ITEM',
    "description" VARCHAR(500) NOT NULL,
    "unit" VARCHAR(30) NOT NULL DEFAULT '',
    "note" VARCHAR(200),
    "extra" JSONB NOT NULL DEFAULT '{}',
    "quantity" DECIMAL(12,3),
    "unit_price_vnd" BIGINT,
    "vat_percent" SMALLINT,
    "amount_vnd" BIGINT,
    "cost_price_vnd" BIGINT,

    CONSTRAINT "quote_line_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "quote_line_quote_version_id_idx" ON "quote_line"("quote_version_id");
ALTER TABLE "quote_line" ADD CONSTRAINT "quote_line_quote_version_id_fkey" FOREIGN KEY ("quote_version_id") REFERENCES "quote_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Thu tu dong: duy nhat trong phien ban, kiem CUOI transaction (doi cho hai dong trong mot lan luu khong vuong rang buoc tam thoi)
ALTER TABLE "quote_line" ADD CONSTRAINT "uq_quote_line_version_line_no" UNIQUE ("quote_version_id", "line_no") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "quote_line"
  ADD CONSTRAINT ck_ql_line_no     CHECK (line_no BETWEEN 1 AND 300),
  ADD CONSTRAINT ck_ql_description CHECK (btrim(description) <> ''),
  ADD CONSTRAINT ck_ql_extra       CHECK (public.fn_quote_extra_ok(extra)),
  -- C-1 (round cua numeric: 0,5 ra xa 0) va C-1b
  ADD CONSTRAINT ck_ql_kind        CHECK (
    (kind = 'ITEM' AND quantity IS NOT NULL AND quantity > 0 AND quantity <= 999999.999
       AND unit_price_vnd IS NOT NULL AND unit_price_vnd BETWEEN 0 AND 999999999999
       AND vat_percent IS NOT NULL AND vat_percent IN (8, 10)
       AND amount_vnd IS NOT NULL AND amount_vnd = round(quantity * unit_price_vnd)
       AND (cost_price_vnd IS NULL OR cost_price_vnd BETWEEN 0 AND 999999999999))
    OR (kind = 'SECTION' AND quantity IS NULL AND unit_price_vnd IS NULL AND vat_percent IS NULL AND amount_vnd IS NULL AND cost_price_vnd IS NULL
       AND unit = '' AND extra = '{}'::jsonb));

-- 9. Trigger. Deu SECURITY INVOKER (mac dinh), search_path co dinh, moi ten bang ghi kem schema.
-- 9a. quote: R-Q4 (bat bien), R-Q5 (bat dang theo duoi can phien ban da gui), R-Q8 (da chap nhan thi co dinh), R-Q9 (xoa mem),
--     va dong moi khong duoc tao san o trang thai dang theo duoi / da xoa.
CREATE OR REPLACE FUNCTION public.fn_quote_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.is_primary OR NEW.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'QUOTE_INSERT_STATE: bao gia moi khong duoc tao san o trang thai dang theo duoi / da xoa.' USING ERRCODE = 'restrict_violation', CONSTRAINT = 'QUOTE_INSERT_STATE';
    END IF;
    RETURN NEW;
  END IF;
  -- R-Q4
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.code IS DISTINCT FROM OLD.code OR NEW.opportunity_id IS DISTINCT FROM OLD.opportunity_id
     OR NEW.customer_id IS DISTINCT FROM OLD.customer_id OR NEW.template_id IS DISTINCT FROM OLD.template_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'QUOTE_IMMUTABLE: khong duoc doi ma / co hoi / khach / loai / nguoi tao / ngay tao cua bao gia %.', OLD.code USING ERRCODE = 'restrict_violation', CONSTRAINT = 'QUOTE_IMMUTABLE';
  END IF;
  IF NEW.is_primary IS DISTINCT FROM OLD.is_primary OR (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL) THEN
    -- Diem khoa chung (5.4): cac lenh sau doc tren du lieu da chot cua thao tac chay truoc
    PERFORM 1 FROM public.opportunity WHERE id = OLD.opportunity_id FOR UPDATE;
  END IF;
  IF NEW.is_primary IS DISTINCT FROM OLD.is_primary THEN
    -- R-Q8
    IF EXISTS (SELECT 1 FROM public.quote_version WHERE accepted_opportunity_id = OLD.opportunity_id) THEN
      RAISE EXCEPTION 'QUOTE_PRIMARY_FIXED: co hoi da co bao gia duoc chap nhan - khong doi bao gia dang theo duoi.' USING ERRCODE = 'restrict_violation', CONSTRAINT = 'QUOTE_PRIMARY_FIXED';
    END IF;
    -- R-Q5
    IF NEW.is_primary AND NOT EXISTS (SELECT 1 FROM public.quote_version WHERE quote_id = OLD.id AND status <> 'DRAFT') THEN
      RAISE EXCEPTION 'QUOTE_PRIMARY_NEEDS_SENT: bao gia % chua co phien ban nao da gui.', OLD.code USING ERRCODE = 'restrict_violation', CONSTRAINT = 'QUOTE_PRIMARY_NEEDS_SENT';
    END IF;
  END IF;
  -- R-Q9
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL AND EXISTS (SELECT 1 FROM public.quote_version WHERE quote_id = OLD.id AND status <> 'DRAFT') THEN
    RAISE EXCEPTION 'QUOTE_DELETE_FORBIDDEN: bao gia % da co phien ban da gui - khong xoa.', OLD.code USING ERRCODE = 'restrict_violation', CONSTRAINT = 'QUOTE_DELETE_FORBIDDEN';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_quote_guard BEFORE INSERT OR UPDATE ON quote FOR EACH ROW EXECUTE FUNCTION public.fn_quote_guard();

-- 9b. quote_version: MOT ham cho moi quy tac (R-Q15, R-Q13, R-Q3, R-Q2a, R-Q14, R-Q11, R-Q1, R-Q7, R-Q2b) => khong phu thuoc thu tu goi trigger.
CREATE OR REPLACE FUNCTION public.fn_quote_version_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  v_opp uuid; v_expected uuid; v_primary boolean; v_deleted timestamptz;
  n_item int; n_rate int; s8 bigint; s10 bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- R-Q2b
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'QUOTE_VERSION_LOCKED: chi xoa duoc phien ban nhap.' USING ERRCODE = 'restrict_violation', CONSTRAINT = 'QUOTE_VERSION_LOCKED';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    -- R-Q15 (+ R-Q14 cho dong moi)
    IF NEW.accepted_opportunity_id IS NOT NULL THEN
      RAISE EXCEPTION 'QUOTE_ACCEPTED_REF_FORBIDDEN: accepted_opportunity_id chi do database xac lap.' USING ERRCODE = 'restrict_violation', CONSTRAINT = 'QUOTE_ACCEPTED_REF_FORBIDDEN';
    END IF;
    IF NEW.status <> 'DRAFT' OR NEW.sent_by IS NOT NULL OR NEW.sent_at IS NOT NULL OR NEW.decided_by IS NOT NULL OR NEW.decided_at IS NOT NULL OR NEW.reject_reason IS NOT NULL THEN
      RAISE EXCEPTION 'QUOTE_VERSION_INSERT_NOT_DRAFT: phien ban moi phai la nhap, chua co thong tin gui / ket qua.' USING ERRCODE = 'restrict_violation', CONSTRAINT = 'QUOTE_VERSION_INSERT_NOT_DRAFT';
    END IF;
    RETURN NEW;
  END IF;

  -- R-Q13: bat bien ke ca khi con la nhap
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.quote_id IS DISTINCT FROM OLD.quote_id OR NEW.version_no IS DISTINCT FROM OLD.version_no
     OR NEW.vat_mode IS DISTINCT FROM OLD.vat_mode OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'QUOTE_VERSION_IMMUTABLE: khong duoc doi bao gia / so phien ban / cach tinh VAT / nguoi tao / ngay tao cua phien ban.' USING ERRCODE = 'restrict_violation', CONSTRAINT = 'QUOTE_VERSION_IMMUTABLE';
  END IF;
  -- R-Q3
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT ((OLD.status = 'DRAFT' AND NEW.status = 'SENT') OR (OLD.status = 'SENT' AND NEW.status IN ('ACCEPTED', 'REJECTED'))) THEN
    RAISE EXCEPTION 'QUOTE_STATUS_TRANSITION: khong chuyen duoc trang thai % -> %.', OLD.status, NEW.status USING ERRCODE = 'restrict_violation', CONSTRAINT = 'QUOTE_STATUS_TRANSITION';
  END IF;
  -- R-Q2a: sau khi gui CHI duoc doi status, decided_by, decided_at, reject_reason, accepted_opportunity_id, updated_at.
  --        Danh sach duoi day la TOAN BO cot con lai (bai kiem B9 doi chieu voi information_schema: them cot ma quen dua vao day => test do).
  IF OLD.status <> 'DRAFT' AND (
       NEW.code_snapshot IS DISTINCT FROM OLD.code_snapshot OR NEW.item_name IS DISTINCT FROM OLD.item_name OR NEW.print_template IS DISTINCT FROM OLD.print_template
    OR NEW.template_name IS DISTINCT FROM OLD.template_name OR NEW.title IS DISTINCT FROM OLD.title OR NEW.columns IS DISTINCT FROM OLD.columns
    OR NEW.quote_date IS DISTINCT FROM OLD.quote_date OR NEW.valid_until IS DISTINCT FROM OLD.valid_until
    OR NEW.client_name IS DISTINCT FROM OLD.client_name OR NEW.client_contact IS DISTINCT FROM OLD.client_contact OR NEW.client_company IS DISTINCT FROM OLD.client_company
    OR NEW.client_phone IS DISTINCT FROM OLD.client_phone OR NEW.client_email IS DISTINCT FROM OLD.client_email OR NEW.client_address IS DISTINCT FROM OLD.client_address
    OR NEW.project_name IS DISTINCT FROM OLD.project_name
    OR NEW.quoter_name IS DISTINCT FROM OLD.quoter_name OR NEW.quoter_title IS DISTINCT FROM OLD.quoter_title OR NEW.quoter_phone IS DISTINCT FROM OLD.quoter_phone
    OR NEW.quoter_email IS DISTINCT FROM OLD.quoter_email
    OR NEW.intro IS DISTINCT FROM OLD.intro OR NEW.terms IS DISTINCT FROM OLD.terms OR NEW.payment_info IS DISTINCT FROM OLD.payment_info
    OR NEW.subtotal_vnd IS DISTINCT FROM OLD.subtotal_vnd OR NEW.base8_vnd IS DISTINCT FROM OLD.base8_vnd OR NEW.base10_vnd IS DISTINCT FROM OLD.base10_vnd
    OR NEW.vat8_vnd IS DISTINCT FROM OLD.vat8_vnd OR NEW.vat10_vnd IS DISTINCT FROM OLD.vat10_vnd OR NEW.total_vnd IS DISTINCT FROM OLD.total_vnd
    OR NEW.note IS DISTINCT FROM OLD.note OR NEW.sent_by IS DISTINCT FROM OLD.sent_by OR NEW.sent_at IS DISTINCT FROM OLD.sent_at) THEN
    RAISE EXCEPTION 'QUOTE_VERSION_LOCKED: phien ban da gui - khong sua noi dung.' USING ERRCODE = 'restrict_violation', CONSTRAINT = 'QUOTE_VERSION_LOCKED';
  END IF;

  -- R-Q14: accepted_opportunity_id CHI do DB xac lap (quote_id va quote.opportunity_id deu bat bien => gia tri khong the lech)
  SELECT q.opportunity_id INTO v_opp FROM public.quote q WHERE q.id = NEW.quote_id;
  v_expected := CASE WHEN NEW.status = 'ACCEPTED' THEN v_opp END;
  IF NEW.accepted_opportunity_id IS DISTINCT FROM v_expected
     AND NOT (OLD.status = 'SENT' AND NEW.status = 'ACCEPTED' AND NEW.accepted_opportunity_id IS NULL) THEN
    RAISE EXCEPTION 'QUOTE_ACCEPTED_REF_FORBIDDEN: accepted_opportunity_id chi do database xac lap.' USING ERRCODE = 'restrict_violation', CONSTRAINT = 'QUOTE_ACCEPTED_REF_FORBIDDEN';
  END IF;
  NEW.accepted_opportunity_id := v_expected;

  -- R-Q11: doi danh sach cot (chi con xay ra o nhap) khi con dong dung khoa bi bo
  IF NEW.columns IS DISTINCT FROM OLD.columns AND EXISTS (
       SELECT 1 FROM public.quote_line l CROSS JOIN LATERAL jsonb_object_keys(l.extra) AS k(key)
       WHERE l.quote_version_id = NEW.id AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.columns) AS c(col) WHERE c.col ->> 'key' = k.key)) THEN
    RAISE EXCEPTION 'QUOTE_COLUMN_IN_USE: con dong hang dung cot rieng bi bo.' USING ERRCODE = 'check_violation', CONSTRAINT = 'QUOTE_COLUMN_IN_USE';
  END IF;

  -- R-Q1: gui
  IF OLD.status = 'DRAFT' AND NEW.status = 'SENT' THEN
    PERFORM 1 FROM public.opportunity WHERE id = v_opp FOR UPDATE;                     -- diem khoa chung (5.4): gui <-> xoa mem bao gia
    SELECT q.deleted_at INTO v_deleted FROM public.quote q WHERE q.id = NEW.quote_id;
    IF v_deleted IS NOT NULL THEN
      RAISE EXCEPTION 'QUOTE_DELETED: bao gia da xoa - khong gui.' USING ERRCODE = 'restrict_violation', CONSTRAINT = 'QUOTE_DELETED';
    END IF;
    PERFORM 1 FROM public.quote_line l WHERE l.quote_version_id = NEW.id FOR UPDATE;   -- khoa moi dong cua phien ban
    SELECT count(*) FILTER (WHERE l.kind = 'ITEM'), count(DISTINCT l.vat_percent) FILTER (WHERE l.kind = 'ITEM'),
           coalesce(sum(l.amount_vnd) FILTER (WHERE l.vat_percent = 8), 0), coalesce(sum(l.amount_vnd) FILTER (WHERE l.vat_percent = 10), 0)
      INTO n_item, n_rate, s8, s10
      FROM public.quote_line l WHERE l.quote_version_id = NEW.id;
    IF n_item = 0 THEN
      RAISE EXCEPTION 'QUOTE_EMPTY: phien ban chua co dong hang nao.' USING ERRCODE = 'check_violation', CONSTRAINT = 'QUOTE_EMPTY';
    END IF;
    IF s8 <> NEW.base8_vnd OR s10 <> NEW.base10_vnd THEN
      RAISE EXCEPTION 'QUOTE_TOTAL_MISMATCH: tong theo muc VAT khong khop cac dong hang.' USING ERRCODE = 'check_violation', CONSTRAINT = 'QUOTE_TOTAL_MISMATCH';
    END IF;
    IF NEW.vat_mode = 'QUOTE' AND n_rate > 1 THEN
      RAISE EXCEPTION 'QUOTE_VAT_MIXED: bao gia mot muc VAT nhung cac dong hang co hai muc.' USING ERRCODE = 'check_violation', CONSTRAINT = 'QUOTE_VAT_MIXED';
    END IF;
  END IF;

  -- R-Q7: chap nhan [QB6, QB7]
  IF OLD.status = 'SENT' AND NEW.status = 'ACCEPTED' THEN
    PERFORM 1 FROM public.opportunity WHERE id = v_opp FOR UPDATE;                     -- diem khoa chung (5.4)
    SELECT q.is_primary INTO v_primary FROM public.quote q WHERE q.id = NEW.quote_id;  -- doc SAU khi giu khoa
    IF NOT coalesce(v_primary, false) THEN
      RAISE EXCEPTION 'QUOTE_NOT_PRIMARY: chi chap nhan duoc phien ban cua bao gia dang theo duoi.' USING ERRCODE = 'restrict_violation', CONSTRAINT = 'QUOTE_NOT_PRIMARY';
    END IF;
    IF EXISTS (SELECT 1 FROM public.quote_version x WHERE x.accepted_opportunity_id = v_opp AND x.id <> NEW.id) THEN
      RAISE EXCEPTION 'QUOTE_ALREADY_ACCEPTED: co hoi da co phien ban bao gia duoc chap nhan.' USING ERRCODE = 'restrict_violation', CONSTRAINT = 'QUOTE_ALREADY_ACCEPTED';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_quote_version_guard BEFORE INSERT OR UPDATE OR DELETE ON quote_version FOR EACH ROW EXECUTE FUNCTION public.fn_quote_version_guard();

-- 9c. quote_line: R-Q2c (khoa dong cha FOR SHARE; chi sua khi cha la nhap; quote_version_id bat bien) + R-Q10 (khoa cua extra thuoc cot cua cha)
CREATE OR REPLACE FUNCTION public.fn_quote_line_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE v_version uuid; v_status public.quote_version_status; v_columns jsonb;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.quote_version_id IS DISTINCT FROM OLD.quote_version_id OR NEW.id IS DISTINCT FROM OLD.id) THEN
    RAISE EXCEPTION 'QUOTE_LINE_IMMUTABLE: khong chuyen dong hang sang phien ban khac.' USING ERRCODE = 'restrict_violation', CONSTRAINT = 'QUOTE_LINE_IMMUTABLE';
  END IF;
  v_version := CASE WHEN TG_OP = 'INSERT' THEN NEW.quote_version_id ELSE OLD.quote_version_id END;
  SELECT v.status, v.columns INTO v_status, v_columns FROM public.quote_version v WHERE v.id = v_version FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Phien ban bao gia % khong ton tai.', v_version USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'QUOTE_VERSION_LOCKED: phien ban da gui - khong them / sua / xoa dong.' USING ERRCODE = 'restrict_violation', CONSTRAINT = 'QUOTE_VERSION_LOCKED';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  -- R-Q10 (hinh dang cua extra do ck_ql_extra kiem; o day chi doc khoa khi extra la doi tuong)
  IF jsonb_typeof(NEW.extra) = 'object' AND EXISTS (
       SELECT 1 FROM jsonb_object_keys(NEW.extra) AS k(key)
       WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_columns) AS c(col) WHERE c.col ->> 'key' = k.key)) THEN
    RAISE EXCEPTION 'QUOTE_UNKNOWN_COLUMN: dong hang co cot rieng khong thuoc danh sach cot cua phien ban.' USING ERRCODE = 'check_violation', CONSTRAINT = 'QUOTE_UNKNOWN_COLUMN';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_quote_line_guard BEFORE INSERT OR UPDATE OR DELETE ON quote_line FOR EACH ROW EXECUTE FUNCTION public.fn_quote_line_guard();

-- 9d. quote_template: R-Q12 khong xoa cung
CREATE OR REPLACE FUNCTION public.fn_quote_template_no_delete() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION 'QUOTE_TEMPLATE_DELETE: khong xoa loai bao gia - ngung dung bang is_active.' USING ERRCODE = 'restrict_violation', CONSTRAINT = 'QUOTE_TEMPLATE_DELETE';
END $$;
CREATE TRIGGER trg_quote_template_no_delete BEFORE DELETE ON quote_template FOR EACH ROW EXECUTE FUNCTION public.fn_quote_template_no_delete();

-- 10. Nap san MOT loai trung tinh (muc 4.1): khong cot rieng, dieu khoan rong. Cac loai cua cong ty do nguoi co quyen tao tren man hinh.
INSERT INTO "quote_template" ("code", "name", "title") VALUES ('chung', 'Báo giá chung', 'BẢNG BÁO GIÁ');

-- 11. Tai lieu trong DB
COMMENT ON TABLE  quote_template                        IS 'Bao gia Q2: loai bao gia (tieu de, cot rieng, cach tinh VAT). Khong xoa cung; sua loai khong doi bao gia da lap.';
COMMENT ON TABLE  quote_user_default                    IS 'Bao gia Q2: mac dinh ca nhan cua nguoi lap (chuc vu, dien thoai, email, thong tin tai khoan).';
COMMENT ON TABLE  quote                                 IS 'Bao gia Q2: mot bao gia cua mot co hoi (ma BG-0001). is_primary = dang theo duoi (toi da 1 / co hoi).';
COMMENT ON TABLE  quote_version                         IS 'Bao gia Q2: phien ban; moi thu tren ban in doc tu day + quote_line. Sau khi gui: khoa noi dung (fn_quote_version_guard).';
COMMENT ON TABLE  quote_line                            IS 'Bao gia Q2: dong hang (ITEM) / dong tieu de nhom (SECTION). Chi sua khi phien ban cha la nhap.';
COMMENT ON COLUMN quote_version.accepted_opportunity_id IS 'CHI do trigger xac lap = quote.opportunity_id khi ACCEPTED, NULL khi khac (R-Q14). Chi muc duy nhat U-4: toi da 1 phien ban duoc chap nhan / co hoi.';
COMMENT ON COLUMN quote_version.created_by              IS 'Nguoi tao phien ban (do may chu dat tu phien dang nhap); bat bien (R-Q13); quyet dinh ai thay gia von.';
COMMENT ON COLUMN quote_line.cost_price_vnd             IS 'Gia von MOT don vi, truoc VAT [QB23]; NULL = chua nhap; khong in, khong xuat; che o tang ung dung.';
COMMENT ON COLUMN quote_line.amount_vnd                 IS 'round(quantity * unit_price_vnd), 0,5 lam tron len (ck_ql_kind).';

-- 12. fn_auth_perm_class: xep them tien to "quote." vao nhom BIZ => SoD cua M1 cam vai tro `admin` giu ma quote.* (cung cach Sales S5, cung thu tu khoa:
--     bang permission, role_permission TRUOC, khoa tu van siscom.rbac SAU). TU CHOI neu da co vai tro admin giu ma quote.*.
DO $mig$
BEGIN
  IF to_regprocedure('public.fn_auth_perm_class(text)') IS NULL THEN
    RAISE EXCEPTION 'Bao gia Q2: thieu fn_auth_perm_class(text) (chua ap M1).';
  END IF;
  LOCK TABLE public.permission, public.role_permission IN SHARE ROW EXCLUSIVE MODE;
  PERFORM pg_advisory_xact_lock(hashtext('siscom.rbac'));
  IF EXISTS (SELECT 1 FROM public.role_permission rp JOIN public.permission p ON p.id = rp.permission_id JOIN public.role r ON r.id = rp.role_id
             WHERE r.code = 'admin' AND p.code ~ '^quote\.') THEN
    RAISE EXCEPTION 'TU CHOI: vai tro admin dang giu quyen quote.* - go qua yeu cau 2 nguoi truoc khi ap migration nay.';
  END IF;
  EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.fn_auth_perm_class(p_code text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, public AS $body$
  SELECT CASE
    WHEN p_code = 'access.approve' THEN 'APPROVE'
    WHEN p_code IN ('employee.manage', 'role.manage', 'auth.credential.manage', 'auth.reset.request', 'access.request') THEN 'REQUEST'
    WHEN p_code ~ '^(customer|contact|activity|interaction|approval|opportunity|quote)\.' THEN 'BIZ'
    ELSE 'OTHER' END $body$
  $fn$;
  EXECUTE $cm$COMMENT ON FUNCTION public.fn_auth_perm_class(text) IS 'B1.3 + Sales S5 + Bao gia Q2: phan loai quyen APPROVE/REQUEST/BIZ/OTHER cho SoD (BIZ gom opportunity.*, quote.*). Doi = migration moi.'$cm$;
END $mig$;
