import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { CreateCustomerDto } from './create-customer.dto';
import { QueryCustomersDto } from './query-customers.dto';
import { UpdateCustomerDto } from './update-customer.dto';

async function check<T extends object>(cls: new () => T, plain: object): Promise<string[]> {
  const errs: ValidationError[] = await validate(plainToInstance(cls, plain) as object, { whitelist: true, forbidNonWhitelisted: true });
  return errs.flatMap((e) => Object.values(e.constraints ?? {}));
}
const ok = { name: 'Công ty ABC', phone: '0903 123 456' };

describe('CreateCustomerDto', () => {
  it('chỉ Tên + Điện thoại là hợp lệ (các trường khác tuỳ chọn)', async () => expect(await check(CreateCustomerDto, ok)).toEqual([]));
  it('thiếu tên / thiếu điện thoại', async () => {
    expect(await check(CreateCustomerDto, { phone: '0903123456' })).toContain('Vui lòng nhập tên công ty');
    expect(await check(CreateCustomerDto, { name: 'Công ty A' })).toContain('Vui lòng nhập số điện thoại');
    expect(await check(CreateCustomerDto, { name: '   ', phone: '0903123456' })).toContain('Vui lòng nhập tên công ty');
  });
  it('tên quá ngắn; điện thoại sai / quốc tế', async () => {
    expect(await check(CreateCustomerDto, { ...ok, name: 'A' })).toContain('Tên công ty quá ngắn');
    expect((await check(CreateCustomerDto, { ...ok, phone: '123' })).length).toBeGreaterThan(0);
    expect(await check(CreateCustomerDto, { ...ok, phone: '+82 2 1234 5678' })).toEqual([]);
  });
  it('MST để trống hợp lệ (rỗng, null, toàn khoảng trắng); sai định dạng bị từ chối', async () => {
    for (const taxId of ['', null, '   ']) expect(await check(CreateCustomerDto, { ...ok, taxId })).toEqual([]);
    expect(await check(CreateCustomerDto, { ...ok, taxId: '0312345678' })).toEqual([]);
    expect((await check(CreateCustomerDto, { ...ok, taxId: '12345' })).length).toBeGreaterThan(0);
  });
  it('email / website: trống hợp lệ, nhập sai bị từ chối', async () => {
    expect(await check(CreateCustomerDto, { ...ok, email: '', website: '' })).toEqual([]);
    expect((await check(CreateCustomerDto, { ...ok, email: 'x@' })).length).toBeGreaterThan(0);
    expect((await check(CreateCustomerDto, { ...ok, website: 'a b' })).length).toBeGreaterThan(0);
  });
  it('trường lạ bị từ chối: id, code, version, isDemo, revenueVnd, createdBy', async () => {
    for (const k of ['id', 'code', 'version', 'isDemo', 'revenueVnd', 'createdBy']) expect((await check(CreateCustomerDto, { ...ok, [k]: 'x' })).length).toBeGreaterThan(0);
  });
  it('B-3: ownerId phải là uuid (rỗng/null = không gửi); ownerReason <= 500', async () => {
    expect(await check(CreateCustomerDto, { ...ok, ownerId: '11111111-1111-4111-8111-111111111111', ownerReason: 'bàn giao' })).toEqual([]);
    expect(await check(CreateCustomerDto, { ...ok, ownerId: '', ownerReason: null })).toEqual([]);
    expect((await check(CreateCustomerDto, { ...ok, ownerId: 'x' })).length).toBeGreaterThan(0);
    expect((await check(CreateCustomerDto, { ...ok, ownerReason: 'a'.repeat(501) })).length).toBeGreaterThan(0);
  });
  it('mã danh mục sai định dạng; tags quá nhiều', async () => {
    expect((await check(CreateCustomerDto, { ...ok, tier: 'vip' })).length).toBeGreaterThan(0);
    expect(await check(CreateCustomerDto, { ...ok, tier: 'VIP', status: 'ACTIVE', industry: null })).toEqual([]);
    expect((await check(CreateCustomerDto, { ...ok, tags: Array.from({ length: 21 }, (_v, i) => 't' + i) })).length).toBeGreaterThan(0);
  });
});

describe('UpdateCustomerDto', () => {
  it('bắt buộc version', async () => {
    expect((await check(UpdateCustomerDto, { note: 'x' })).length).toBeGreaterThan(0);
    expect(await check(UpdateCustomerDto, { version: 1 })).toEqual([]);
  });
  it('name/phone/tier/status không được rỗng hoặc null', async () => {
    for (const k of ['name', 'phone', 'tier', 'status']) {
      expect((await check(UpdateCustomerDto, { version: 1, [k]: '' })).length).toBeGreaterThan(0);
      expect((await check(UpdateCustomerDto, { version: 1, [k]: null })).length).toBeGreaterThan(0);
    }
  });
  it('trường tuỳ chọn có thể xoá bằng null hoặc rỗng', async () => {
    expect(await check(UpdateCustomerDto, { version: 2, industry: '', source: null, taxId: '', email: null, address: '' })).toEqual([]);
  });
  it('MST sai bị từ chối; trường lạ (code) bị từ chối; B-3: ownerId uuid hoặc null, ownerReason <= 500', async () => {
    expect((await check(UpdateCustomerDto, { version: 1, taxId: '123' })).length).toBeGreaterThan(0);
    expect((await check(UpdateCustomerDto, { version: 1, code: 'KH-1' })).length).toBeGreaterThan(0);
    expect(await check(UpdateCustomerDto, { version: 1, ownerId: '11111111-1111-4111-8111-111111111111', ownerReason: 'bàn giao' })).toEqual([]);
    expect(await check(UpdateCustomerDto, { version: 1, ownerId: null })).toEqual([]);
    expect((await check(UpdateCustomerDto, { version: 1, ownerId: 'x' })).length).toBeGreaterThan(0);
    expect((await check(UpdateCustomerDto, { version: 1, ownerReason: 'a'.repeat(501) })).length).toBeGreaterThan(0);
  });
});

describe('QueryCustomersDto', () => {
  it('mặc định hợp lệ; page dạng chuỗi được chuyển thành số', async () => {
    expect(await check(QueryCustomersDto, {})).toEqual([]);
    expect(await check(QueryCustomersDto, { page: '2', pageSize: '50', sortBy: 'name', sortOrder: 'asc', deleted: 'only' })).toEqual([]);
  });
  it('search: 2–100 ký tự sau trim; sortBy=relevance hợp lệ ở DTO (service kiểm tra phải có search)', async () => {
    expect(await check(QueryCustomersDto, { search: 'abc', sortBy: 'relevance' })).toEqual([]);
    expect(await check(QueryCustomersDto, { search: '  ab  ' })).toEqual([]);
    for (const search of ['a', '', '   ', 'x'.repeat(101)]) expect((await check(QueryCustomersDto, { search })).length).toBeGreaterThan(0);
  });
  it('từ chối: pageSize > 100, sortBy ngoài bảng trắng, deleted lạ, ownerId không phải uuid, trường lạ', async () => {
    for (const q of [{ pageSize: '101' }, { page: '0' }, { sortBy: 'password' }, { deleted: 'all' }, { ownerId: 'x' }, { tier: 'vip' }, { includeDeleted: 'true' }]) expect((await check(QueryCustomersDto, q)).length).toBeGreaterThan(0);
  });
});
