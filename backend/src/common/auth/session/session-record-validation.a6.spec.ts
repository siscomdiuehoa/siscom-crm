import { DomainException } from '../../errors/domain.exception';
import { InMemorySessionStore } from './in-memory-session.store';
import { Sha256TokenHasher, SessionService } from './session.service';
import { SessionRecord, SessionStore, TokenVersionSource } from './session.types';
const E7 = '00000000-0000-4000-8000-000000000007';
const E8 = '00000000-0000-4000-8000-000000000008';
const E99 = '00000000-0000-4000-8000-000000000099';

// Sprint A6: validate() phải fail-closed với bản ghi/nguồn version hỏng. Offline, không DB.
const TTL = 60_000;
let nowMs = Date.UTC(2026, 9, 22, 0, 0, 0);
const clock = { now: () => new Date(nowMs) };
const hasher = new Sha256TokenHasher();

const issueGood = async () => {
  nowMs = Date.UTC(2026, 9, 22, 0, 0, 0);
  const real = new InMemorySessionStore(); real.setTokenVersion(E7, 1);
  const { token } = await new SessionService(real, real, hasher, clock, TTL).issue(E7);
  const rec = (await real.findByHash(hasher.hash(token)))!;
  return { token, rec };
};
const svcWith = (rec: unknown, version: unknown) => {
  const store: SessionStore = { insert: async () => undefined, findByHash: async () => rec as SessionRecord | null, revokeByHash: async () => undefined };
  const versions: TokenVersionSource = { currentTokenVersion: async () => version as number | null };
  return new SessionService(store, versions, hasher, clock, TTL);
};
const expectInvalid = async (p: Promise<unknown>) => {
  let e: unknown;
  try { await p; } catch (x) { e = x; }
  expect(e).toBeInstanceOf(DomainException);
  expect((e as DomainException).getStatus()).toBe(401);
  expect((e as DomainException).code).toBe('SESSION_INVALID');
};

describe('A6 — SessionService.validate fail-closed với bản ghi hỏng', () => {
  it('bản ghi hợp lệ vẫn được chấp nhận (không ảnh hưởng hành vi đúng)', async () => {
    const { token, rec } = await issueGood();
    await expect(svcWith(rec, 1).validate(token)).resolves.toEqual({ employeeId: E7, tokenVersion: 1 });
  });

  const bad: Array<[string, (r: SessionRecord) => unknown]> = [
    ['expiresAt Invalid Date', (r) => ({ ...r, expiresAt: new Date(NaN) })],
    ['expiresAt thiếu', (r) => ({ ...r, expiresAt: undefined })],
    ['expiresAt là số/chuỗi (không ép kiểu)', (r) => ({ ...r, expiresAt: nowMs + TTL })],
    ['expiresAt là chuỗi ISO', (r) => ({ ...r, expiresAt: new Date(nowMs + TTL).toISOString() })],
    ['tokenVersion undefined', (r) => ({ ...r, tokenVersion: undefined })],
    ['tokenVersion thiếu', (r) => { const { tokenVersion, ...rest } = r; void tokenVersion; return rest; }],
    ['tokenVersion NaN', (r) => ({ ...r, tokenVersion: NaN })],
    ['tokenVersion Infinity', (r) => ({ ...r, tokenVersion: Infinity })],
    ['tokenVersion không nguyên', (r) => ({ ...r, tokenVersion: 1.5 })],
    ['tokenVersion là chuỗi "1"', (r) => ({ ...r, tokenVersion: '1' })],
    ['revokedAt undefined', (r) => ({ ...r, revokedAt: undefined })],
    ['revokedAt Invalid Date', (r) => ({ ...r, revokedAt: new Date(NaN) })],
    ['revokedAt là chuỗi', (r) => ({ ...r, revokedAt: 'x' })],
    ['employeeId là số nguyên dương (hợp đồng cũ)', (r) => ({ ...r, employeeId: 7 })],
    ['employeeId không hợp lệ (0)', (r) => ({ ...r, employeeId: 0 })],
    ['employeeId là chuỗi số "7"', (r) => ({ ...r, employeeId: '7' })],
    ['employeeId UUID sai định dạng', (r) => ({ ...r, employeeId: 'not-a-uuid' })],
    ['employeeId UUID chữ hoa', (r) => ({ ...r, employeeId: E7.toUpperCase().replace('00000000', 'ABCDEF00') })],
    ['employeeId UUID có khoảng trắng', (r) => ({ ...r, employeeId: ' ' + E7 })],
    ['employeeId UUID thiếu ký tự', (r) => ({ ...r, employeeId: E7.slice(1) })],
    ['employeeId rỗng', (r) => ({ ...r, employeeId: '' })],
    ['employeeId null', (r) => ({ ...r, employeeId: null })],
    ['tokenVersion âm', (r) => ({ ...r, tokenVersion: -1 })],
    ['tokenVersion vượt số nguyên an toàn', (r) => ({ ...r, tokenVersion: Number.MAX_SAFE_INTEGER + 1 })],
    ['tokenHash của phiên khác', (r) => ({ ...r, tokenHash: hasher.hash('sid_' + 'B'.repeat(43)) })],
    ['tokenHash thiếu', (r) => ({ ...r, tokenHash: undefined })],
    ['bản ghi không phải object', () => 'rec'],
    ['bản ghi undefined', () => undefined],
  ];
  it.each(bad)('từ chối: %s', async (_n, mutate) => {
    const { token, rec } = await issueGood();
    await expectInvalid(svcWith(mutate(rec), 1).validate(token));
  });

  it('tokenVersion undefined ở CẢ bản ghi và nguồn version vẫn bị từ chối', async () => {
    const { token, rec } = await issueGood();
    await expectInvalid(svcWith({ ...rec, tokenVersion: undefined }, undefined).validate(token));
  });

  it.each([['undefined', undefined], ['NaN', NaN], ['Infinity', Infinity], ['1.5', 1.5], ['"1"', '1'], ['null (tài khoản khóa)', null]])(
    'nguồn version hỏng/không dùng được (%s) bị từ chối', async (_n, v) => {
      const { token, rec } = await issueGood();
      await expectInvalid(svcWith(rec, v).validate(token));
    });

  it('tokenVersion lệch giữa bản ghi và nguồn bị từ chối', async () => {
    const { token, rec } = await issueGood();
    await expectInvalid(svcWith(rec, 2).validate(token));
  });

  it('phiên đã thu hồi (revokedAt hợp lệ) bị từ chối', async () => {
    const { token, rec } = await issueGood();
    await expectInvalid(svcWith({ ...rec, revokedAt: new Date(nowMs) }, 1).validate(token));
  });

  it('biên hết hạn: còn 1ms hợp lệ; đúng hạn và sau hạn bị từ chối', async () => {
    const { token, rec } = await issueGood();
    const svc = svcWith(rec, 1);
    nowMs += TTL - 1;
    await expect(svc.validate(token)).resolves.toEqual({ employeeId: E7, tokenVersion: 1 });
    nowMs += 1;
    await expectInvalid(svc.validate(token));
    nowMs += 1;
    await expectInvalid(svc.validate(token));
  });

  it('kho/nguồn ném lỗi bất kỳ => 401 SESSION_INVALID, không rò lỗi gốc', async () => {
    const { token } = await issueGood();
    const store: SessionStore = { insert: async () => undefined, findByHash: async () => { throw new Error('boom'); }, revokeByHash: async () => undefined };
    await expectInvalid(new SessionService(store, { currentTokenVersion: async () => 1 }, hasher, clock, TTL).validate(token));
  });
});
