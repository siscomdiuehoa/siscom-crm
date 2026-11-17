// Sales S6 (PR241-R1-01, PR241-R1-02) — ĐỌC NHẤT QUÁN khi có kết nối khác ghi xen giữa các truy vấn của MỘT request.
// Đồng bộ RÕ RÀNG, không dùng khoảng ngủ: PrismaService của app được bọc bằng một "chốt" — ngay sau khi truy vấn chỉ định của request trả về
// (vd opportunity.findFirst), chốt chạy một thao tác ghi bằng KẾT NỐI THỨ HAI, chờ thao tác đó COMMIT xong rồi mới cho request chạy tiếp.
// Kỳ vọng: phản hồi nhất quán theo MỘT snapshot (dữ liệu cũ dưới quyền cũ) — không bao giờ ghép quyền cũ với dữ liệu mới; total khớp items.
// Bản trước khi sửa (86edb40) rớt các ca D1–D3, L1–L3, C1; xem PR #241 R2.
import type { PrismaService } from '../src/prisma/prisma.service';
import { as, makeApp, SALES, TestApp } from './helpers/test-app';
import { assertTestConnection, createTestPrisma } from './helpers/test-db';
import { ensureFixtures, Fixtures, makeContact, makeCustomer, makeOpportunity, uniq } from './helpers/fixtures';

const O = '/api/v1/opportunities';
const C = '/api/v1/customers/';
type Model = 'opportunity' | 'customer' | 'contact';
interface Gate { after?: { model: Model; op: string; run: () => Promise<void> }; fired: number }
const GATED: readonly Model[] = ['opportunity', 'customer', 'contact'];

