import { Client } from 'pg';
import { PrismaService } from '../src/prisma/prisma.service';
import { adminTestDatabase, assertTestConnection, caught, createTestPrisma, testDatabase } from './helpers/test-db';

// B1.4 P3 — S1 TÁCH ROLE: siscom_migrator = chủ sở hữu (DDL, migrate), siscom_app = chỉ DML. Chạy khi TEST_MIGRATE_DATABASE_URL được đặt
// (CI sau khi áp B1.3_S1_ROLE_SPLIT + B1.3_S1_APP_GRANTS). Máy Windows chưa tách role: bỏ qua có lý do (không FAIL oan), kiểm bằng
// docs/B1.3_S1_VERIFY.sql.txt khi owner tách trên DB thử. Mọi thử DDL/ghi của app nằm trong transaction và ROLLBACK; không ghi dữ liệu.
const admin = process.env.TEST_MIGRATE_DATABASE_URL ? adminTestDatabase() : null;
const d = admin?.split ? describe : describe.skip;
let prisma: PrismaService; let name = '';

d('B1.4 P3 — S1 tách role: siscom_app chỉ DML, siscom_migrator chủ sở hữu', () => {
  beforeAll(async () => { const t = createTestPrisma(); prisma = t.prisma; name = t.name; await assertTestConnection(prisma, name); });
  afterAll(async () => { await prisma?.$disconnect(); });

  // Chạy một câu lệnh bằng kết nối pg THÔ của app trong transaction rồi ROLLBACK; trả SQLSTATE nếu bị từ chối, null nếu chạy được.
  async function appTry(sql: string): Promise<string | null> {
    const c = new Client({ connectionString: testDatabase().url });
    await c.connect();
    try {
      await c.query('BEGIN');
      try { await c.query(sql); return null; } catch (e) { return (e as { code?: string }).code ?? 'unknown'; } finally { await c.query('ROLLBACK'); }
    } finally { await c.end(); }
  }

  it('chủ sở hữu database và mọi bảng/sequence/hàm trong public là siscom_migrator; siscom_app không superuser', async () => {
    const r = await prisma.$queryRaw<{ db_owner: string; tables_not_migrator: bigint; seqs_not_migrator: bigint; funcs_not_migrator: bigint; app_super: boolean }[]>`
      SELECT (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()) AS db_owner,
             (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND pg_get_userbyid(c.relowner) <> 'siscom_migrator') AS tables_not_migrator,
             (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'S' AND pg_get_userbyid(c.relowner) <> 'siscom_migrator') AS seqs_not_migrator,
             (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND pg_get_userbyid(p.proowner) <> 'siscom_migrator'
                AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')) AS funcs_not_migrator,
             (SELECT rolsuper FROM pg_roles WHERE rolname = 'siscom_app') AS app_super`;
    expect(r[0].db_owner).toBe('siscom_migrator');
    expect(Number(r[0].tables_not_migrator)).toBe(0); expect(Number(r[0].seqs_not_migrator)).toBe(0); expect(Number(r[0].funcs_not_migrator)).toBe(0);
    expect(r[0].app_super).toBe(false);
  });

  it('siscom_app bị từ chối DDL (42501): DISABLE TRIGGER, DROP TRIGGER, CREATE TABLE, ADD COLUMN, CREATE OR REPLACE hàm trigger, GRANT', async () => {
    for (const sql of [
      'ALTER TABLE public.audit_log DISABLE TRIGGER ALL',
      'ALTER TABLE public.employee_credential DISABLE TRIGGER ALL',
      'DROP TRIGGER trg_audit_append_only ON public.audit_log',
      'CREATE TABLE public.s1_probe_should_fail (id int)',
      'ALTER TABLE public.customer ADD COLUMN s1_probe int',
      "CREATE OR REPLACE FUNCTION public.fn_block_mutation() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NULL; END $f$",
      // GRANT tự cấp KHÔNG nằm đây: PostgreSQL chỉ WARNING, không 42501 — kiểm hiệu quả ở ca "không tự nâng quyền" bên dưới (CI run 41006211486).
    ]) expect({ sql, code: await appTry(sql) }).toEqual({ sql, code: '42501' });
  });

  it('siscom_app không ghi được audit_log (UPDATE/DELETE/TRUNCATE) và _prisma_migrations; không gọi được fn_auth_bootstrap_close', async () => {
    for (const sql of [
      'UPDATE public.audit_log SET summary = summary WHERE false',
      'DELETE FROM public.audit_log WHERE false',
      'TRUNCATE public.audit_log',
      'DELETE FROM public._prisma_migrations WHERE false',
      'INSERT INTO public._prisma_migrations (id, checksum, migration_name, started_at, applied_steps_count) VALUES (gen_random_uuid()::text, \'x\', \'s1_probe\', now(), 0)',
      "SELECT public.fn_auth_bootstrap_close('s1-probe')",
    ]) expect({ sql, code: await appTry(sql) }).toEqual({ sql, code: '42501' });
  });

  it('siscom_app vẫn làm được việc của ứng dụng: INSERT/UPDATE bảng nghiệp vụ, 7 cột credential, nextval mã khách, extension, EXECUTE đổi mật khẩu, SET app.*', async () => {
    expect(await appTry('SELECT count(*) FROM public.customer')).toBeNull();
    expect(await appTry('UPDATE public.customer SET updated_at = updated_at WHERE false')).toBeNull();
    expect(await appTry('UPDATE public.contact SET is_primary = is_primary WHERE false')).toBeNull();
    expect(await appTry('UPDATE public.customer_assignment SET ended_at = ended_at WHERE false')).toBeNull();
    expect(await appTry('UPDATE public.auth_session SET last_used_at = last_used_at, revoked_at = revoked_at WHERE false')).toBeNull();
    expect(await appTry('UPDATE public.employee_credential SET failed_count = failed_count, window_started_at = window_started_at, locked_until = locked_until, lock_level = lock_level, last_login_at = last_login_at, password_changed_at = password_changed_at, updated_at = updated_at WHERE false')).toBeNull();
    expect(await appTry("INSERT INTO public.audit_log (actor_type, action, entity_type, summary) SELECT 'SYSTEM', 's1', 's1', 's1' WHERE false")).toBeNull();
    expect(await appTry("SELECT nextval('public.customer_code_seq')")).toBeNull(); // trong transaction ROLLBACK: không tiêu mã thật về mặt dữ liệu ứng dụng
    expect(await appTry("SELECT f_vn_fold('Nguyễn'), similarity('a', 'b')")).toBeNull();
    expect(await appTry("SET LOCAL app.actor_employee_id = '00000000-0000-4000-8000-000000000000'")).toBeNull();
    const r = await prisma.$queryRaw<{ chpw: boolean; api_total: bigint; api_ok: bigint; close_ok: boolean; pub_api: bigint; set_app: boolean; set_mig: boolean }[]>`
      SELECT has_function_privilege('siscom_app', 'public.fn_auth_api_change_own_password(uuid, integer, text, text, jsonb)', 'EXECUTE') AS chpw,
             (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\\_auth\\_api\\_%') AS api_total,
             (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\\_auth\\_api\\_%' AND has_function_privilege('siscom_app', p.oid, 'EXECUTE')) AS api_ok,
             has_function_privilege('siscom_app', 'public.fn_auth_bootstrap_close(text)', 'EXECUTE') AS close_ok,
             (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\\_auth\\_api\\_%' AND has_function_privilege('public', p.oid, 'EXECUTE')) AS pub_api,
             has_parameter_privilege('siscom_app', 'app.actor_employee_id', 'SET') AS set_app,
             has_parameter_privilege('siscom_migrator', 'app.actor_employee_id', 'SET') AS set_mig`;
    // P3b: app chỉ EXECUTE đúng 1 hàm (đổi mật khẩu của chính mình); các fn_auth_api_* còn lại chỉ người vận hành gọi qua migrator.
    expect(r[0].chpw).toBe(true); expect(Number(r[0].api_total)).toBeGreaterThanOrEqual(13); expect(Number(r[0].api_ok)).toBe(1);
    expect(r[0].close_ok).toBe(false); expect(Number(r[0].pub_api)).toBe(0); expect(r[0].set_app).toBe(true); expect(r[0].set_mig).toBe(true);
  });

  it('P3b (S2/S3): siscom_app bị từ chối 42501 khi ghi thẳng bí mật/quyền — password_hash, token_version, must_change_password, employee_role, privileged_change_request, reset token, app_meta, DELETE, setval', async () => {
    for (const sql of [
      'UPDATE public.employee_credential SET password_hash = password_hash WHERE false',
      'UPDATE public.employee_credential SET token_version = token_version WHERE false',
      'UPDATE public.employee_credential SET must_change_password = must_change_password WHERE false',
      'INSERT INTO public.employee_credential (employee_id) SELECT gen_random_uuid() WHERE false',
      'INSERT INTO public.employee_role (employee_id, role_id) SELECT gen_random_uuid(), gen_random_uuid() WHERE false',
      'DELETE FROM public.employee_role WHERE false',
      'INSERT INTO public.privileged_change_request (id) SELECT gen_random_uuid() WHERE false',
      'UPDATE public.privileged_change_request SET status = status WHERE false',
      'INSERT INTO public.password_reset_token (id) SELECT gen_random_uuid() WHERE false',
      "INSERT INTO public.app_meta (key, value) SELECT 's1', 's1' WHERE false",
      'UPDATE public.employee SET full_name = full_name WHERE false',
      "INSERT INTO public.lookup_item (type, code, label_vi) SELECT 'x', 'x', 'x' WHERE false",
      'DELETE FROM public.customer WHERE false',
      'DELETE FROM public.contact WHERE false',
      "SELECT setval('public.customer_code_seq', 1, false)",
    ]) expect({ sql, code: await appTry(sql) }).toEqual({ sql, code: '42501' });
    // Gọi thử fn_auth_api_request_create không phân biệt được: dù có EXECUTE, hàm vẫn RAISE insufficient_privilege khi actor sai.
    // Vì vậy kiểm ACL trực tiếp cho 3 hàm nhạy cảm nhất (tạo yêu cầu đặc quyền, cấp vai trò, đặt lại mật khẩu người khác).
    const fn = await prisma.$queryRaw<{ f: string; ok: boolean }[]>`
      SELECT f, has_function_privilege('siscom_app', f, 'EXECUTE') AS ok FROM unnest(ARRAY[
        'public.fn_auth_api_request_create(uuid, public.privileged_change_type, uuid, uuid, jsonb, integer)',
        'public.fn_auth_api_role_grant(uuid, uuid)',
        'public.fn_auth_api_reset_password(uuid, text, text, text, jsonb)']) AS f`;
    expect(fn).toEqual(fn.map((x) => ({ f: x.f, ok: false })));
  });

  it('siscom_app không tự nâng quyền: GRANT cho chính mình (PostgreSQL chỉ WARNING, không lỗi) KHÔNG có hiệu lực; đổi chủ sở hữu/role/SET ROLE bị 42501', async () => {
    // GRANT bởi role không sở hữu và không có grant option: PostgreSQL trả "no privileges were granted" (WARNING) và thoát 0 —
    // nên kiểm HIỆU QUẢ (quyền sau đó vẫn không có), không kiểm mã lỗi. Thử ngoài transaction để chắc không có gì "dính" lại.
    const c = new Client({ connectionString: testDatabase().url });
    await c.connect();
    try {
      const before = (await c.query<{ u: boolean; d: boolean; s: boolean; f: boolean }>(
        "SELECT has_table_privilege('siscom_app','public.audit_log','UPDATE') AS u, has_table_privilege('siscom_app','public.audit_log','DELETE') AS d, has_schema_privilege('siscom_app','public','CREATE') AS s, has_function_privilege('siscom_app','public.fn_auth_bootstrap_close(text)','EXECUTE') AS f")).rows[0];
      expect(before).toEqual({ u: false, d: false, s: false, f: false });
      for (const sql of [
        'GRANT UPDATE ON public.audit_log TO siscom_app',
        'GRANT DELETE ON public.audit_log TO siscom_app WITH GRANT OPTION',
        'GRANT CREATE ON SCHEMA public TO siscom_app',
        'GRANT EXECUTE ON FUNCTION public.fn_auth_bootstrap_close(text) TO siscom_app',
      ]) { try { await c.query(sql); } catch { /* bị từ chối cũng được; điều cần kiểm là quyền sau đó */ } }
      const after = (await c.query<{ u: boolean; d: boolean; s: boolean; f: boolean }>(
        "SELECT has_table_privilege('siscom_app','public.audit_log','UPDATE') AS u, has_table_privilege('siscom_app','public.audit_log','DELETE') AS d, has_schema_privilege('siscom_app','public','CREATE') AS s, has_function_privilege('siscom_app','public.fn_auth_bootstrap_close(text)','EXECUTE') AS f")).rows[0];
      expect(after).toEqual({ u: false, d: false, s: false, f: false });
      // Và thật sự vẫn không ghi được nhật ký sau khi "GRANT" (không chỉ catalog nói vậy)
      let code: string | null = null;
      try { await c.query('UPDATE public.audit_log SET summary = summary WHERE false'); } catch (e) { code = (e as { code?: string }).code ?? 'unknown'; }
      expect(code).toBe('42501');
    } finally { await c.end(); }
    for (const sql of [
      'ALTER TABLE public.audit_log OWNER TO siscom_app',
      'GRANT siscom_migrator TO siscom_app',
      'SET ROLE siscom_migrator',
      'ALTER ROLE siscom_app SUPERUSER',
      'CREATE ROLE s1_probe_role',
      'ALTER DATABASE "' + name + '" OWNER TO siscom_app',
    ]) expect({ sql, code: await appTry(sql) }).toEqual({ sql, code: '42501' });
  });

  it('qua Prisma (pool của ứng dụng) DDL cũng bị từ chối, lỗi mang mã 42501 và không làm hỏng pool (truy vấn sau vẫn chạy)', async () => {
    const e = await caught(prisma.$executeRaw`ALTER TABLE public.audit_log DISABLE TRIGGER ALL`);
    expect(JSON.stringify(e)).toContain('42501');
    expect((await prisma.$queryRaw<{ ok: number }[]>`SELECT 1 AS ok`)[0].ok).toBe(1);
  });

  it('kết nối chủ sở hữu (TEST_MIGRATE_DATABASE_URL) là siscom_migrator, không superuser, cùng database; migrator không bypass được trigger audit_log', async () => {
    const c = new Client({ connectionString: admin!.url });
    await c.connect();
    try {
      const r = await c.query<{ u: string; db: string; su: boolean }>('SELECT current_user AS u, current_database() AS db, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS su');
      expect(r.rows[0]).toEqual({ u: 'siscom_migrator', db: name, su: false });
      // Chủ sở hữu vẫn bị trigger B7 chặn sửa nhật ký (lớp bảo vệ còn lại trong DB); S1 chỉ bỏ khả năng "tắt trigger" khỏi ứng dụng.
      // Đếm TRƯỚC khi mở transaction: sau một lệnh bị từ chối, transaction ở trạng thái aborted (25P02) nên không truy vấn thêm được
      // (CI run 41006211486: "current transaction is aborted"). Có dòng nhật ký (bootstrap đã ghi) => UPDATE phải bị trigger chặn.
      const any = (await c.query<{ n: string }>('SELECT count(*)::text AS n FROM public.audit_log')).rows[0].n;
      expect(Number(any)).toBeGreaterThan(0);
      await c.query('BEGIN');
      let code: string | null = null;
      try { await c.query("UPDATE public.audit_log SET summary = 's1' WHERE id = (SELECT id FROM public.audit_log LIMIT 1)"); } catch (e) { code = (e as { code?: string }).code ?? 'unknown'; }
      finally { await c.query('ROLLBACK'); }
      expect(code).not.toBeNull();
      // Chủ sở hữu (migrator) vẫn tắt được trigger — vì vậy migrator chỉ dùng cho migrate/runbook, không bao giờ là DATABASE_URL của
      // backend; kiểm rằng app không phải thành viên của migrator (không thể SET ROLE sang).
      const m = await c.query<{ member: boolean }>("SELECT pg_has_role('siscom_app', 'siscom_migrator', 'MEMBER') AS member");
      expect(m.rows[0].member).toBe(false);
    } finally { await c.end(); }
  });
});
