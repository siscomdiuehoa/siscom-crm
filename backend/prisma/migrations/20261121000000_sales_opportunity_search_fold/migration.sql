-- SISCOM CRM Sales T-07 (20261121000000_sales_opportunity_search_fold). CHI CONG THEM, tuong thich nguoc: 2 cot SINH TU DONG (GENERATED ... STORED)
--   tren opportunity + 2 chi muc GIN trigram. Khong bang moi, khong CHECK moi, khong trigger moi, khong GRANT/REVOKE.
-- Muc dich: tim co hoi (GET /opportunities?q=, ca bang kanban va tab co hoi cua khach) KHONG PHAN BIET DAU tieng Viet va hoa/thuong:
--   "hoa phat" tim thay "Hoa Phat" co dau, "d" khop "d gach". Dung lai ham public.f_vn_fold (migration 20261012000000_b1_2_crm_core, A3) - CUNG
--   cach gap dau voi tim khach hang; tu khoa duoc gap bang CHINH ham nay o service (SELECT public.f_vn_fold(btrim($1))) nen hai ve luon khop nhau.
-- Cot sinh tu dong: PostgreSQL tu tinh khi INSERT/UPDATE title/project_name; ung dung KHONG ghi duoc (ghi gia tri khac DEFAULT => loi 428C9).
--   Hai cot rieng (khong ghep chuoi) => giu dung nghia cu "tieu de CHUA tu khoa HOAC ten du an CHUA tu khoa", khong khop lan qua ranh gioi hai truong.
-- Du lieu cu: KHONG UPDATE thu cong. ADD COLUMN ... GENERATED STORED VIET LAI BANG opportunity mot lan (khoa ACCESS EXCLUSIVE trong luc chay) va
--   tinh gia tri cho moi dong hien co (ke ca da xoa mem); bang opportunity tren production con nho => chay trong vai giay.
-- Quyen: KHONG GRANT/REVOKE. siscom_app co SELECT/INSERT/UPDATE muc BANG tren opportunity (APP_GRANTS_V5 muc 2c) => doc / loc duoc cot moi;
--   cot sinh tu dong thi khong role nao ghi duoc. Ham f_vn_fold / unaccent da duoc siscom_app goi khi tim khach hang.
-- Rollback viet san (KHONG tu chay): backend/docs/SALES_T07_SEARCH_FOLD_ROLLBACK.sql.txt. Da thu tren PostgreSQL tam cach ly. CHUA ap len database that nao.
ALTER TABLE "opportunity"
  ADD COLUMN "title_fold" TEXT GENERATED ALWAYS AS (public.f_vn_fold(title)) STORED,
  ADD COLUMN "project_name_fold" TEXT GENERATED ALWAYS AS (public.f_vn_fold(project_name)) STORED;

CREATE INDEX "ix_opportunity_title_fold" ON "opportunity" USING GIN ("title_fold" public.gin_trgm_ops);
CREATE INDEX "ix_opportunity_project_name_fold" ON "opportunity" USING GIN ("project_name_fold" public.gin_trgm_ops);

COMMENT ON COLUMN opportunity.title_fold IS 'Sales T-07: public.f_vn_fold(title) - cot sinh tu dong (chi doc) cho tim khong dau; chi muc ix_opportunity_title_fold.';
COMMENT ON COLUMN opportunity.project_name_fold IS 'Sales T-07: public.f_vn_fold(project_name) - cot sinh tu dong (chi doc) cho tim khong dau; chi muc ix_opportunity_project_name_fold.';
