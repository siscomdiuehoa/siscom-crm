-- SISCOM CRM Sales S9b (20261120000000_sales_opportunity_document). CHI CONG THEM, tuong thich nguoc: 1 enum + 1 bang moi (opportunity_document) +
--   1 cot NULL tren opportunity (won_doc_file_name). Thiet ke: docs/SALES_DESIGN.md §6.14 [C10] (PR234-R1-FILES).
-- Muc dich: tai lieu cua co hoi CHI luu DUONG DAN Google Drive + TEN TEP (khong tai tep len CRM).
--   kind = TECHNICAL (ban ve, thong so, ho so ky thuat - moi nguoi xem duoc co hoi, ke ca Ky thuat theo viec) | COMMERCIAL (bao gia, hop dong, tai
--   lieu gia - CHI duong doc day du). Quyen xem theo kind kiem o service (opportunities.documents.service.ts), khong o DB.
--   Chung tu Thang van nam tren chinh co hoi (won_doc_*); bo sung won_doc_file_name de du "ten tep" theo C10.
-- Bang CHI THEM / XOA MEM, KHONG SUA: trigger chi cho phep DUNG MOT loai UPDATE - dat deleted_at/deleted_by/delete_reason cho dong chua xoa;
--   moi UPDATE khac, DELETE, TRUNCATE bi chan o DB.
-- Du lieu cu: KHONG UPDATE. won_doc_file_name NULL cho moi co hoi hien co (ke ca da Thang) - CHECK chi cam chuoi rong.
-- Quyen: siscom_app nhan SELECT theo quyen mac dinh (bang moi); INSERT + UPDATE cap o B1.3_S1_APP_GRANTS_V5.sql.txt muc 2c (co dieu kien
--   to_regclass) - cung PR. KHONG DELETE/TRUNCATE. Bang da them vao B1.3_S1_APP_SELECT_ALLOWLIST.sql.txt (bang nghiep vu, app doc).
-- Rollback viet san (KHONG tu chay; tu choi khi con dong tai lieu, ke ca da xoa mem, hoac con won_doc_file_name khac NULL):
--   backend/docs/SALES_S9_DOCUMENT_ROLLBACK.sql.txt. Da thu tren PostgreSQL tam cach ly. CHUA ap len database that nao.

-- CreateEnum
CREATE TYPE "opportunity_document_kind" AS ENUM ('TECHNICAL', 'COMMERCIAL');

-- AlterTable
ALTER TABLE "opportunity" ADD COLUMN "won_doc_file_name" VARCHAR(255);
ALTER TABLE "opportunity" ADD CONSTRAINT ck_opp_won_file_name CHECK (won_doc_file_name IS NULL OR btrim(won_doc_file_name) <> '');

-- CreateTable
CREATE TABLE "opportunity_document" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "opportunity_id" UUID NOT NULL,
    "kind" "opportunity_document_kind" NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "url" VARCHAR(1000) NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" UUID,
    "delete_reason" VARCHAR(500),

    CONSTRAINT "opportunity_document_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "opportunity_document_opportunity_id_idx" ON "opportunity_document"("opportunity_id");

-- AddForeignKey
ALTER TABLE "opportunity_document" ADD CONSTRAINT "opportunity_document_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunity_document" ADD CONSTRAINT "opportunity_document_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunity_document" ADD CONSTRAINT "opportunity_document_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK: ten tep khong rong; duong dan chi https va khong co khoang trang (cung mau ck_opp_won_url cua S2); xoa mem phai du nguoi xoa + ly do.
ALTER TABLE "opportunity_document"
  ADD CONSTRAINT ck_od_file_name CHECK (btrim(file_name) <> ''),
  ADD CONSTRAINT ck_od_url       CHECK (url ~ '^https://[^[:space:]]+$'),
  ADD CONSTRAINT ck_od_deleted   CHECK ((deleted_at IS NULL AND deleted_by IS NULL AND delete_reason IS NULL)
                                        OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND delete_reason IS NOT NULL AND btrim(delete_reason) <> ''));

-- Trigger: chi them / xoa mem. UPDATE hop le DUY NHAT = xoa mem mot dong chua xoa, khong doi cot nao khac. Khong khoi phuc (tao dong moi neu can).
CREATE OR REPLACE FUNCTION public.fn_opportunity_document_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Tai lieu % da xoa mem, khong sua duoc.', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.deleted_at IS NULL
     OR NEW.id IS DISTINCT FROM OLD.id OR NEW.opportunity_id IS DISTINCT FROM OLD.opportunity_id OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.file_name IS DISTINCT FROM OLD.file_name OR NEW.url IS DISTINCT FROM OLD.url
     OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Tai lieu co hoi % chi duoc them hoac xoa mem, khong sua.', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_opportunity_document_guard BEFORE UPDATE ON opportunity_document FOR EACH ROW EXECUTE FUNCTION public.fn_opportunity_document_guard();
CREATE TRIGGER trg_opportunity_document_no_delete BEFORE DELETE ON opportunity_document FOR EACH ROW EXECUTE FUNCTION public.fn_block_mutation();
CREATE TRIGGER trg_opportunity_document_no_truncate BEFORE TRUNCATE ON opportunity_document FOR EACH STATEMENT EXECUTE FUNCTION public.fn_block_mutation();

COMMENT ON TABLE opportunity_document IS 'Sales S9b: tai lieu co hoi - CHI duong dan https + ten tep (khong tai tep). Chi them / xoa mem (trg_opportunity_document_guard). Quyen xem theo kind kiem o service.';
COMMENT ON COLUMN opportunity.won_doc_file_name IS 'Sales S9b: ten tep cua chung tu Thang (C10). NULL voi co hoi cu / chua khai bao.';