// Bọc client (gốc và client trong transaction): sau khi <model>.<op> của request trả kết quả, chạy gate.after.run() MỘT lần rồi mới trả tiếp.
function gated(real: PrismaService, gate: Gate): PrismaService {
  const wrap = <T extends object>(client: T): T => new Proxy(client, {
    get(target, prop) {
      if (prop === '$transaction') {
        return (arg: unknown, opts?: unknown) => (target as unknown as { $transaction: (a: unknown, o?: unknown) => unknown })
          .$transaction(typeof arg === 'function' ? (tx: object) => (arg as (t: object) => unknown)(wrap(tx)) : arg, opts);
      }
      const value = Reflect.get(target, prop, target);
      if (typeof prop === 'string' && (GATED as readonly string[]).includes(prop)) {
        return new Proxy(value as object, {
          get(model, op) {
            const fn = Reflect.get(model, op, model);
            if (typeof fn !== 'function') return fn;
            return async (...args: unknown[]) => {
              const res = await (fn as (...a: unknown[]) => Promise<unknown>).apply(model, args);
              const g = gate.after;
              if (g && g.model === prop && g.op === op) { gate.after = undefined; gate.fired++; await g.run(); }
              return res;
            };
          },
        });
      }
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
  return wrap(real);
}

let prisma: PrismaService; let writer: PrismaService; let fx: Fixtures; let t: TestApp;
const gate: Gate = { fired: 0 };
const a = (who: string) => as(t.app, who);
// Đặt chốt: sau <model>.<op> đầu tiên của request kế tiếp, chạy `run` bằng kết nối `writer` (đã commit khi `run` trả về).
const arm = (model: Model, op: string, run: () => Promise<void>) => { gate.fired = 0; gate.after = { model, op, run }; };

beforeAll(async () => {
  const c = createTestPrisma(); prisma = c.prisma;
  await assertTestConnection(prisma, c.name);
  writer = createTestPrisma().prisma; // KẾT NỐI THỨ HAI: pool riêng, giao dịch riêng
  fx = await ensureFixtures(prisma);
  t = await makeApp(gated(prisma, gate), fx);
  t.access.scopes.set(fx.empA, SALES); t.access.scopes.set(fx.empB, SALES); t.access.scopes.set(fx.empC, SALES);
});
afterEach(() => { gate.after = undefined; gate.fired = 0; });
afterAll(async () => { await t.app.close(); await writer.$disconnect(); await prisma.$disconnect(); });

// Khách do A phụ trách, có cơ hội do B phụ trách => A đọc được cơ hội CHỈ NHỜ phụ trách khách.
async function scene() {
  const tok = 's6c' + uniq().replace(/[^a-z0-9]/gi, '');
  const cust = await makeCustomer(prisma, fx, { ownerId: fx.empA, phone: '0900000001' });
  await prisma.customer.update({ where: { id: cust.id }, data: { address: 'Địa chỉ CŨ ' + tok } });
  const contact = await makeContact(prisma, cust.id, 'Liên hệ CŨ ' + tok);
  const opp = await makeOpportunity(prisma, fx, { customerId: cust.id, ownerId: fx.empB, title: 'S6C ' + tok + ' chính', contactId: contact.id });
  const opp2 = await makeOpportunity(prisma, fx, { customerId: cust.id, ownerId: fx.empA, title: 'S6C ' + tok + ' phụ' });
  return { tok, cust, contact, opp, opp2 };
}

describe('PR241-R1-01 — chi tiết: quyền và dữ liệu thẻ khách / liên hệ cùng một snapshot', () => {
  it('D1. chuyển chủ khách + đổi điện thoại/địa chỉ GIỮA lần đọc cơ hội và lần đọc thẻ khách => không trả dữ liệu MỚI dưới quyền CŨ', async () => {
    const s = await scene();
    arm('opportunity', 'findFirst', async () => {
      await writer.customer.update({ where: { id: s.cust.id }, data: { ownerId: fx.empB, phone: '0999999999', address: 'Địa chỉ MỚI ' + s.tok, version: { increment: 1 } } });
    });
    const r = await a('salesA').get(O + '/' + s.opp.id);
    expect(gate.fired).toBe(1); // thao tác ghi xen ĐÃ chạy và commit trước khi request đọc tiếp
    // Chấp nhận: nhất quán theo snapshot cũ (200, dữ liệu cũ, customerReadable theo chủ cũ) hoặc từ chối nhất quán (404).
    if (r.status === 200) {
      expect(r.body.data.customer).toMatchObject({ phone: '0900000001', address: 'Địa chỉ CŨ ' + s.tok });
      expect(r.body.data.customerReadable).toBe(true);
    } else expect(r.status).toBe(404);
    expect(JSON.stringify(r.body)).not.toContain('0999999999');
    expect(JSON.stringify(r.body)).not.toContain('Địa chỉ MỚI');
    // Request KẾ TIẾP thấy trạng thái mới: A hết đường đọc; B (chủ mới của khách, chủ cơ hội) thấy dữ liệu mới.
    expect((await a('salesA').get(O + '/' + s.opp.id)).status).toBe(404);
    const b = await a('salesB').get(O + '/' + s.opp.id);
    expect(b.body.data).toMatchObject({ customerReadable: true, customer: { phone: '0999999999', address: 'Địa chỉ MỚI ' + s.tok } });
  });
  it('D2. đổi tên/điện thoại người liên hệ GIỮA hai lần đọc => liên hệ trong phản hồi thuộc cùng snapshot với cơ hội', async () => {
    const s = await scene();
    arm('opportunity', 'findFirst', async () => {
      await writer.contact.update({ where: { id: s.contact.id }, data: { fullName: 'Liên hệ MỚI ' + s.tok, phone: '0988888888' } });
    });
    const r = await a('salesA').get(O + '/' + s.opp.id);
    expect(gate.fired).toBe(1);
    expect(r.status).toBe(200);
    expect(r.body.data.contact).toMatchObject({ id: s.contact.id, fullName: 'Liên hệ CŨ ' + s.tok, phone: '0912345678' });
    expect((await a('salesA').get(O + '/' + s.opp.id)).body.data.contact).toMatchObject({ fullName: 'Liên hệ MỚI ' + s.tok, phone: '0988888888' });
  });
  it('D3. khách bị xoá mềm (kèm đổi tên) GIỮA hai lần đọc => không trả thẻ của trạng thái mới; request kế tiếp 404', async () => {
    const s = await scene();
    const before = (await prisma.customer.findUniqueOrThrow({ where: { id: s.cust.id }, select: { name: true } })).name;
    arm('opportunity', 'findFirst', async () => {
      await writer.customer.update({ where: { id: s.cust.id }, data: { name: 'ĐÃ XOÁ ' + s.tok, deletedAt: new Date(), deletedById: fx.empA, version: { increment: 1 } } });
    });
    const r = await a('salesA').get(O + '/' + s.opp.id);
    expect(gate.fired).toBe(1);
    if (r.status === 200) expect(r.body.data.customer.name).toBe(before); else expect(r.status).toBe(404);
    expect(JSON.stringify(r.body)).not.toContain('ĐÃ XOÁ');
    expect((await a('salesA').get(O + '/' + s.opp.id)).status).toBe(404);
  });
});

describe('PR241-R1-02 — danh sách: total và items cùng một snapshot', () => {
  const page = (who: string, tok: string) => a(who).get(O + '?pageSize=100&q=' + tok);
  it('L1. thêm cơ hội GIỮA count và findMany => total khớp items', async () => {
    const s = await scene();
    arm('opportunity', 'count', async () => {
      await makeOpportunity(writer, fx, { customerId: s.cust.id, ownerId: fx.empA, title: 'S6C ' + s.tok + ' chen' });
    });
    const r = await page('salesA', s.tok);
    expect(gate.fired).toBe(1);
    expect(r.status).toBe(200);
    expect(r.body.data.items.length).toBe(r.body.data.total);
    expect(r.body.data.total).toBe(2);
    expect((await page('salesA', s.tok)).body.data.total).toBe(3); // request kế tiếp thấy dòng mới
  });
  it('L2. chuyển chủ khách GIỮA count và findMany (một dòng rời phạm vi) => total khớp items', async () => {
    const s = await scene();
    arm('opportunity', 'count', async () => {
      await writer.customer.update({ where: { id: s.cust.id }, data: { ownerId: fx.empC, version: { increment: 1 } } });
    });
    const r = await page('salesA', s.tok);
    expect(gate.fired).toBe(1);
    expect(r.body.data.items.length).toBe(r.body.data.total);
    expect(r.body.data.total).toBe(2);
    expect((await page('salesA', s.tok)).body.data.total).toBe(1); // sau đó A chỉ còn cơ hội mình phụ trách
  });
  it('L3. xoá mềm một cơ hội GIỮA count và findMany => total khớp items', async () => {
    const s = await scene();
    arm('opportunity', 'count', async () => {
      await writer.opportunity.update({ where: { id: s.opp2.id }, data: { deletedAt: new Date(), deletedById: fx.empA, deleteReason: 'xoá thử xen kẽ', version: { increment: 1 } } });
    });
    const r = await page('salesA', s.tok);
    expect(gate.fired).toBe(1);
    expect(r.body.data.items.length).toBe(r.body.data.total);
    expect(r.body.data.total).toBe(2);
    expect((await page('salesA', s.tok)).body.data.total).toBe(1);
  });
});

describe('đường theo khách: kiểm khách và danh sách cùng một snapshot', () => {
  it('C1. khách bị xoá mềm GIỮA lần kiểm khách và lần đọc danh sách => phản hồi nhất quán (đủ theo snapshot cũ hoặc 404), không nửa nọ nửa kia', async () => {
    const s = await scene();
    arm('customer', 'findFirst', async () => {
      await writer.customer.update({ where: { id: s.cust.id }, data: { deletedAt: new Date(), deletedById: fx.empA, version: { increment: 1 } } });
    });
    const r = await a('salesA').get(C + s.cust.id + '/opportunities');
    expect(gate.fired).toBe(1);
    if (r.status === 200) { expect(r.body.data.total).toBe(2); expect(r.body.data.items.length).toBe(2); } else expect(r.status).toBe(404);
    expect((await a('salesA').get(C + s.cust.id + '/opportunities')).status).toBe(404);
  });
});

describe('chốt không ảnh hưởng đường đọc bình thường', () => {
  it('không đặt chốt => chi tiết và danh sách trả như thường', async () => {
    const s = await scene();
    expect((await a('salesA').get(O + '/' + s.opp.id)).status).toBe(200);
    expect((await a('salesA').get(O + '?q=' + s.tok)).body.data.total).toBe(2);
    expect(gate.fired).toBe(0);
  });
});
