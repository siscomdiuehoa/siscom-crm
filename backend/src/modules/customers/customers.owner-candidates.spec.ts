import type { Actor } from '../../common/auth/actor';
import { candidateWhere, effectiveCandidateScope, listOwnerCandidates, OWNER_CANDIDATES_MAX, widestScope } from './customers.owner-candidates';

const me: Actor = { employeeId: 'e1', departmentId: 'd1' };
const noDept: Actor = { employeeId: 'e9', departmentId: null };

describe('widestScope', () => {
  it('lấy phạm vi rộng nhất của create/update; null khi cả hai null', () => {
    expect(widestScope(null, null)).toBeNull();
    expect(widestScope('OWN', null)).toBe('OWN');
    expect(widestScope(null, 'DEPARTMENT')).toBe('DEPARTMENT');
    expect(widestScope('OWN', 'ALL')).toBe('ALL');
    expect(widestScope('DEPARTMENT', 'OWN')).toBe('DEPARTMENT');
    expect(widestScope('ALL', 'DEPARTMENT')).toBe('ALL');
  });
});

describe('candidateWhere / effectiveCandidateScope', () => {
  it('ALL: mọi nhân viên ACTIVE chưa xoá; DEPARTMENT: cùng phòng; OWN: chính mình; DEPARTMENT không có phòng => chính mình', () => {
    expect(candidateWhere(me, 'ALL')).toEqual({ status: 'ACTIVE', deletedAt: null });
    expect(candidateWhere(me, 'DEPARTMENT')).toEqual({ status: 'ACTIVE', deletedAt: null, departmentId: 'd1' });
    expect(candidateWhere(me, 'OWN')).toEqual({ status: 'ACTIVE', deletedAt: null, id: 'e1' });
    expect(effectiveCandidateScope(noDept, 'DEPARTMENT')).toBe('OWN');
    expect(candidateWhere(noDept, 'DEPARTMENT')).toEqual({ status: 'ACTIVE', deletedAt: null, id: 'e9' });
  });
});

describe('listOwnerCandidates', () => {
  it('chỉ chọn id/code/fullName/mã phòng, sắp theo tên, chặn tối đa; không lộ email/điện thoại', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { id: 'e2', code: 'NV-0002', fullName: 'An', department: { code: 'KD' } },
      { id: 'e3', code: 'NV-0003', fullName: 'Bình', department: null },
    ]);
    const r = await listOwnerCandidates({ employee: { findMany } } as never, me, 'DEPARTMENT');
    expect(r).toEqual({ scope: 'DEPARTMENT', items: [{ id: 'e2', code: 'NV-0002', fullName: 'An', departmentCode: 'KD' }, { id: 'e3', code: 'NV-0003', fullName: 'Bình', departmentCode: null }], truncated: false });
    const arg = findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ status: 'ACTIVE', deletedAt: null, departmentId: 'd1' });
    expect(arg.select).toEqual({ id: true, code: true, fullName: true, department: { select: { code: true } } });
    expect(arg.orderBy).toEqual([{ fullName: 'asc' }, { code: 'asc' }]);
    expect(arg.take).toBe(OWNER_CANDIDATES_MAX + 1); // T-09: đọc thêm một dòng để biết có bị cắt không
    expect(JSON.stringify(r)).not.toMatch(/email|phone/);
  });
  it('T-09: nhiều hơn OWNER_CANDIDATES_MAX người => trả đúng OWNER_CANDIDATES_MAX người đầu và truncated = true; vừa đủ => truncated = false', async () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ id: 'e' + i, code: 'NV-' + i, fullName: 'NV ' + String(i).padStart(4, '0'), department: null }));
    const over = await listOwnerCandidates({ employee: { findMany: jest.fn().mockResolvedValue(mk(OWNER_CANDIDATES_MAX + 1)) } } as never, me, 'ALL');
    expect(over.items.length).toBe(OWNER_CANDIDATES_MAX);
    expect(over.truncated).toBe(true);
    expect(over.items[OWNER_CANDIDATES_MAX - 1].id).toBe('e' + (OWNER_CANDIDATES_MAX - 1));
    const exact = await listOwnerCandidates({ employee: { findMany: jest.fn().mockResolvedValue(mk(OWNER_CANDIDATES_MAX)) } } as never, me, 'ALL');
    expect([exact.items.length, exact.truncated]).toEqual([OWNER_CANDIDATES_MAX, false]);
  });
});
