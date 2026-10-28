import { isCanonicalUuid, isValidTokenVersion } from './uuid';

describe('isCanonicalUuid (khớp @db.Uuid, fail-closed)', () => {
  it('nhận UUID chuẩn chữ thường', () => {
    expect(isCanonicalUuid('00000000-0000-4000-8000-000000000007')).toBe(true);
    expect(isCanonicalUuid('0a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d')).toBe(true);
  });
  it.each([
    7, 0, NaN, null, undefined, {}, [], true, '', '7', 'not-a-uuid',
    ' 00000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000007 ', '00000000-0000-4000-8000-000000000007\n',
    '00000000-0000-4000-8000-00000000000', '00000000-0000-4000-8000-0000000000077', '00000000000040008000000000000007',
    '{00000000-0000-4000-8000-000000000007}', 'urn:uuid:00000000-0000-4000-8000-000000000007', '0000000g-0000-4000-8000-000000000007',
    'ABCDEF00-0000-4000-8000-000000000007',
  ])('từ chối %p', (v) => { expect(isCanonicalUuid(v)).toBe(false); });
});

describe('isValidTokenVersion (số nguyên an toàn >= 0)', () => {
  it('nhận 0, 1, MAX_SAFE_INTEGER', () => {
    for (const v of [0, 1, 42, Number.MAX_SAFE_INTEGER]) expect(isValidTokenVersion(v)).toBe(true);
  });
  it.each([-1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, '1', null, undefined, {}, 1n])('từ chối %p', (v) => {
    expect(isValidTokenVersion(v)).toBe(false);
  });
});
