import type { INestApplication } from '@nestjs/common';
import type { PrismaService } from '../src/prisma/prisma.service';
import { as, leaks, makeApp, TestApp } from './helpers/test-app';
import { assertTestConnection, createTestPrisma } from './helpers/test-db';
import { ensureFixtures, Fixtures, makeCustomer, uniq, uniqueTax } from './helpers/fixtures';

const URL = '/api/v1/customers';
const NIL = '00000000-0000-4000-8000-000000000000';
let prisma: PrismaService; let fx: Fixtures; let t: TestApp; let tv: TestApp; let td: TestApp;
const a = (who = 'all', app: INestApplication = t.app) => as(app, who);

beforeAll(async () => {
  const c = createTestPrisma();
  prisma = c.prisma;
  await assertTestConnection(prisma, c.name);
  fx = await ensureFixtures(prisma);
  t = await makeApp(prisma, fx);
  tv = await makeApp(prisma, fx, { verifiedLinks: true }); // checker GIẢ, chỉ để thử logic xoá mềm/khôi phục
  td = await makeApp(prisma, fx, { denyAll: true });       // cấu hình mặc định: từ chối tất cả
});
afterAll(async () => { await t.app.close(); await tv.app.close(); await td.app.close(); await prisma.$disconnect(); });

describe('thêm khách hàng', () => {
  it('1. hợp lệ: 201, mã do DB sinh, danh mục mặc định, ghi người tạo, có nhật ký', async () => {
    const res = await a().post(URL, { name: 'Công ty TNHH Kiểm Thử ' + uniq(), phone: '0903 123 456' });
    expect(res.status).toBe(201);
    const d = res.body.data;
    expect(d.code).toMatch(/^KH-\d{5,}$/);
    expect(d).toMatchObject({ version: 1, revenueVnd: '0', revenueBasis: 'ESTIMATED', taxId: null, email: null, website: null, owner: null, phoneE164: '+84903123456' });
    expect(d.tier.code).toBe('POTENTIAL');
    expect(d.shortName).toMatch(/^Kiểm Thử /);
    const row = await prisma.customer.findUnique({ where: { id: d.id } });
    expect(row?.createdById).toBe(fx.empA);
    expect(row?.isDemo).toBe(false);
    expect(t.audit.entries.at(-1)).toMatchObject({ action: 'customer.create', entityCode: d.code, actorEmployeeId: fx.empA });
  });
  it('2-3. thiếu tên / thiếu điện thoại -> 400', async () => {
    expect((await a().post(URL, { phone: '0903123456' })).status).toBe(400);
    expect((await a().post(URL, { name: 'Công ty Thiếu SĐT ' + uniq() })).status).toBe(400);
  });
  it('4. để trống MST: nhiều khách không MST đều tạo được', async () => {
    for (let i = 0; i < 3; i++) expect((await a().post(URL, { name: 'Công ty không MST ' + uniq(), phone: '0903123456', taxId: '' })).status).toBe(201);
  });
  it('5. MST trùng: 409; người xem được khách kia thấy mã, người không xem được thì không', async () => {
    const tax = uniqueTax();
    const first = await a().post(URL, { name: 'Công ty MST ' + uniq(), phone: '0903123456', taxId: tax });
    expect(first.status).toBe(201);
    const dup = await a().post(URL, { name: 'Công ty MST trùng ' + uniq(), phone: '0903123456', taxId: tax });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('CUSTOMER_DUPLICATE_TAX_ID');
    expect(dup.body.error.details.visibleConflict.code).toBe(first.body.data.code);
    const tax2 = uniqueTax();
    await makeCustomer(prisma, fx, { taxId: tax2, ownerId: fx.empB, name: 'Khách ẩn ' + uniq() });
    const hidden = await a('createReadOwn').post(URL, { name: 'Công ty thử ẩn ' + uniq(), phone: '0903123456', taxId: tax2 });
    expect(hidden.status).toBe(409);
    expect(hidden.body.error.details.visibleConflict).toBeNull();
    expect(JSON.stringify(hidden.body)).not.toMatch(/Khách ẩn/);
  });
  it('6. email/website/điện thoại: sai -> 400; quốc tế hợp lệ lưu phone_e164', async () => {
    const ok = { name: 'Công ty định dạng ' + uniq(), phone: '0903123456' };
    expect((await a().post(URL, { ...ok, email: 'x@' })).status).toBe(400);
    expect((await a().post(URL, { ...ok, website: 'a b' })).status).toBe(400);
    expect((await a().post(URL, { ...ok, phone: '123' })).status).toBe(400);
    const intl = await a().post(URL, { ...ok, name: 'Công ty Hàn Quốc ' + uniq(), phone: '+82 2 1234 5678', email: 'a@b.vn', website: 'congty.vn' });
    expect(intl.status).toBe(201);
    expect(intl.body.data.phoneE164).toBe('+82212345678');
  });
  it('7. sinh mã đồng thời: 20 yêu cầu song song, 20 mã khác nhau', async () => {
    const rs = await Promise.all(Array.from({ length: 20 }, () => a().post(URL, { name: 'Công ty đồng thời ' + uniq(), phone: '0903123456' })));
    expect(rs.map((r) => r.status)).toEqual(Array(20).fill(201));
    expect(new Set(rs.map((r) => r.body.data.code)).size).toBe(20);
  });
  it('mã danh mục không có/ngừng dùng -> 400 LOOKUP_INVALID', async () => {
    const n = { name: 'Công ty danh mục ' + uniq(), phone: '0903123456' };
    for (const extra of [{ tier: 'KHONGCO' }, { tier: 'LEGACY' }, { industry: 'IND_Z' }]) {
      const r = await a().post(URL, { ...n, ...extra });
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('LOOKUP_INVALID');
    }
  });
});

