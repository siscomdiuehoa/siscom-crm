import { DomainException } from '../../errors/domain.exception';
import { InMemorySessionStore } from './in-memory-session.store';
import { Sha256TokenHasher, SessionService, UnwiredSessionStore } from './session.service';

let nowMs = Date.UTC(2026, 9, 22, 0, 0, 0);
const clock = { now: () => new Date(nowMs) };
const TTL = 60_000;
const SHAPED = 'sid_' + 'A'.repeat(43);
const setup = () => {
  nowMs = Date.UTC(2026, 9, 22, 0, 0, 0);
  const store = new InMemorySessionStore();
  store.setTokenVersion(7, 1);
  store.setTokenVersion(8, 1);
  return { store, svc: new SessionService(store, store, new Sha256TokenHasher(), clock, TTL) };
};
const rejection = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as DomainException; } throw new Error('không ném lỗi'); };
const expectInvalid = async (p: Promise<unknown>) => {
  const e = await rejection(p);
  expect(e).toBeInstanceOf(DomainException);
  expect(e.getStatus()).toBe(401);
  expect(e.code).toBe('SESSION_INVALID');
  return e;
};

describe('SessionService (offline, in-memory)', () => {
  it('cấp token ngẫu nhiên không lặp, định dạng cố định; chỉ lưu băm, không lưu token gốc', async () => {
    const { store, svc } = setup();
    const a = await svc.issue(7);
    const b = await svc.issue(7);
    expect(a.token).toMatch(/^sid_[A-Za-z0-9_-]{43}$/);
    expect(a.token).not.toEqual(b.token);
    expect(a.expiresAt.getTime()).toBe(nowMs + TTL);
    const keys = store.dumpKeys();
    expect(keys).toHaveLength(2);
    expect(keys).not.toContain(a.token);
    expect(keys.join('')).not.toContain(a.token.slice(4));
    expect(keys).toContain(new Sha256TokenHasher().hash(a.token));
  });

  it('token hợp lệ => danh tính lấy từ phiên phía server; hai người dùng không lẫn nhau', async () => {
    const { svc } = setup();
    const t7 = await svc.issue(7);
    const t8 = await svc.issue(8);
    await expect(svc.validate(t7.token)).resolves.toEqual({ employeeId: 7, tokenVersion: 1 });
    await expect(svc.validate(t8.token)).resolves.toEqual({ employeeId: 8, tokenVersion: 1 });
  });

  it('từ chối cùng một lỗi 401 SESSION_INVALID: sai kiểu/định dạng, không biết, giả mạo (đổi 1 ký tự), băm dùng làm token', async () => {
    const { svc } = setup();
    const t = await svc.issue(7);
    const flipped = t.token.slice(0, -1) + (t.token.endsWith('A') ? 'B' : 'A');
    const hashAsToken = new Sha256TokenHasher().hash(t.token);
    const msgs = new Set<string>();
    for (const bad of [undefined, null, 123, {}, ['x'], '', 'sid_', 'x'.repeat(5000), SHAPED, flipped, hashAsToken, t.token + ' ', '7']) {
      msgs.add((await expectInvalid(svc.validate(bad))).message);
    }
    expect(msgs.size).toBe(1);
  });

  it('hết hạn theo TTL (đúng thời điểm hết hạn đã bị từ chối)', async () => {
    const { svc } = setup();
    const t = await svc.issue(7);
    nowMs += TTL - 1;
    await expect(svc.validate(t.token)).resolves.toMatchObject({ employeeId: 7 });
    nowMs += 1;
    await expectInvalid(svc.validate(t.token));
  });

  it('logout thu hồi phiên; idempotent; không ảnh hưởng phiên khác của cùng/khác người dùng; token lạ không lỗi', async () => {
    const { svc } = setup();
    const a = await svc.issue(7);
    const other = await svc.issue(7);
    const u8 = await svc.issue(8);
    await svc.revoke(a.token);
    await svc.revoke(a.token);
    await expect(svc.revoke('rác')).resolves.toBeUndefined();
    await expect(svc.revoke(undefined)).resolves.toBeUndefined();
    await expectInvalid(svc.validate(a.token));
    await expect(svc.validate(other.token)).resolves.toMatchObject({ employeeId: 7 });
    await expect(svc.validate(u8.token)).resolves.toMatchObject({ employeeId: 8 });
  });

  it('token_version lệch hoặc tài khoản không còn dùng được => từ chối; phiên cấp sau khi tăng dùng được', async () => {
    const { store, svc } = setup();
    const t = await svc.issue(7);
    store.setTokenVersion(7, 2);
    await expectInvalid(svc.validate(t.token));
    const t2 = await svc.issue(7);
    await expect(svc.validate(t2.token)).resolves.toEqual({ employeeId: 7, tokenVersion: 2 });
    store.setTokenVersion(7, null);
    await expectInvalid(svc.validate(t2.token));
    await expectInvalid(svc.issue(7));
  });

  it('kết quả validate chỉ gồm employeeId + tokenVersion từ bản ghi server; token của người 7 không ra người 8', async () => {
    const { svc } = setup();
    const v = await svc.validate((await svc.issue(7)).token);
    expect(v.employeeId).toBe(7);
    expect(Object.keys(v).sort()).toEqual(['employeeId', 'tokenVersion']);
  });

  it('fail-closed: bộ lưu trữ chưa nối => validate từ chối 401, issue/revoke ném lỗi (không thành công giả)', async () => {
    const un = new UnwiredSessionStore();
    const svc = new SessionService(un, un, new Sha256TokenHasher(), clock, TTL);
    await expectInvalid(svc.validate(SHAPED));
    await expect(svc.issue(7)).rejects.toThrow('SESSION_STORE_NOT_WIRED');
    await expect(svc.revoke(SHAPED)).rejects.toThrow('SESSION_STORE_NOT_WIRED');
  });

  it('lỗi bộ lưu trữ khi validate => 401 SESSION_INVALID (không lộ chi tiết)', async () => {
    const { store } = setup();
    const boom = { findByHash: async () => { throw new Error('db down'); } } as unknown as InMemorySessionStore;
    await expectInvalid(new SessionService(boom, store, new Sha256TokenHasher(), clock, TTL).validate(SHAPED));
  });

  it('cấu hình TTL không hợp lệ bị từ chối; employeeId không hợp lệ không cấp phiên', async () => {
    const { store, svc } = setup();
    for (const ttl of [0, -1, NaN, Infinity, 24 * 3600 * 1000 + 1]) {
      expect(() => new SessionService(store, store, new Sha256TokenHasher(), clock, ttl)).toThrow('SESSION_TTL_INVALID');
    }
    for (const id of [0, -3, 1.5, NaN]) await expect(svc.issue(id)).rejects.toThrow('SESSION_EMPLOYEE_INVALID');
  });
});
