import type { RequestCtx } from '../../common/auth/actor';
import { LoginLimiter } from '../auth/login-limiter';
import { accountErrors } from './accounts.errors';
import { AccountsWriteService } from './accounts.write.service';

// P1 Task 5: cổng chung của mọi thao tác ghi — kiểm quyền TRƯỚC, rồi giới hạn tần suất theo NGƯỜI BẤM, tất cả trước khi chạm database.
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const T = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ctx = (employeeId: string): RequestCtx => ({ actor: { employeeId } } as unknown as RequestCtx);
const codeOf = async (p: Promise<unknown>): Promise<{ status: number; code: string }> => {
  try { await p; } catch (e) { const d = e as { getStatus(): number; code: string }; return { status: d.getStatus(), code: d.code }; }
  throw new Error('Mong đợi lỗi nhưng không có lỗi');
};
function make(max: number, manager: (id: string) => boolean = () => true) {
  let dbTouched = 0;
  const acct = { available: true, client: () => { dbTouched += 1; throw new Error('không được chạm database'); } };
  const reads = { requireManager: (c: RequestCtx) => { if (!manager(c.actor.employeeId)) throw accountErrors.forbidden(); } };
  const limiter = new LoginLimiter({ windowMs: 60_000, maxPerSource: max, maxPerIdentifier: max });
  return { svc: new AccountsWriteService(acct as never, reads as never, limiter), touched: () => dbTouched };
}
// Thân yêu cầu sai (lý do rỗng) => 400 ngay sau cổng: đủ để đếm lượt mà không cần database.
const bad = { reason: '' };

describe('AccountsWriteService — cổng quyền + giới hạn tần suất', () => {
  it('vượt hạn mức của một người bấm => 429 RATE_LIMITED, không chạm database', async () => {
    const m = make(2);
    expect(await codeOf(m.svc.disable(ctx(A), T, bad))).toEqual({ status: 400, code: 'VALIDATION_FAILED' });
    expect(await codeOf(m.svc.disable(ctx(A), T, bad))).toEqual({ status: 400, code: 'VALIDATION_FAILED' });
    expect(await codeOf(m.svc.disable(ctx(A), T, bad))).toEqual({ status: 429, code: 'RATE_LIMITED' });
    expect(m.touched()).toBe(0);
  });
  it('hạn mức tính RIÊNG từng người bấm: người này hết lượt không chặn người khác', async () => {
    const m = make(1);
    expect((await codeOf(m.svc.disable(ctx(A), T, bad))).status).toBe(400);
    expect((await codeOf(m.svc.disable(ctx(A), T, bad))).status).toBe(429);
    expect((await codeOf(m.svc.disable(ctx(B), T, bad))).status).toBe(400);
  });
  it('mọi thao tác ghi dùng chung một hạn mức của người bấm', async () => {
    const m = make(3);
    expect((await codeOf(m.svc.disable(ctx(A), T, bad))).status).toBe(400);
    expect((await codeOf(m.svc.changeRole(ctx(A), T, { role: 'admin' as never }))).status).toBe(400);
    expect((await codeOf(m.svc.resetPassword(ctx(A), T, { tempPassword: 'ngan' }))).status).toBe(400);
    for (const call of [
      () => m.svc.create(ctx(A), { fullName: 'X', email: 'x@thu.local', role: 'sales', tempPassword: 'ngan' }),
      () => m.svc.update(ctx(A), T, { updatedAt: new Date().toISOString(), fullName: 'X', email: 'x@thu.local' }),
      () => m.svc.enable(ctx(A), T, { tempPassword: 'ngan' }),
    ]) expect(await codeOf(call())).toEqual({ status: 429, code: 'RATE_LIMITED' });
    expect(m.touched()).toBe(0);
  });
  it('người không có quyền nhận 403 và KHÔNG tiêu lượt của ai (kiểm quyền trước khi đếm)', async () => {
    const m = make(1, (id) => id === A);
    for (let i = 0; i < 5; i += 1) expect(await codeOf(m.svc.disable(ctx(B), T, bad))).toEqual({ status: 403, code: 'FORBIDDEN' });
    expect((await codeOf(m.svc.disable(ctx(A), T, bad))).status).toBe(400);
  });
});
