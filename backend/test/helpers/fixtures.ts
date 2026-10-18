import type { PrismaService } from '../../src/prisma/prisma.service';

export interface Fixtures {
  d1: string; d2: string; empA: string; empB: string; empC: string;
  tier: Record<string, string>; status: Record<string, string>; industry: Record<string, string>;
}

let seq = 0;
const taxBase = 9000000000 + Math.floor(Math.random() * 800000000);
export const runId = Date.now().toString(36);
export const uniq = (): string => runId + '-' + String(++seq);
// MST hợp lệ (10 chữ số), khác nhau trong một lần chạy.
export const uniqueTax = (): string => String(taxBase + ++seq);

// Danh mục/nhân viên tối thiểu cho test. Chỉ chạy trên DB thử (đã kiểm tra trước đó). Idempotent: chạy lại không nhân đôi.
export async function ensureFixtures(prisma: PrismaService): Promise<Fixtures> {
  const items = [
    ['customer_tier', 'STRATEGIC', 'Chiến lược', 5, true], ['customer_tier', 'POTENTIAL', 'Tiềm năng', 10, true], ['customer_tier', 'VIP', 'VIP', 20, true], ['customer_tier', 'LEGACY', 'Cũ (ngừng dùng)', 30, false],
    ['customer_status', 'POTENTIAL', 'Tiềm năng', 10, true], ['customer_status', 'ACTIVE', 'Đang giao dịch', 20, true],
    ['industry', 'IND_A', 'Ngành A', 10, true], ['industry', 'IND_B', 'Ngành B', 20, true],
    ['source', 'SRC_A', 'Nguồn A', 10, true], ['province', 'PROV_A', 'Tỉnh A', 10, true],
  ] as const;
  await prisma.lookupItem.createMany({ data: items.map(([type, code, labelVi, sortOrder, isActive]) => ({ type, code, labelVi, sortOrder, isActive })), skipDuplicates: true });
  const rows = await prisma.lookupItem.findMany({ where: { OR: items.map(([type, code]) => ({ type, code })) }, select: { id: true, type: true, code: true } });
  const pick = (t: string): Record<string, string> => Object.fromEntries(rows.filter((r) => r.type === t).map((r) => [r.code, r.id]));
  const dept = async (code: string, name: string) => (await prisma.department.upsert({ where: { code }, create: { code, name }, update: {}, select: { id: true } })).id;
  const d1 = await dept('T_D1', 'Phòng thử 1');
  const d2 = await dept('T_D2', 'Phòng thử 2');
  const emp = async (fullName: string, departmentId: string) => {
    const ex = await prisma.employee.findFirst({ where: { fullName }, select: { id: true } });
    return ex ? ex.id : (await prisma.employee.create({ data: { fullName, departmentId, isDemo: true }, select: { id: true } })).id;
  };
  return { d1, d2, empA: await emp('TEST NV A', d1), empB: await emp('TEST NV B', d1), empC: await emp('TEST NV C', d2), tier: pick('customer_tier'), status: pick('customer_status'), industry: pick('industry') };
}

// Tạo khách trực tiếp bằng Prisma (bỏ qua API) để dựng trạng thái cho test.
export async function makeCustomer(prisma: PrismaService, fx: Fixtures, o: { name?: string; taxId?: string | null; ownerId?: string | null; deleted?: boolean; phone?: string; phoneE164?: string | null; tier?: string; status?: string; shortName?: string | null } = {}) {
  return prisma.customer.create({
    data: {
      name: o.name ?? 'KH thử ' + uniq(), shortName: o.shortName ?? null, taxId: o.taxId ?? null, phone: o.phone ?? '0903123456', phoneE164: o.phoneE164 === undefined ? '+84903123456' : o.phoneE164,
      ownerId: o.ownerId ?? null, tierId: fx.tier[o.tier ?? 'POTENTIAL'] as string, statusId: fx.status[o.status ?? 'POTENTIAL'] as string, isDemo: true,
      deletedAt: o.deleted ? new Date() : null, deletedById: o.deleted ? fx.empA : null, createdById: fx.empA, updatedById: fx.empA,
    },
    select: { id: true, code: true, version: true, name: true },
  });
}

export async function makeContact(prisma: PrismaService, customerId: string, fullName: string, isPrimary = false) {
  return prisma.contact.create({ data: { customerId, fullName, phone: '0912345678', isPrimary, isDemo: true }, select: { id: true, code: true } });
}
