import { CapMemo, InFlight, Slots } from './export-guards';

// FV-4A U-10 / U-11 (đặc tả bản 4 §2 tầng 0, §3 đường không thành công).
describe('FV-4A Slots (U-10)', () => {
  it('tối đa n lượt, không hàng đợi; luôn trả chỗ kể cả khi ném lỗi', async () => {
    const s = new Slots(2);
    const r1 = s.tryAcquire(); const r2 = s.tryAcquire(); const r3 = s.tryAcquire();
    expect([!!r1, !!r2, r3]).toEqual([true, true, null]);
    r1!(); r1!(); // trả hai lần không làm âm bộ đếm
    expect(s.inUse).toBe(1);
    await expect(s.run(async () => { throw new Error('x'); })).rejects.toThrow('x');
    expect(s.inUse).toBe(1);
    r2!();
    expect(s.inUse).toBe(0);
  });
  it('run trả null khi hết chỗ, không chạy hàm', async () => {
    const s = new Slots(1); const r = s.tryAcquire();
    let ran = false;
    expect(await s.run(async () => { ran = true; return 1; })).toBeNull();
    expect(ran).toBe(false);
    r!();
    expect(await s.run(async () => 7)).toBe(7);
  });
});

describe('FV-4A InFlight (U-10)', () => {
  it('một lượt mỗi người; người khác không bị ảnh hưởng; trả khi xong', () => {
    const f = new InFlight();
    const a1 = f.tryEnter('A'); const a2 = f.tryEnter('A'); const b1 = f.tryEnter('B');
    expect([!!a1, a2, !!b1]).toEqual([true, null, true]);
    a1!();
    expect(!!f.tryEnter('A')).toBe(true);
  });
});

describe('FV-4A CapMemo (U-11)', () => {
  it('chặn trước T, hết hạn đúng T, xoá mục hết hạn', () => {
    let now = 1000;
    const m = new CapMemo(() => now);
    m.markUntil('A', 5000);
    expect(m.blocked('A')).toBe(true);
    now = 4999; expect(m.blocked('A')).toBe(true);
    now = 5000; expect(m.blocked('A')).toBe(false);
    expect(m.size).toBe(0);
    expect(m.blocked('B')).toBe(false);
  });
});
