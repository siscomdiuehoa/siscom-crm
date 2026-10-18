// B1.2.3-B2 P1 r5-A – kiểm chứng timeout giao dịch tương tác của Prisma 7 + adapter-pg trên DB THỬ. Chỉ chạy khi BENCH_TIMEOUT_PROBE=1 (cờ -TimeoutProbe).
// KHÔNG phải cơ chế rollback của kịch bản nghiệp vụ (các nhóm bài 6 rollback bằng ném lỗi chủ động). Chỉ KIỂM CHỨNG hành vi timeout.
// An toàn: T1 có ĐÚNG MỘT câu ghi (UPDATE 100 dòng PERF), gửi ngay đầu giao dịch, TRƯỚC hạn; sau đó chỉ SELECT. Không câu ghi nào sau hạn.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PrismaService } from '../../../src/prisma/prisma.service';
import { assertTestConnection, createTestPrisma } from '../../helpers/test-db';
import { loadFixturesReadOnly } from './readonly-fixtures';

const ON = process.env.BENCH_TIMEOUT_PROBE === '1';
const TX_MS = 2000; const MARK = '__probe_rollback__';
let prisma: PrismaService; let dbName = ''; let empB = ''; let before: Record<string, unknown> = {};
const report: Record<string, unknown> = { kind: 'B1.2.3-B2-P1-r5A-timeout-probe', startedAt: new Date().toISOString(), txTimeoutMs: TX_MS };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const ver = (pkg: string): string => { try { return (JSON.parse(readFileSync(join(process.cwd(), 'node_modules', pkg, 'package.json'), 'utf8')) as { version: string }).version; } catch { return 'không đọc được'; } };
const codeOf = (e: unknown): string | undefined => (e as { code?: string } | null)?.code;
const msgOf = (e: unknown): string => (e instanceof Error ? e.message.slice(0, 600) : String(e));
async function snapshot(): Promise<Record<string, unknown>> {
  const r = await prisma.$queryRaw<Record<string, unknown>[]>`SELECT
    (SELECT md5(string_agg(concat_ws('|', id, owner_id, deleted_at, deleted_by, tax_id, version, updated_at, tier_id, status_id, name, phone), ',' ORDER BY id)) FROM customer WHERE legacy_id LIKE 'PERF-%') AS perf_fingerprint,
    (SELECT count(*)::int FROM customer WHERE legacy_id LIKE 'PERF-%' AND (owner_id IS NOT NULL OR deleted_at IS NOT NULL OR deleted_by IS NOT NULL OR tax_id IS NOT NULL)) AS perf_modified_rows,
    (SELECT count(*)::int FROM customer) AS customer, (SELECT count(*)::int FROM contact) AS contact, (SELECT count(*)::int FROM lookup_item) AS lookup_item,
    (SELECT count(*)::int FROM department) AS department, (SELECT count(*)::int FROM employee) AS employee, (SELECT count(*)::int FROM audit_log) AS audit_log`;
  return r[0] ?? {};
}
const busyNow = async (): Promise<number> => (await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND state <> 'idle'`)[0]?.n ?? 0;
const waitIdle = async (limitMs: number): Promise<{ n: number; waited: number }> => { const t0 = Date.now(); let n = await busyNow(); while (n > 0 && Date.now() - t0 < limitMs) { await sleep(500); n = await busyNow(); } return { n, waited: Date.now() - t0 }; };

(ON ? describe : describe.skip)('B1.2.3-B2 P1 r5-A: timeout giao dịch Prisma (DB thử)', () => {
  beforeAll(async () => {
    const c = createTestPrisma(); prisma = c.prisma; dbName = c.name;
    const want = process.env.BENCH_EXPECT_DB;
    if (!want || want !== dbName) throw new Error('BENCH_EXPECT_DB phải trùng đúng tên database thử (' + dbName + '). Chạy qua scripts\\windows\\run-search-bench.bat -TimeoutProbe.');
    await assertTestConnection(prisma, dbName);
    empB = (await loadFixturesReadOnly(prisma)).empB; // chỉ đọc; thiếu fixture thì dừng
    const busy = await busyNow();
    if (busy > 0) throw new Error('Có ' + busy + ' phiên khác đang hoạt động trên DB thử. Dừng, KHÔNG ghi gì.');
    before = await snapshot();
    if (before.perf_modified_rows !== 0) throw new Error('DB thử đang có dữ liệu PERF bị chỉnh sẵn (' + String(before.perf_modified_rows) + ' dòng) -> không an toàn để kiểm chứng rollback. Dừng.');
    report.database = dbName; report.snapshotBefore = before;
    report.versions = { prismaClient: ver('@prisma/client'), adapterPg: ver('@prisma/adapter-pg'), pg: ver('pg'), node: process.version, postgres: (await prisma.$queryRaw<{ v: string }[]>`SHOW server_version`)[0]?.v };
  }, 120000);

  afterAll(async () => {
    const dir = process.env.PERF_REPORT_DIR ?? 'perf-report';
    mkdirSync(dir, { recursive: true });
    report.finishedAt = new Date().toISOString();
    const f = join(dir, 'timeout_probe_' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
    writeFileSync(f, JSON.stringify(report, null, 2));
    console.log('Báo cáo r5-A:', f);
    await prisma?.$disconnect();
  });

  it('T1: timeout hết hạn -> lỗi P2028 hợp lệ và rollback thật (ĐÚNG MỘT câu ghi, trước hạn; sau hạn chỉ SELECT)', async () => {
    const reasons: string[] = []; const selectMs: number[] = [];
    let completed = 0; let writeCount = -1; let inTx = -1; let writeDoneMs = -1; let errCode: string | undefined; let errMsg = ''; let errAtMs = -1; let outcome = 'NO_TIMEOUT_OBSERVED';
    const tStart = performance.now();
    try {
      await prisma.$transaction(async (tx) => {
        const t0 = performance.now();
        await tx.$executeRaw`SET LOCAL idle_in_transaction_session_timeout = '30s'`;
        // DUY NHẤT một câu ghi trong toàn bộ phép thử. Không có câu ghi nào sau thời điểm này.
        writeCount = await tx.$executeRaw`UPDATE customer SET owner_id = ${empB}::uuid WHERE legacy_id LIKE 'PERF-%' AND substr(legacy_id, 6)::int <= 100`;
        writeDoneMs = Math.round(performance.now() - t0);
        if (writeDoneMs > 1000) throw new Error(MARK + ':write-too-slow');
        inTx = Number((await tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM customer WHERE legacy_id LIKE 'PERF-%' AND owner_id = ${empB}::uuid`)[0]?.n);
        for (let i = 0; i < 6; i++) { const ts = performance.now(); await tx.$queryRaw`SELECT 1::int AS ok FROM pg_sleep(1)`; selectMs.push(Math.round(performance.now() - ts)); completed++; }
        throw new Error(MARK + ':no-timeout'); // chủ động rollback nếu timeout KHÔNG xảy ra (không bao giờ return bình thường -> không commit)
      }, { timeout: TX_MS, maxWait: 5000 });
    } catch (e) {
      errAtMs = Math.round(performance.now() - tStart); errMsg = msgOf(e); errCode = codeOf(e);
      outcome = errMsg.startsWith(MARK) ? (errMsg.includes('no-timeout') ? 'NO_TIMEOUT_OBSERVED' : 'WRITE_TOO_SLOW') : errCode === 'P2028' ? 'P2028' : 'OTHER_ERROR';
    }
    const idle1 = await waitIdle(60000);
    const after1 = await snapshot(); const eq1 = JSON.stringify(after1) === JSON.stringify(before);
    await sleep(3000); // bắt tác động muộn (ghi lạc ngoài giao dịch)
    const after2 = await snapshot(); const eq2 = JSON.stringify(after2) === JSON.stringify(before); const idle2 = await busyNow();
    if (outcome !== 'P2028') reasons.push('không quan sát được P2028: outcome=' + outcome + ', code=' + String(errCode) + ', thông điệp=' + errMsg);
    if (outcome === 'P2028' && !errMsg.includes(String(TX_MS))) reasons.push('thông điệp P2028 không nêu giới hạn ' + TX_MS + ' ms: ' + errMsg);
    if (outcome === 'P2028' && (errAtMs < TX_MS || errAtMs > 3500)) reasons.push('P2028 xuất hiện sau ' + errAtMs + ' ms, ngoài khoảng [' + TX_MS + ', 3500] ms');
    if (completed >= 6) reasons.push('cả 6 câu SELECT đều hoàn thành: giao dịch không bị chặn sau hạn');
    if (writeCount !== 100) reasons.push('câu ghi chạm ' + writeCount + ' dòng (kỳ vọng 100)');
    if (inTx !== 100) reasons.push('đọc lại trong giao dịch thấy ' + inTx + ' dòng (kỳ vọng 100): chưa chứng minh câu ghi có hiệu lực');
    if (writeDoneMs < 0 || writeDoneMs > 1000) reasons.push('câu ghi hoàn thành sau ' + writeDoneMs + ' ms (>1000): không bảo đảm trước hạn');
    if (idle1.n !== 0 || idle2 !== 0) reasons.push('còn phiên hoạt động sau phép thử (' + idle1.n + '/' + idle2 + ')');
    if (!eq1) reasons.push('dấu vân tay KHÁC ngay sau phép thử: rollback KHÔNG xác nhận');
    if (!eq2) reasons.push('dấu vân tay KHÁC sau thêm 3 s (tác động muộn)');
    if (after2.perf_modified_rows !== 0) reasons.push('còn ' + String(after2.perf_modified_rows) + ' dòng PERF bị chỉnh');
    report.t1 = { verdict: reasons.length ? 'FAIL' : 'PASS', reasons, outcome, errorCode: errCode, errorMessage: errMsg, errorAtMs: errAtMs, writeCount, inTxCountAfterWrite: inTx, writeDoneMs, completedSelects: completed, selectMs, idleAfter: { immediate: idle1.n, afterWait: idle2 }, fingerprintEqual: { immediate: eq1, after3s: eq2 }, snapshotAfter: after2 };
    if (reasons.length) throw new Error('T1 FAIL:\n' + reasons.join('\n'));
  }, 180000);

  it('T2 (chỉ quan sát, không PASS/FAIL): câu đang chạy có bị hủy khi hết hạn? Giao dịch CHỈ ĐỌC', async () => {
    const t2: Record<string, unknown> = {}; const tStart = performance.now();
    try {
      await prisma.$transaction(async (tx) => {
        const ts = performance.now();
        try { await tx.$queryRaw`SELECT 1::int AS ok FROM pg_sleep(5)`; t2.longStatement = { ok: true, ms: Math.round(performance.now() - ts) }; }
        catch (e) { t2.longStatement = { ok: false, ms: Math.round(performance.now() - ts), code: codeOf(e), message: msgOf(e) }; }
        const tn = performance.now();
        try { await tx.$queryRaw`SELECT 1::int AS ok`; t2.nextQuery = { ok: true, ms: Math.round(performance.now() - tn) }; }
        catch (e) { t2.nextQuery = { ok: false, ms: Math.round(performance.now() - tn), code: codeOf(e), message: msgOf(e) }; }
        throw new Error(MARK + ':t2');
      }, { timeout: TX_MS, maxWait: 5000 });
    } catch (e) { t2.finalError = { code: codeOf(e), message: msgOf(e) }; }
    t2.totalMs = Math.round(performance.now() - tStart);
    const ls = t2.longStatement as { ok: boolean; ms: number } | undefined; const nq = t2.nextQuery as { ok: boolean; code?: string } | undefined;
    t2.interpretation = ls?.ok && ls.ms >= 4500 ? 'Câu đang chạy KHÔNG bị hủy khi hết hạn (chạy trọn ~5 s). ' + (nq && !nq.ok && nq.code === 'P2028' ? 'Hết hạn chỉ lộ ra ở câu kế tiếp (P2028).' : 'Câu kế tiếp: ' + JSON.stringify(nq)) : 'Câu đang chạy bị ngắt hoặc lỗi: ' + JSON.stringify(ls);
    await waitIdle(60000);
    const same = JSON.stringify(await snapshot()) === JSON.stringify(before);
    t2.fingerprintEqual = same; report.t2 = t2;
    if (!same) throw new Error('T2 (chỉ đọc) làm dấu vân tay thay đổi -> dừng, kiểm tra DB thử.');
  }, 180000);
});
