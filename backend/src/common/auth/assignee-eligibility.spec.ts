import { accountUsable, AuthPoolAssigneeEligibility } from './assignee-eligibility';

// Sales S5 — cổng "tài khoản dùng được" (docs/SALES_DESIGN.md §5.4, TC 9a(vii)). Đơn vị, không DB: prisma giả.
// Ca DB thật (pool auth đọc được; pool nghiệp vụ bị từ chối => fail-closed): test/auth.int-spec.ts "Sales S5 — cổng AssigneeEligibility".
type Row = { id: string; status: string; deletedAt: Date | null; credential: { status: string } | null };
function make(rows: Row[] | Error) {
  const findMany = rows instanceof Error ? jest.fn().mockRejectedValue(rows) : jest.fn().mockResolvedValue(rows);
  const prisma = { employee: { findMany } } as unknown as ConstructorParameters<typeof AuthPoolAssigneeEligibility>[0];
  return { port: new AuthPoolAssigneeEligibility(prisma), findMany };
}
const ok = (id: string): Row => ({ id, status: 'ACTIVE', deletedAt: null, credential: { status: 'ACTIVE' } });

describe('accountUsable — một tiêu chí dùng chung với SessionActorProvider', () => {
  it('ACTIVE + chưa xoá mềm + credential ACTIVE => true', () => {
    expect(accountUsable({ status: 'ACTIVE', deletedAt: null, credential: { status: 'ACTIVE' } })).toBe(true);
  });
  it.each([
    ['nhân viên không ACTIVE', { status: 'INACTIVE', deletedAt: null, credential: { status: 'ACTIVE' } }],
    ['nhân viên đã xoá mềm', { status: 'ACTIVE', deletedAt: new Date(), credential: { status: 'ACTIVE' } }],
    ['credential bị khoá (DISABLED)', { status: 'ACTIVE', deletedAt: null, credential: { status: 'DISABLED' } }],
    ['chưa có credential', { status: 'ACTIVE', deletedAt: null, credential: null }],
    ['trạng thái credential lạ', { status: 'ACTIVE', deletedAt: null, credential: { status: 'active' } }],
  ])('%s => false', (_n, e) => {
    expect(accountUsable(e)).toBe(false);
  });
});

describe('AuthPoolAssigneeEligibility.canSignIn', () => {
  it('trả đủ mọi id được hỏi; ACTIVE => true, khoá / không credential / không ACTIVE / xoá mềm / id lạ => false', async () => {
    const { port } = make([
      ok('a'),
      { id: 'b', status: 'ACTIVE', deletedAt: null, credential: { status: 'DISABLED' } },
      { id: 'c', status: 'ACTIVE', deletedAt: null, credential: null },
      { id: 'd', status: 'INACTIVE', deletedAt: null, credential: { status: 'ACTIVE' } },
      { id: 'e', status: 'ACTIVE', deletedAt: new Date(), credential: { status: 'ACTIVE' } },
    ]);
    const r = await port.canSignIn(['a', 'b', 'c', 'd', 'e', 'khong-ton-tai']);
    expect([...r.entries()]).toEqual([['a', true], ['b', false], ['c', false], ['d', false], ['e', false], ['khong-ton-tai', false]]);
  });
  it('chỉ đọc cột status của credential — không hash, token_version, bộ đếm khoá; khử id trùng', async () => {
    const { port, findMany } = make([ok('a')]);
    await port.canSignIn(['a', 'a']);
    const arg = findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: { in: ['a'] } });
    expect(arg.select).toEqual({ id: true, status: true, deletedAt: true, credential: { select: { status: true } } });
    expect(JSON.stringify(arg)).not.toMatch(/password|token|locked|failed/i);
  });
  it('kết quả chỉ là boolean theo id — không mang trường nào của credential', async () => {
    const { port } = make([ok('a')]);
    const r = await port.canSignIn(['a']);
    expect(r.get('a')).toBe(true);
    for (const v of r.values()) expect(typeof v).toBe('boolean');
  });
  it('fail-closed: truy vấn lỗi (vd pool không có quyền, id không phải uuid) => false cho MỌI id, không ném lỗi', async () => {
    const { port } = make(new Error('permission denied for table employee_credential'));
    const r = await port.canSignIn(['a', 'b']);
    expect([...r.entries()]).toEqual([['a', false], ['b', false]]);
  });
  it('dòng trả về không thuộc danh sách hỏi bị bỏ qua (không thêm id lạ vào kết quả)', async () => {
    const { port } = make([ok('a'), ok('x')]);
    const r = await port.canSignIn(['a']);
    expect([...r.keys()]).toEqual(['a']);
  });
  it('danh sách rỗng => không truy vấn', async () => {
    const { port, findMany } = make([]);
    expect((await port.canSignIn([])).size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });
});
