// P2-3b-0: phân trang danh sách (không tìm kiếm) sau khi đổi sang "lấy ID trước, nạp chi tiết sau" phải cho đúng kết quả của trang 1 (đường một truy vấn như cũ).
import type { PrismaService } from '../src/prisma/prisma.service';
import { as, makeApp, TestApp } from './helpers/test-app';
import { assertTestConnection, createTestPrisma } from './helpers/test-db';
import { ensureFixtures, Fixtures, makeCustomer, runId } from './helpers/fixtures';

const URL = '/api/v1/customers';
let prisma: PrismaService; let fx: Fixtures; let t: TestApp;
type Page = { items: { id: string }[]; total: number; totalPages: number };
const get = async (who: string, q: string): Promise<Page> => { const r = await as(t.app, who).get(URL + '?' + q); if (r.status !== 200) throw new Error('GET ' + q + ' -> ' + r.status); return r.body.data as Page; };

beforeAll(async () => {
  const c = createTestPrisma(); prisma = c.prisma;
  await assertTestConnection(prisma, c.name);
  fx = await ensureFixtures(prisma);
  t = await makeApp(prisma, fx);
  for (let i = 0; i < 30; i++) await makeCustomer(prisma, fx, { name: 'Danh sách trang ' + runId + ' ' + i, ownerId: i % 3 === 0 ? fx.empA : i % 3 === 1 ? fx.empB : null });
}, 120000);
afterAll(async () => { await t.app.close(); await prisma.$disconnect(); });

describe('P2-3b-0: danh sách phân trang sâu khớp trang 1', () => {
  const sorts: [string, string][] = [['createdAt', 'desc'], ['name', 'asc'], ['tier', 'asc'], ['status', 'desc'], ['code', 'asc'], ['updatedAt', 'desc']];
  it('các trang 10 dòng ghép lại = 40 dòng đầu của một trang lớn (mọi sort), tổng giống nhau; trang vượt cuối rỗng, tổng đúng', async () => {
    for (const who of ['all', 'ownA', 'deptA']) for (const [sortBy, sortOrder] of sorts) {
      const q = 'sortBy=' + sortBy + '&sortOrder=' + sortOrder;
      const big = await get(who, q + '&pageSize=40&page=1');
      const want = big.items.length;
      const got: string[] = []; let total = -1;
      for (let p = 1; p <= Math.ceil(want / 10); p++) { const pg = await get(who, q + '&pageSize=10&page=' + p); got.push(...pg.items.map((i) => i.id)); total = pg.total; }
      expect({ who, sortBy, ids: got.slice(0, want) }).toEqual({ who, sortBy, ids: big.items.map((i) => i.id) });
      expect({ who, sortBy, total }).toEqual({ who, sortBy, total: big.total });
      const beyond = await get(who, q + '&pageSize=10&page=' + (Math.ceil(big.total / 10) + 1));
      expect(beyond.items).toEqual([]); expect(beyond.total).toBe(big.total);
    }
  }, 300000);
});
