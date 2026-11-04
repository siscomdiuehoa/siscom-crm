import { mapPrismaError } from '../src/common/errors/prisma-error.mapper';
import type { PrismaService } from '../src/prisma/prisma.service';
import { assertTestConnection, caught, createTestPrisma, sleep } from './helpers/test-db';
import { ensureFixtures, Fixtures, makeCustomer, uniq, uniqueTax } from './helpers/fixtures';

let prisma: PrismaService; let fx: Fixtures;
beforeAll(async () => {
  const c = createTestPrisma();
  prisma = c.prisma;
  await assertTestConnection(prisma, c.name);
  fx = await ensureFixtures(prisma);
});
afterAll(async () => { await prisma.$disconnect(); });

// 18. Kiểm chứng LỖI THẬT của Prisma 7 + adapter-pg (điều B-1 chưa biết): hình dạng lỗi có đủ để mapper nhận diện không?
// Nếu một ca dưới đây thất bại, in ra hình dạng lỗi thật để chỉnh mapper (không đoán).
function shape(e: unknown): string {
  const o = e as { code?: unknown; name?: unknown; meta?: unknown; message?: unknown };
  return JSON.stringify({ name: o.name, code: o.code, meta: o.meta, message: String(o.message ?? '').slice(0, 300) });
}
// Chỉ phát hiện thông tin DB nội bộ bị lộ. Mã lỗi nghiệp vụ công khai (UPPER_SNAKE như CUSTOMER_DUPLICATE_TAX_ID, CUSTOMER_BUSY) là hợp lệ và được loại trước khi dò.
// Định danh nội bộ của DB (chữ thường): tên ràng buộc/chỉ mục/trigger/hàm, tên bảng-cột, SQLSTATE, mã Prisma, thông điệp gốc của PostgreSQL.
const PUBLIC_CODE_RE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;
const INTERNAL_DB_RE = /\b(?:uq|ck|trg|fn|fk|idx|pk)_[a-z0-9_]+|\b[a-z0-9]+_(?:key|fkey|pkey|check)\b|\bpublic\.|\btax_id\b|\bcustomer_[a-z_]+|\bpostgres|\bprisma|\bviolates\b|\bduplicate key\b|\bsqlstate\b|\bP\d{4}\b|\b(?:23\d{3}|55P03)\b/i;
export function findInternalLeak(body: unknown): string | null {
  const text = JSON.stringify(body).replace(PUBLIC_CODE_RE, '');
  const m = INTERNAL_DB_RE.exec(text);
  return m ? m[0] : null;
}
function expectNoInternalLeak(body: unknown, publicCode: string): void {
  expect(JSON.stringify(body)).toContain(publicCode); // mã nghiệp vụ vẫn được trả về
  expect(findInternalLeak(body)).toBeNull();
}
describe('bộ dò rò rỉ thông tin nội bộ (tự kiểm)', () => {
  it('cho phép mã nghiệp vụ hợp lệ', () => {
    expect(findInternalLeak({ error: { code: 'CUSTOMER_DUPLICATE_TAX_ID' }, message: 'Mã số thuế đã tồn tại' })).toBeNull();
    expect(findInternalLeak({ error: { code: 'CUSTOMER_BUSY' }, message: 'Hệ thống đang bận' })).toBeNull();
  });
  it.each(['uq_customer_tax_id_active', 'ck_customer_phone_not_blank', 'trg_customer_code_immutable', 'customer_tax_id_key', 'public.customer', 'duplicate key value violates', 'P2002', '23505', 'PostgresError', 'PrismaClientKnownRequestError'])('phát hiện rò rỉ: %s', (leak) => {
    expect(findInternalLeak({ error: { code: 'CONSTRAINT_CONFLICT' }, message: 'x ' + leak })).not.toBeNull();
  });
});
async function expectMapped(p: Promise<unknown>, code: string): Promise<void> {
  const e = await caught(p);
  const m = mapPrismaError(e);
  if (!m || m.code !== code) throw new Error('mapPrismaError không nhận diện đúng (mong ' + code + '). Hình dạng lỗi thật: ' + shape(e));
  expectNoInternalLeak(m.getResponse(), m.code);
}

