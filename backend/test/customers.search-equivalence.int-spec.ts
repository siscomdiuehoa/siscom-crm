// P2-2: tương đương giữa đường UNION (V5) và đường OR cũ trên DB thử. So khớp tổng, TOÀN BỘ ID đúng thứ tự, trang đầu/giữa/cuối/vượt cuối.
import type { PrismaService } from '../src/prisma/prisma.service';
import { buildSearchCountQuery, buildSearchPageQuery, type SearchSort, type SearchWhereInput } from '../src/modules/customers/customers.search';
import { TestActorProvider } from './helpers/test-app';
import { assertTestConnection, createTestPrisma } from './helpers/test-db';
import { ensureFixtures, Fixtures, makeContact, makeCustomer, runId, uniqueTax } from './helpers/fixtures';
import type { Scope } from '../src/common/auth/actor';

let prisma: PrismaService; let fx: Fixtures; let base: Omit<SearchWhereInput, 'actor' | 'readScope'>[]; 
const m = runId; const tax = uniqueTax();
const actors: { who: string; actor: SearchWhereInput['actor']; readScope: Scope | null }[] = [];
const SORTS: SearchSort[] = [{ sortBy: 'relevance', order: 'desc' }, { sortBy: 'relevance', order: 'asc' }, { sortBy: 'createdAt', order: 'desc' }, { sortBy: 'name', order: 'asc' }, { sortBy: 'code', order: 'asc' }];
const PS = 7;
const phones = ['0912 345 0', '0912345', '+84912345', '912345'];

async function fold(s: string): Promise<string> { return (await prisma.$queryRaw<{ t: string }[]>`SELECT public.f_vn_fold(btrim(${s})) AS t`)[0]?.t ?? ''; }
async function runPath(p: SearchWhereInput, path: 'or' | 'union', sort: SearchSort, page: number): Promise<{ ids: string[]; total: number }> {
  const rows = await prisma.$queryRaw<{ id: string; total: number }[]>(buildSearchPageQuery(p, path, sort, PS, (page - 1) * PS));
  let total = rows.length ? Number(rows[0]?.total) : 0;
  if (!rows.length && page > 1) total = Number((await prisma.$queryRaw<{ n: number }[]>(buildSearchCountQuery(p, path)))[0]?.n);
  return { ids: rows.map((r) => r.id), total };
}
async function compare(p: SearchWhereInput, label: string): Promise<number> {
  let compared = 0;
  for (const sort of SORTS) {
    if (sort.sortBy === 'relevance' && false) continue;
    const first = await runPath(p, 'or', sort, 1);
    const pages = Math.max(1, Math.ceil(first.total / PS));
    for (const page of new Set([1, 2, pages, pages + 1])) {
      const o = await runPath(p, 'or', sort, page); const u = await runPath(p, 'union', sort, page);
      const tag = label + ' sort=' + sort.sortBy + '/' + sort.order + ' page=' + page;
      expect({ tag, total: u.total }).toEqual({ tag, total: o.total });
      expect({ tag, ids: u.ids }).toEqual({ tag, ids: o.ids });
      compared++;
    }
  }
  return compared;
}

beforeAll(async () => {
  const c = createTestPrisma(); prisma = c.prisma;
  await assertTestConnection(prisma, c.name);
  fx = await ensureFixtures(prisma);
  const prov = new TestActorProvider(fx);
  for (const [who, v] of Object.entries(prov.presets)) actors.push({ who, actor: v.actor, readScope: (v.scopes['customer.read'] as Scope | undefined) ?? null });
  actors.push({ who: 'none', actor: actors[0]!.actor, readScope: null });
  const c1 = await makeCustomer(prisma, fx, { name: 'Công ty TNHH Điện Lạnh Thành Đạt ' + m, phone: '0912 345 001', phoneE164: '+84912345001' });
  await makeCustomer(prisma, fx, { name: 'Cty CP Xây dựng Bình Minh ' + m, taxId: tax });
  const c3 = await makeCustomer(prisma, fx, { name: 'Thương mại Đại Việt ' + m }); await makeContact(prisma, c3.id, 'Trần Văn Bình ' + m);
  await makeCustomer(prisma, fx, { name: 'Khách của B ' + m, ownerId: fx.empB, phone: '0912 345 002', phoneE164: '+84912345002' });
  await makeCustomer(prisma, fx, { name: 'Khách đã xóa ' + m, deleted: true });
  for (let i = 0; i < 20; i++) await makeCustomer(prisma, fx, { name: 'Công ty phân trang ' + m + ' số ' + i, ownerId: i % 2 ? fx.empB : null });
  void c1; base = [];
}, 120000);
afterAll(async () => { await prisma.$disconnect(); });

describe('P2-2: UNION (V5) tương đương OR', () => {
  const kws = (): string[] => [m, 'phan trang ' + m, 'dien lanh thanh dat ' + m, 'tran van binh ' + m, 'xay dung binh minh ' + m, tax, 'cong ty', 'khach', 'dai viet', 'khong-co-ket-qua-' + m, ...phones];
  it('mọi từ khóa × quyền đọc × sort × trang (đầu/2/cuối/vượt cuối): tổng, ID, thứ tự khớp', async () => {
    let n = 0;
    for (const k of kws()) {
      const folded = await fold(k);
      for (const a of actors) n += await compare({ actor: a.actor, folded, raw: k, deletedOnly: false, readScope: a.readScope, restoreScope: null, ids: {} }, k + ' @' + a.who);
    }
    console.log('P2-2 tương đương: ' + n + ' phép so khớp UNION vs OR');
    expect(n).toBeGreaterThan(300);
  }, 600000);
  it('ownerId + deleted=only: đường OR vẫn đúng và UNION bị từ chối', async () => {
    const a = actors[0]!; const folded = await fold(m);
    const p: SearchWhereInput = { actor: a.actor, folded, raw: m, deletedOnly: true, readScope: 'ALL', restoreScope: 'ALL', ids: {} };
    const r = await runPath(p, 'or', SORTS[2]!, 1);
    expect(r.total).toBeGreaterThanOrEqual(1);
    await expect(runPath(p, 'union', SORTS[2]!, 1)).rejects.toThrow();
    const q: SearchWhereInput = { actor: a.actor, folded, raw: m, deletedOnly: false, readScope: 'ALL', restoreScope: null, ownerId: fx.empB, ids: {} };
    const o = await runPath(q, 'or', SORTS[2]!, 1); const u = await runPath(q, 'union', SORTS[2]!, 1);
    expect(u).toEqual(o); expect(o.total).toBeGreaterThan(0);
  }, 120000);
});