describe('sửa khách hàng', () => {
  const make = async () => (await a().post(URL, { name: 'Công ty sửa ' + uniq(), phone: '0903123456', address: 'địa chỉ cũ' })).body.data;
  it('11. cập nhật từng phần: chỉ trường gửi lên đổi; version tăng; ghi người sửa và nhật ký', async () => {
    const c = await make();
    const r = await a().patch(URL + '/' + c.id, { version: 1, note: 'ghi chú mới' });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ note: 'ghi chú mới', version: 2, name: c.name, phone: c.phone, address: 'địa chỉ cũ', code: c.code });
    expect(t.audit.entries.at(-1)).toMatchObject({ action: 'customer.update', entityCode: c.code });
    expect(t.audit.entries.at(-1)?.changes).toEqual({ note: '(đã thay đổi)' });
  });
  it('xoá giá trị tuỳ chọn bằng rỗng/null; name/phone không được rỗng', async () => {
    const c = await make();
    const r = await a().patch(URL + '/' + c.id, { version: 1, address: '' });
    expect(r.body.data.address).toBeNull();
    expect((await a().patch(URL + '/' + c.id, { version: 2, name: '' })).status).toBe(400);
    expect((await a().patch(URL + '/' + c.id, { version: 2, phone: null })).status).toBe(400);
  });
  it('12. không cho sửa id / mã / các trường cấm -> 400', async () => {
    const c = await make();
    for (const k of ['id', 'code', 'revenueVnd', 'isDemo', 'createdById', 'ownerId']) expect((await a().patch(URL + '/' + c.id, { version: 1, [k]: 'x' })).status).toBe(400);
  });
  it('khoá lạc quan: version cũ -> 409 kèm currentVersion; thiếu version -> 400', async () => {
    const c = await make();
    await a().patch(URL + '/' + c.id, { version: 1, note: 'a' });
    const r = await a().patch(URL + '/' + c.id, { version: 1, note: 'b' });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ code: 'CUSTOMER_VERSION_CONFLICT', details: { currentVersion: 2 } });
    expect((await a().patch(URL + '/' + c.id, { note: 'c' })).status).toBe(400);
  });
  it('đổi MST sang MST đang có -> 409; đổi danh mục sang mục ngừng dùng -> 400', async () => {
    const tax = uniqueTax();
    await makeCustomer(prisma, fx, { taxId: tax });
    const c = await make();
    expect((await a().patch(URL + '/' + c.id, { version: 1, taxId: tax })).status).toBe(409);
    const r = await a().patch(URL + '/' + c.id, { version: 1, tier: 'LEGACY' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('LOOKUP_INVALID');
    const ok = await a().patch(URL + '/' + c.id, { version: 1, tier: 'VIP', industry: 'IND_A' });
    expect(ok.body.data).toMatchObject({ tier: { code: 'VIP' }, industry: { code: 'IND_A' } });
  });
});