describe('18. ánh xạ lỗi DB thật', () => {
  const base = () => ({ name: 'Lỗi DB ' + uniq(), phone: '0903123456', tierId: fx.tier.POTENTIAL as string, statusId: fx.status.POTENTIAL as string, isDemo: true });
  it('unique MST (chỉ mục từng phần) -> CUSTOMER_DUPLICATE_TAX_ID', async () => {
    const tax = uniqueTax();
    await makeCustomer(prisma, fx, { taxId: tax });
    await expectMapped(prisma.customer.create({ data: { ...base(), taxId: tax } }), 'CUSTOMER_DUPLICATE_TAX_ID');
  });
  it('CHECK (điện thoại rỗng) -> CONSTRAINT_CONFLICT', async () => {
    await expectMapped(prisma.customer.create({ data: { ...base(), phone: '   ' } }), 'CONSTRAINT_CONFLICT');
  });
  it('04/11/2026: CHECK (không có phone nhưng có phone_e164) -> CONSTRAINT_CONFLICT; phone NULL hợp lệ', async () => {
    await expectMapped(prisma.customer.create({ data: { ...base(), phone: null, phoneE164: '+84903123456' } }), 'CONSTRAINT_CONFLICT');
    await expectMapped(prisma.customer.create({ data: { ...base(), phone: '' } }), 'CONSTRAINT_CONFLICT');
    const ok = await prisma.customer.create({ data: { ...base(), phone: null, phoneE164: null } });
    expect(ok.phone).toBeNull();
  });
  it('CHECK (MST sai định dạng) -> CONSTRAINT_CONFLICT', async () => {
    await expectMapped(prisma.customer.create({ data: { ...base(), taxId: '123' } }), 'CONSTRAINT_CONFLICT');
  });
  it('khoá ngoại (danh mục không tồn tại) -> CONSTRAINT_CONFLICT', async () => {
    await expectMapped(prisma.customer.create({ data: { ...base(), tierId: '00000000-0000-4000-8000-000000000000' } }), 'CONSTRAINT_CONFLICT');
  });
  it('trigger: danh mục ngừng dùng khi gán mới (foreign_key_violation) -> CONSTRAINT_CONFLICT', async () => {
    await expectMapped(prisma.customer.create({ data: { ...base(), tierId: fx.tier.LEGACY as string } }), 'CONSTRAINT_CONFLICT');
  });
  it('trigger: đổi mã khách đã phát hành (restrict_violation 23001) -> CONSTRAINT_CONFLICT', async () => {
    const c = await makeCustomer(prisma, fx);
    await expectMapped(prisma.customer.update({ where: { id: c.id }, data: { code: 'KH-99999' } }), 'CONSTRAINT_CONFLICT');
  });
  it('unique liên hệ chính (chỉ mục từng phần) -> CONTACT_PRIMARY_CONFLICT', async () => {
    const c = await makeCustomer(prisma, fx);
    await prisma.contact.create({ data: { customerId: c.id, fullName: 'Chính 1', phone: '0903123456', isPrimary: true } });
    await expectMapped(prisma.contact.create({ data: { customerId: c.id, fullName: 'Chính 2', phone: '0903123456', isPrimary: true } }), 'CONTACT_PRIMARY_CONFLICT');
  });
  it('CHECK (liên hệ không có SĐT lẫn email) -> CONSTRAINT_CONFLICT', async () => {
    const c = await makeCustomer(prisma, fx);
    await expectMapped(prisma.contact.create({ data: { customerId: c.id, fullName: 'Không liên lạc' } }), 'CONSTRAINT_CONFLICT');
  });
  it('lock_timeout (55P03) -> CUSTOMER_BUSY', async () => {
    const c = await makeCustomer(prisma, fx);
    const holder = prisma.$transaction(async (tx) => { await tx.$queryRaw`SELECT id FROM customer WHERE id = ${c.id}::uuid FOR UPDATE`; await sleep(2500); }, { timeout: 15000 });
    await sleep(500);
    const waiter = prisma.$transaction(async (tx) => { await tx.$executeRaw`SET LOCAL lock_timeout = '300ms'`; await tx.$queryRaw`SELECT id FROM customer WHERE id = ${c.id}::uuid FOR UPDATE`; });
    try { await expectMapped(waiter, 'CUSTOMER_BUSY'); } finally { await holder; }
  }, 30000);
  it('nhật ký chỉ thêm: UPDATE/DELETE audit_log bị trigger chặn', async () => {
    const row = await prisma.auditLog.create({ data: { actorType: 'SYSTEM', action: 'test.noop', entityType: 'test', summary: 'kiểm thử chỉ-thêm' }, select: { id: true } });
    const e = await caught(prisma.auditLog.update({ where: { id: row.id }, data: { summary: 'sửa' } }));
    expect(String((e as { message?: string }).message)).toBeTruthy();
    expect(await prisma.auditLog.count({ where: { id: row.id, summary: 'kiểm thử chỉ-thêm' } })).toBe(1);
  });
});
