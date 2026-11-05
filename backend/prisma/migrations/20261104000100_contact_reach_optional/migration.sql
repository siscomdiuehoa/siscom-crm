-- OWNER APPROVAL 04/11/2026 (PR #203) - CONTACT NAME WITHOUT PHONE: nguoi lien he chi can ho ten; so dien thoai/email KHONG bat buoc.
-- Chi NOI LONG: bo CHECK ck_contact_reach (bat buoc co phone hoac email). Khong UPDATE du lieu, khong tao so/email gia.
-- ck_contact_name (ho ten khong rong) giu nguyen. Dinh dang phone/email van kiem o tang ung dung khi co gia tri.
-- Rollback: backend/docs/CONTACT_REACH_OPTIONAL_ROLLBACK.sql.txt (tu choi neu da co nguoi lien he khong co phone lan email).

ALTER TABLE contact DROP CONSTRAINT ck_contact_reach;

COMMENT ON COLUMN contact.phone IS 'So dien thoai nguoi lien he; NULL = khong co (khong bat buoc tu 04/11/2026).';