describe('xoá mềm và khôi phục', () => {
  it('13a. DELETE thật (cấu hình production) luôn bị khoá: 409, không đổi dữ liệu', async () => {
    const c = await makeCustomer(prisma, fx);
    const r = await a().delete(URL + '/' + c.id);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('DELETE_LINKS_UNVERIFIED');
    expect((await prisma.customer.findUnique({ where: { id: c.id } }))?.deletedAt).toBeNull();
  });
  it('13b-14. logic xoá mềm (checker giả) rồi khôi phục: ẩn khỏi danh sách, xem được bằng deleted=only, khôi phục lại', async () => {
    const c = await makeCustomer(prisma, fx, { name: 'Khách xoá khôi phục ' + uniq() });
    const del = await a('all', tv.app).delete(URL + '/' + c.id);
    expect(del.status).toBe(200);
    expect(del.body.data.deletedAt).not.toBeNull();
    expect((await a().get(URL + '/' + c.id)).status).toBe(404);
    const only = await a().get(URL + '?deleted=only&search=' + encodeURIComponent(c.name));
    expect(only.body.data.items.map((i: { id: string }) => i.id)).toContain(c.id);
    const active = await a().get(URL + '?search=' + encodeURIComponent(c.name));
    expect(active.body.data.items.map((i: { id: string }) => i.id)).not.toContain(c.id);
    expect((await a('readonly').get(URL + '?deleted=only')).status).toBe(403); // thiếu customer.restore
    const rs = await a().post(URL + '/' + c.id + '/restore');
    expect(rs.status).toBe(200);
    expect(rs.body.data).toMatchObject({ deletedAt: null, version: 3 });
    expect(rs.body.data.restoredAt).not.toBeNull();
    expect((await prisma.customer.findUnique({ where: { id: c.id } }))?.restoredById).toBe(fx.empA);
    expect((await a().post(URL + '/' + c.id + '/restore')).body.error.code).toBe('CUSTOMER_NOT_DELETED');
  });
  it('15. từ chối khôi phục khi MST đang bị khách khác giữ; thông tin khách kia ẩn nếu không xem được', async () => {
    const tax = uniqueTax();
    const x = await makeCustomer(prisma, fx, { taxId: tax, deleted: true, ownerId: fx.empA });
    const y = await makeCustomer(prisma, fx, { taxId: tax, name: 'Khách giữ MST ' + uniq(), ownerId: fx.empB });
    const r = await a().post(URL + '/' + x.id + '/restore');
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('CUSTOMER_RESTORE_CONFLICT');
    expect(r.body.error.details.conflicts).toEqual([{ code: y.code, name: y.name }]);
    const h = await a('ownA').post(URL + '/' + x.id + '/restore'); // ownA xem được x (chủ A) nhưng không xem được y (chủ B)
    expect(h.status).toBe(409);
    expect(h.body.error.details.conflicts).toEqual([]);
    expect(JSON.stringify(h.body)).not.toContain(y.name);
    expect((await prisma.customer.findUnique({ where: { id: x.id } }))?.deletedAt).not.toBeNull();
  });
  it('16. không tồn tại -> 404 (GET, PATCH, restore, DELETE)', async () => {
    expect((await a().get(URL + '/' + NIL)).status).toBe(404);
    expect((await a().patch(URL + '/' + NIL, { version: 1, note: 'x' })).status).toBe(404);
    expect((await a().post(URL + '/' + NIL + '/restore')).status).toBe(404);
    expect((await a().delete(URL + '/' + NIL)).status).toBe(404);
  });
});

