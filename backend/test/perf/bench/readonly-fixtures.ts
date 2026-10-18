// B1.2.3-B2 P1 – nạp fixture CHỈ ĐỌC (thay cho ensureFixtures, vốn INSERT/UPSERT). Thiếu thì dừng; benchmark không tự tạo dữ liệu.
import type { PrismaService } from '../../../src/prisma/prisma.service';
import type { Fixtures } from '../../helpers/fixtures';

export async function loadFixturesReadOnly(prisma: PrismaService): Promise<Fixtures> {
  const miss: string[] = [];
  const items = await prisma.lookupItem.findMany({ where: { OR: [{ type: 'customer_tier' }, { type: 'customer_status' }, { type: 'industry', code: { in: ['IND_A', 'IND_B'] } }] }, select: { id: true, type: true, code: true } });
  const pick = (t: string): Record<string, string> => Object.fromEntries(items.filter((r) => r.type === t).map((r) => [r.code, r.id]));
  const tier = pick('customer_tier'); const status = pick('customer_status'); const industry = pick('industry');
  if (!tier.POTENTIAL) miss.push('customer_tier/POTENTIAL');
  if (!status.POTENTIAL) miss.push('customer_status/POTENTIAL');
  const depts = await prisma.department.findMany({ where: { code: { in: ['T_D1', 'T_D2'] } }, select: { id: true, code: true } });
  const d1 = depts.find((d) => d.code === 'T_D1')?.id; const d2 = depts.find((d) => d.code === 'T_D2')?.id;
  if (!d1) miss.push('department/T_D1'); if (!d2) miss.push('department/T_D2');
  const emps = await prisma.employee.findMany({ where: { fullName: { in: ['TEST NV A', 'TEST NV B', 'TEST NV C'] } }, select: { id: true, fullName: true, departmentId: true }, orderBy: { id: 'asc' } });
  const emp = (n: string, dep: string | undefined) => emps.find((e) => e.fullName === n && e.departmentId === dep)?.id;
  const empA = emp('TEST NV A', d1); const empB = emp('TEST NV B', d1); const empC = emp('TEST NV C', d2);
  if (!empA) miss.push('employee/TEST NV A (phòng T_D1)'); if (!empB) miss.push('employee/TEST NV B (phòng T_D1)'); if (!empC) miss.push('employee/TEST NV C (phòng T_D2)');
  if (miss.length) throw new Error('DB thử thiếu fixture: ' + miss.join(', ') + '. Benchmark KHÔNG tự tạo. Chạy một lần run-customers-tests.bat -Suite e2e trên DB này (đã nghiệm thu) rồi chạy lại.');
  return { d1: d1 as string, d2: d2 as string, empA: empA as string, empB: empB as string, empC: empC as string, tier, status, industry };
}
