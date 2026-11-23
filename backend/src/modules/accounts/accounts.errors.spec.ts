import { DomainException } from '../../common/errors/domain.exception';
import { accountErrors, mapAccountDbError } from './accounts.errors';

// P1: lỗi của database (hàm fn_auth_* / trigger M1) mang MÃ ở tiền tố thông báo. Bộ lọc chung gộp chúng thành 409 chung chung;
// module accounts đọc tiền tố để trả đúng mã + câu tiếng Việt rõ nghĩa, và không bao giờ đưa nguyên văn lỗi database ra ngoài.
const pgError = (message: string, code = '23514') => Object.assign(new Error('Raw query failed. Code: `' + code + '`. Message: `ERROR: ' + message + '`'), {
  code: 'P2010', meta: { code, message: 'ERROR: ' + message },
});

describe('accountErrors', () => {
  it('mỗi lỗi có đúng mã HTTP và mã ổn định', () => {
    const table: [DomainException, number, string][] = [
      [accountErrors.forbidden(), 403, 'FORBIDDEN'],
      [accountErrors.unavailable(), 503, 'ACCOUNT_ADMIN_UNAVAILABLE'],
      [accountErrors.noSystemRequester(), 503, 'SYSTEM_REQUESTER_UNAVAILABLE'],
      [accountErrors.validation(['x']), 400, 'VALIDATION_FAILED'],
      [accountErrors.notFound(), 404, 'ACCOUNT_NOT_FOUND'],
      [accountErrors.selfModification(), 403, 'SELF_MODIFICATION'],
      [accountErrors.systemAccount(), 403, 'SYSTEM_ACCOUNT'],
      [accountErrors.lastAdmin(), 409, 'LAST_ADMIN'],
      [accountErrors.lastApprover(), 409, 'LAST_APPROVER'],
      [accountErrors.emailTaken(), 409, 'EMAIL_TAKEN'],
      [accountErrors.versionConflict(), 409, 'VERSION_CONFLICT'],
      [accountErrors.multiRole(), 409, 'MULTI_ROLE_UNSUPPORTED'],
      [accountErrors.state('x'), 409, 'ACCOUNT_STATE'],
      [accountErrors.rateLimited(), 429, 'RATE_LIMITED'],
    ];
    for (const [e, status, code] of table) expect({ status: e.getStatus(), code: e.code }).toEqual({ status, code });
  });
  it('validation mang danh sách lỗi trong details', () => {
    expect(accountErrors.validation(['Chưa nhập họ tên.']).details).toEqual(['Chưa nhập họ tên.']);
  });
});

describe('mapAccountDbError', () => {
  const cases: [string, string, number, string][] = [
    ['LAST_ADMIN: khong the go admin cuoi cung.', '23001', 409, 'LAST_ADMIN'],
    ['LAST_APPROVER: khong the khoa nguoi duyet cuoi cung.', '23001', 409, 'LAST_APPROVER'],
    ['SELF_MODIFICATION: khong tu tao credential cho chinh minh.', '23514', 403, 'SELF_MODIFICATION'],
    ['SYSTEM_ACCOUNT: khong sua tai khoan he thong.', '23514', 403, 'SYSTEM_ACCOUNT'],
    ['EMAIL_TAKEN: email da duoc mot nhan vien khac dung.', '23505', 409, 'EMAIL_TAKEN'],
    ['VERSION_CONFLICT: thong tin nhan vien vua duoc nguoi khac sua.', '40001', 409, 'VERSION_CONFLICT'],
    ['APPROVAL_REQUIRED: nguoi thao tac khong co quyen nhom APPROVE.', '42501', 403, 'FORBIDDEN'],
    ['TWO_PERSON: nguoi duyet phai khac nguoi yeu cau.', '23514', 403, 'SELF_MODIFICATION'],
    ['BOOTSTRAP_OPEN: API dac quyen chi dung sau khi dong khoi tao.', '42501', 503, 'ACCOUNT_ADMIN_UNAVAILABLE'],
  ];
  it.each(cases)('tiền tố "%s" => đúng mã', (message, sqlstate, status, code) => {
    const e = mapAccountDbError(pgError(message, sqlstate));
    expect(e).toBeInstanceOf(DomainException);
    expect({ status: e!.getStatus(), code: e!.code }).toEqual({ status, code });
  });
  it('đọc được tiền tố khi thông báo chỉ nằm trong message của Error (không có meta)', () => {
    expect(mapAccountDbError(new Error('ERROR: LAST_APPROVER: x'))?.code).toBe('LAST_APPROVER');
  });
  it('lỗi không có tiền tố đã biết => null (để bộ lọc chung xử lý)', () => {
    expect(mapAccountDbError(pgError('duplicate key value violates unique constraint "uq_x"', '23505'))).toBeNull();
    expect(mapAccountDbError(new Error('connect ECONNREFUSED'))).toBeNull();
    expect(mapAccountDbError(null)).toBeNull();
    expect(mapAccountDbError('LAST_ADMIN: chuoi tran')).toBeNull();
  });
  it('tiền tố phải đứng đầu thông báo của database, không khớp khi chỉ xuất hiện giữa câu', () => {
    expect(mapAccountDbError(pgError('gia tri "LAST_ADMIN: x" khong hop le', '22000'))).toBeNull();
  });
  it('DomainException đi qua nguyên vẹn', () => {
    const d = accountErrors.emailTaken();
    expect(mapAccountDbError(d)).toBe(d);
  });
  it('thông báo trả ra là tiếng Việt cố định, không chứa nguyên văn lỗi database', () => {
    const e = mapAccountDbError(pgError('EMAIL_TAKEN: email bi-mat@example.invalid da duoc dung boi NV-0009', '23505'))!;
    expect(e.message).not.toContain('bi-mat@example.invalid');
    expect(e.message).not.toContain('NV-0009');
    expect(e.message).not.toMatch(/ERROR|EMAIL_TAKEN/);
  });
});