describe('phạm vi truy cập và bảo mật', () => {
  it('chi tiết/sửa theo phạm vi OWN/DEPARTMENT: ngoài phạm vi -> 404, thiếu quyền ghi -> 403', async () => {
    const c = await makeCustomer(prisma, fx, { ownerId: fx.empB });
    expect((await a('ownB').get(URL + '/' + c.id)).status).toBe(200);
    expect((await a('ownA').get(URL + '/' + c.id)).status).toBe(404);
    expect((await a('deptA').get(URL + '/' + c.id)).status).toBe(200);
    expect((await a('deptC').get(URL + '/' + c.id)).status).toBe(404);
    expect((await a('none').get(URL + '/' + c.id)).status).toBe(403);
    expect((await a('readonly').patch(URL + '/' + c.id, { version: 1, note: 'x' })).status).toBe(403);
    expect((await a('ownA').patch(URL + '/' + c.id, { version: 1, note: 'x' })).status).toBe(404);
  });
  it('B-3 tạo với phạm vi OWN: chủ sở hữu = chính mình (D14), có phân công OWNER, người tạo xem được; người cùng phòng (DEPARTMENT) xem được', async () => {
    const r = await a('ownA').post(URL, { name: 'Công ty OWN ' + uniq(), phone: '0903123456', ownerReason: 'tự tạo' });
    expect(r.status).toBe(201);
    expect(r.body.data.owner).toMatchObject({ id: fx.empA });
    const asg = await prisma.customerAssignment.findMany({ where: { customerId: r.body.data.id } });
    expect(asg).toHaveLength(1);
    expect(asg[0]).toMatchObject({ employeeId: fx.empA, role: 'OWNER', assignedById: fx.empA, endedAt: null, reason: 'tự tạo' });
    expect(t.audit.entries.at(-1)?.changes).toMatchObject({ ownerId: [null, fx.empA] });
    expect((await a('ownA').get(URL + '/' + r.body.data.id)).status).toBe(200);
    expect((await a('ownB').get(URL + '/' + r.body.data.id)).status).toBe(404);
    expect((await a('deptA').get(URL + '/' + r.body.data.id)).status).toBe(200);
    expect((await a('deptC').get(URL + '/' + r.body.data.id)).status).toBe(404);
  });
  it('B-3 tạo: OWN gửi ownerId người khác -> 403; DEPARTMENT gửi người khác phòng -> 403; ownerId không tồn tại/nghỉ việc -> 400 OWNER_INVALID; không tạo dòng', async () => {
    const before = await prisma.customer.count();
    expect((await a('ownA').post(URL, { name: 'X ' + uniq(), phone: '0903123456', ownerId: fx.empB })).status).toBe(403);
    expect((await a('deptA').post(URL, { name: 'X ' + uniq(), phone: '0903123456', ownerId: fx.empC })).status).toBe(403);
    const r1 = await a().post(URL, { name: 'X ' + uniq(), phone: '0903123456', ownerId: NIL });
    expect(r1.status).toBe(400); expect(r1.body.error.code).toBe('OWNER_INVALID');
    const resigned = await prisma.employee.create({ data: { fullName: 'TEST NV nghỉ ' + uniq(), departmentId: fx.d1, isDemo: true, status: 'RESIGNED', deletedAt: new Date() }, select: { id: true } });
    const r2 = await a().post(URL, { name: 'X ' + uniq(), phone: '0903123456', ownerId: resigned.id });
    expect(r2.status).toBe(400); expect(r2.body.error.code).toBe('OWNER_INVALID');
    expect(await prisma.customer.count()).toBe(before);
  });
  it('B-3 tạo ALL kèm ownerId: phân công cho người đó; sửa đổi chủ sở hữu: đóng phân công cũ + mở mới cùng transaction, version tăng, nhật ký [cũ, mới]; gửi lại giá trị cũ không tạo phân công', async () => {
    const c = (await a().post(URL, { name: 'Công ty bàn giao ' + uniq(), phone: '0903123456', ownerId: fx.empB })).body.data;
    expect(c.owner.id).toBe(fx.empB);
    const u = await a().patch(URL + '/' + c.id, { version: 1, ownerId: fx.empC, ownerReason: 'bàn giao phòng 2' });
    expect(u.status).toBe(200);
    expect(u.body.data).toMatchObject({ version: 2, owner: { id: fx.empC } });
    expect(t.audit.entries.at(-1)?.changes).toEqual({ ownerId: [fx.empB, fx.empC] });
    const asg = await prisma.customerAssignment.findMany({ where: { customerId: c.id }, orderBy: { assignedAt: 'asc' } });
    expect(asg).toHaveLength(2);
    expect(asg[0]).toMatchObject({ employeeId: fx.empB, role: 'OWNER' }); expect(asg[0].endedAt).not.toBeNull();
    expect(asg[1]).toMatchObject({ employeeId: fx.empC, role: 'OWNER', endedAt: null, assignedById: fx.empA, reason: 'bàn giao phòng 2' });
    const same = await a().patch(URL + '/' + c.id, { version: 2, ownerId: fx.empC });
    expect(same.status).toBe(200); expect(same.body.data.version).toBe(2);
    expect(await prisma.customerAssignment.count({ where: { customerId: c.id } })).toBe(2);
    expect((await a('deptC').get(URL + '/' + c.id)).status).toBe(200); // giờ thuộc phòng 2
    expect((await a('deptA').get(URL + '/' + c.id)).status).toBe(404);
    const cleared = await a().patch(URL + '/' + c.id, { version: 2, ownerId: null });
    expect(cleared.status).toBe(200); expect(cleared.body.data.owner).toBeNull();
    expect(await prisma.customerAssignment.count({ where: { customerId: c.id, endedAt: null } })).toBe(0);
  });
  it('B-3 sửa chủ sở hữu theo phạm vi: OWN đặt người khác -> 403; DEPARTMENT đặt khác phòng -> 403, cùng phòng -> 200', async () => {
    const own = await makeCustomer(prisma, fx, { ownerId: fx.empA });
    expect((await a('ownA').patch(URL + '/' + own.id, { version: 1, ownerId: fx.empB })).status).toBe(403);
    expect((await a('ownA').patch(URL + '/' + own.id, { version: 1, ownerId: null })).status).toBe(403);
    const dept = await makeCustomer(prisma, fx, { ownerId: fx.empA });
    expect((await a('deptA').patch(URL + '/' + dept.id, { version: 1, ownerId: fx.empC })).status).toBe(403);
    const ok = await a('deptA').patch(URL + '/' + dept.id, { version: 1, ownerId: fx.empB });
    expect(ok.status).toBe(200); expect(ok.body.data.owner.id).toBe(fx.empB);
    expect(await prisma.customerAssignment.count({ where: { customerId: dept.id, endedAt: null, employeeId: fx.empB } })).toBe(1);
  });
  it('19. phản hồi lỗi không lộ thông tin nội bộ', async () => {
    const tax = uniqueTax();
    await makeCustomer(prisma, fx, { taxId: tax });
    const rs = [
      await a().post(URL, { name: 'x', phone: '1' }),
      await a().post(URL, { name: 'Công ty lỗi ' + uniq(), phone: '0903123456', taxId: tax }),
      await a().get(URL + '/' + NIL),
      await a().delete(URL + '/' + NIL),
      await a().get(URL + '?sortBy=password'),
    ];
    for (const r of rs) {
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(r.status).toBeLessThan(500);
      expect(leaks(r.body)).toBe(false);
      expect(JSON.stringify(r.body)).not.toMatch(/postgres|password|stack/i);
    }
  });
  it('20. API chưa xác thực (cấu hình mặc định) không ghi/đọc được: 401 và số dòng không đổi', async () => {
    const count = async () => [await prisma.customer.count(), await prisma.contact.count(), await prisma.auditLog.count()];
    const before = await count();
    const c = await makeCustomer(prisma, fx);
    const before2 = await count();
    const g = as(td.app, 'all'); // dù có header thử, provider mặc định là DenyAll
    const rs = [
      await g.get(URL), await g.get(URL + '/' + c.id), await g.post(URL, { name: 'Trái phép ' + uniq(), phone: '0903123456' }),
      await g.patch(URL + '/' + c.id, { version: 1, note: 'x' }), await g.delete(URL + '/' + c.id), await g.post(URL + '/' + c.id + '/restore'),
      await g.get(URL + '/' + c.id + '/contacts'), await g.post(URL + '/' + c.id + '/contacts', { fullName: 'A', phone: '0903123456' }), await g.get('/api/v1/lookups?type=industry'),
    ];
    expect(rs.map((r) => r.status)).toEqual(Array(9).fill(401));
    expect(rs.every((r) => r.body.error.code === 'UNAUTHENTICATED')).toBe(true);
    expect(await count()).toEqual([before2[0], before2[1], before2[2]]);
    expect(before2[0]).toBe((before[0] as number) + 1); // chỉ khách do fixture tạo
  });
});
