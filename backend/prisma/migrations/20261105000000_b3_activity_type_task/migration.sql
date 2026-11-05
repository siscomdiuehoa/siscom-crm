-- SISCOM CRM B3 A2 (20261105000000_b3_activity_type_task). CHI CONG THEM: 1 gia tri enum 'TASK' cho activity_type.
-- Thiet ke: docs/B3_ACTIVITIES_DESIGN.md §3.2 #1 (OWNER_DECISION 03-04/11/2026; A2 duyet 04/11/2026).
-- PHAI la migration RIENG: PostgreSQL khong cho dung gia tri enum vua ADD VALUE trong cung transaction (55P04); Prisma gui ca file
--   nhu mot khoi giao dich ngam => file nay KHONG duoc chua cau nao tham chieu 'TASK' (ke ca DO $$ kiem tra). Migration ke tiep
--   20261105000100_b3_activity_tasks moi dung 'TASK'. IF NOT EXISTS de migrate deploy lai sau rollback khong loi 42710.
-- Tuong thich nguoc: dong cu khong doi; backend ban cu khong biet 'TASK' (khong ghi).
-- Quyen: khong GRANT/REVOKE. Rollback viet san (KHONG tu chay; tao lai enum 5 gia tri): backend/docs/B3_ACTIVITY_TASKS_ROLLBACK.sql.txt.
-- Da thu tren PostgreSQL tam cach ly. CHUA ap len database that nao.
ALTER TYPE "activity_type" ADD VALUE IF NOT EXISTS 'TASK';
