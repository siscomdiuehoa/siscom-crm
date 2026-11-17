import type { PrismaService } from '../../src/prisma/prisma.service';
import { createAdminTestPrisma } from './test-db';

export interface Fixtures {
  d1: string; d2: string; empA: string; empB: string; empC: string;
  tier: Record<string, string>; status: Record<string, string>; industry: Record<string, string>;
  // Sales S6: danh mục thử cho cơ hội (mã riêng của test, không phải danh mục thật của S4).
  oppType: Record<string, string>; oppStage: Record<string, string>; oppLostReason: Record<string, string>;
}

let seq = 0;
const taxBase = 9000000000 + Math.floor(Math.random() * 800000000);
export const runId = Date.now().toString(36);
export const uniq = (): string => runId + '-' + String(++seq);
// MST hợp lệ (10 chữ số), khác nhau trong một lần chạy.
export const uniqueTax = (): string => String(taxBase + ++seq);

// Danh mục/nhân viên tối thiểu cho test. Chỉ chạy trên DB thử (đã kiểm tra trước đó). Idempotent: chạy lại không nhân đôi.
// B1.4 P3b: lookup_item / department / employee là dữ liệu "nền" do người vận hành nạp (seed, bootstrap) — siscom_app KHÔNG còn quyền
// ghi. Vì vậy ghi bằng kết nối CHỦ SỞ HỮU (TEST_MIGRATE_DATABASE_URL khi đã tách role; rơi về app khi chưa tách). Đọc vẫn bằng app.
export async function withAdmin<T>(fn: (admin: PrismaService) => Promise<T>): Promise<T> {
  const a = createAdminTestPrisma();
  try { return await fn(a.prisma); } finally { await a.prisma.$disconnect(); }
}
// Tạo nhân viên thử (dữ liệu nền) bằng kết nối chủ sở hữu.
export async function makeEmployee(data: { fullName: string; departmentId: string; status?: 'ACTIVE' | 'RESIGNED'; deletedAt?: Date | null }): Promise<{ id: string }> {
  return withAdmin((admin) => admin.employee.create({ data: { fullName: data.fullName, departmentId: data.departmentId, isDemo: true, status: data.status ?? 'ACTIVE', deletedAt: data.deletedAt ?? null }, select: { id: true } }));
}
export async function ensureFixtures(prisma: PrismaService): Promise<Fixtures> {
  const items = [
    ['customer_tier', 'STRATEGIC', 'Chiến lược', 5, true], ['customer_tier', 'POTENTIAL', 'Tiềm năng', 10, true], ['customer_tier', 'VIP', 'VIP', 20, true], ['customer_tier', 'LEGACY', 'Cũ (ngừng dùng)', 30, false],
    ['customer_status', 'POTENTIAL', 'Tiềm năng', 10, true], ['customer_status', 'ACTIVE', 'Đang giao dịch', 20, true],
    ['industry', 'IND_A', 'Ngành A', 10, true], ['industry', 'IND_B', 'Ngành B', 20, true],
    ['source', 'SRC_A', 'Nguồn A', 10, true], ['province', 'PROV_A', 'Tỉnh A', 10, true],
    ['opportunity_type', 'T_SUPPLY', 'Cung cấp (thử)', 10, true], ['opportunity_type', 'T_INSTALL', 'Thi công (thử)', 20, true],
    ['opportunity_stage', 'T_APPROACH', 'Tiếp cận (thử)', 10, true], ['opportunity_stage', 'T_QUOTE', 'Báo giá (thử)', 30, true],
    ['opportunity_lost_reason', 'T_PRICE', 'Giá (thử)', 10, true],
    // Sales S7: MÃ THẬT của danh mục S4 (service ghi kiểm luật theo mã). Nếu lệnh seed S4 đã nạp thì skipDuplicates giữ nguyên dòng có sẵn.
    ['opportunity_stage', 'PROSPECTING', 'Tiếp cận', 10, true], ['opportunity_stage', 'SURVEY', 'Khảo sát', 20, true],
    ['opportunity_stage', 'QUOTATION', 'Báo giá', 30, true], ['opportunity_stage', 'NEGOTIATION', 'Đàm phán', 40, true],
    ['opportunity_type', 'SUPPLY', 'Cung cấp thiết bị, vật tư', 10, true], ['opportunity_type', 'INSTALLATION', 'Thi công', 20, true],
    ['opportunity_type', 'SUPPLY_INSTALLATION', 'Cung cấp và thi công', 30, true],
  ] as const;
  const { d1, d2, empA, empB, empC } = await withAdmin(async (admin) => {
    await admin.lookupItem.createMany({ data: items.map(([type, code, labelVi, sortOrder, isActive]) => ({ type, code, labelVi, sortOrder, isActive })), skipDuplicates: true });
    const dept = async (code: string, name: string) => (await admin.department.upsert({ where: { code }, create: { code, name }, update: {}, select: { id: true } })).id;
    const d1 = await dept('T_D1', 'Phòng thử 1');
    const d2 = await dept('T_D2', 'Phòng thử 2');
    const emp = async (fullName: string, departmentId: string) => {
      const ex = await admin.employee.findFirst({ where: { fullName }, select: { id: true } });
      return ex ? ex.id : (await admin.employee.create({ data: { fullName, departmentId, isDemo: true }, select: { id: true } })).id;
    };
    return { d1, d2, empA: await emp('TEST NV A', d1), empB: await emp('TEST NV B', d1), empC: await emp('TEST NV C', d2) };
  });
  const rows = await prisma.lookupItem.findMany({ where: { OR: items.map(([type, code]) => ({ type, code })) }, select: { id: true, type: true, code: true } });
  const pick = (t: string): Record<string, string> => Object.fromEntries(rows.filter((r) => r.type === t).map((r) => [r.code, r.id]));
  return { d1, d2, empA, empB, empC, tier: pick('customer_tier'), status: pick('customer_status'), industry: pick('industry'),
    oppType: pick('opportunity_type'), oppStage: pick('opportunity_stage'), oppLostReason: pick('opportunity_lost_reason') };
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

// Sales S6: tạo cơ hội trực tiếp bằng Prisma (bỏ qua API — S7 mới có API tạo) để dựng trạng thái cho test đọc. Pool nghiệp vụ ghi được opportunity (V5).
export async function makeOpportunity(prisma: PrismaService, fx: Fixtures, o: {
  customerId: string; ownerId: string; title?: string; status?: 'OPEN' | 'ON_HOLD' | 'WON' | 'LOST'; stage?: string; type?: string; contactId?: string | null;
  amount?: bigint | null; probability?: number; closeDate?: string | null; projectName?: string | null; deleted?: boolean; needSummary?: string | null;
}) {
  const status = o.status ?? 'OPEN';
  return prisma.opportunity.create({
    data: {
      customerId: o.customerId, ownerId: o.ownerId, title: o.title ?? 'CH thử ' + uniq(), typeId: fx.oppType[o.type ?? 'T_SUPPLY'] as string, stageId: fx.oppStage[o.stage ?? 'T_APPROACH'] as string,
      status, contactId: o.contactId ?? null, needSummary: o.needSummary ?? null,
      expectedAmountVnd: o.amount === undefined ? null : o.amount, probability: o.probability ?? 10,
      expectedCloseDate: o.closeDate ? new Date(o.closeDate + 'T00:00:00.000Z') : null,
      isProjectLinked: !!o.projectName, projectName: o.projectName ?? null, offerScope: o.projectName ? 'Phạm vi chào thử' : null,
      ...(status === 'ON_HOLD' ? { holdUntil: new Date('2027-01-15T00:00:00.000Z'), holdReason: 'Khách hoãn (thử)' } : {}),
      ...(status === 'WON' ? { wonAmountVnd: 5_000_000_000n, wonDocType: 'HOP_DONG' as const, wonDocNo: 'HD-THU-01', wonDocDate: new Date('2026-11-10T00:00:00.000Z'), wonDocUrl: 'https://drive.google.com/thu', closedAt: new Date() } : {}),
      ...(status === 'LOST' ? { lostReasonId: fx.oppLostReason['T_PRICE'] as string, lostNote: 'Ghi chú thua (thử)', closedAt: new Date() } : {}),
      ...(o.deleted ? { deletedAt: new Date(), deletedById: fx.empA, deleteReason: 'xoá thử' } : {}),
      isDemo: true, createdById: fx.empA, updatedById: fx.empA,
    },
    select: { id: true, code: true, version: true, title: true },
  });
}
