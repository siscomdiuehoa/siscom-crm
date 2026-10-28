import { parseLoginIdentifier, LOGIN_IDENTIFIER_MAX_LENGTH } from './login-identifier';

const INVALID = { kind: 'INVALID' };
const U = (cp: number) => String.fromCodePoint(cp);

describe('parseLoginIdentifier — mã nhân viên', () => {
  it.each(['NV-0001', 'NV-1234', 'NV-12345', 'NV-000000001'])('nhận %s', (code) => {
    expect(parseLoginIdentifier(code)).toEqual({ kind: 'EMPLOYEE_CODE', value: code });
  });

  it('cắt khoảng trắng hai đầu (kể cả xuống dòng/tab cuối)', () => {
    expect(parseLoginIdentifier('  NV-0001 \n')).toEqual({ kind: 'EMPLOYEE_CODE', value: 'NV-0001' });
  });

  it.each([
    'nv-0001', 'Nv-0001', 'nV-0001', // không tự viết hoa, không phân biệt hoa/thường
    'NV-123', 'NV-', 'NV0001', 'NV_0001', 'NV-0001a', 'NV-00 01', 'NV--0001', 'XNV-0001', 'NV-0001-',
    'NV-０００１', // chữ số full-width
    'NV-٠٠٠١', // chữ số Ả Rập-Ấn
  ])('từ chối %s', (v) => {
    expect(parseLoginIdentifier(v)).toEqual(INVALID);
  });
});

describe('parseLoginIdentifier — email', () => {
  it('nhận email hợp lệ, giữ nguyên chữ hoa/thường (DB tự lower() hai vế)', () => {
    expect(parseLoginIdentifier('Nguyen.Van@Siscom.VN')).toEqual({ kind: 'EMAIL', value: 'Nguyen.Van@Siscom.VN' });
  });

  it('cắt khoảng trắng hai đầu', () => {
    expect(parseLoginIdentifier('\t a@siscom.vn \r\n')).toEqual({ kind: 'EMAIL', value: 'a@siscom.vn' });
  });

  it('BOM ở hai đầu bị cắt cùng khoảng trắng (trim của JS), BOM ở giữa bị từ chối', () => {
    expect(parseLoginIdentifier(`${U(0xfeff)}a@siscom.vn`)).toEqual({ kind: 'EMAIL', value: 'a@siscom.vn' });
  });

  it('không tự thêm quy tắc Gmail (dấu chấm, +tag giữ nguyên)', () => {
    expect(parseLoginIdentifier('a.b+tag@gmail.com')).toEqual({ kind: 'EMAIL', value: 'a.b+tag@gmail.com' });
  });

  it('chuẩn hóa Unicode NFC (e + dấu ghép => é dựng sẵn)', () => {
    expect(parseLoginIdentifier(`Le${U(0x301)}@siscom.vn`)).toEqual({ kind: 'EMAIL', value: `L${U(0xe9)}@siscom.vn` });
  });

  it('không dùng NFKC: "＠" full-width không thành "@"', () => {
    expect(parseLoginIdentifier(`a${U(0xff20)}siscom.vn`)).toEqual(INVALID);
  });

  it.each([
    'a@@siscom.vn', 'a@b@siscom.vn', '@siscom.vn', 'a@', '@', 'a b@siscom.vn', 'a@sis com.vn',
    'a\u0000@siscom.vn', 'a\u001f@siscom.vn', 'a\u007f@siscom.vn', 'a\u0085@siscom.vn',
    'a\n@siscom.vn', 'a@siscom.vn\u0000', 'a@sis\tcom.vn',
    `a${U(0x200b)}@siscom.vn`, `a${U(0x202e)}@siscom.vn`, `a${U(0xfeff)}@siscom.vn`, `a${U(0x2028)}@siscom.vn`,
    'a\ud800@siscom.vn',
  ])('từ chối %j', (v) => {
    expect(parseLoginIdentifier(v)).toEqual(INVALID);
  });

  it('giới hạn độ dài', () => {
    const domain = '@siscom.vn';
    const ok = 'a'.repeat(LOGIN_IDENTIFIER_MAX_LENGTH - domain.length) + domain;
    expect(ok).toHaveLength(LOGIN_IDENTIFIER_MAX_LENGTH);
    expect(parseLoginIdentifier(ok)).toEqual({ kind: 'EMAIL', value: ok });
    expect(parseLoginIdentifier('a' + ok)).toEqual(INVALID);
  });
});

describe('parseLoginIdentifier — đầu vào xấu và tính đồng nhất', () => {
  it.each([
    undefined, null, 0, 1, true, {}, [], ['NV-0001'], () => 'NV-0001', Symbol('x'), BigInt(10),
    { toString: () => 'NV-0001' },
  ])('không ép kiểu: %#', (v) => {
    expect(parseLoginIdentifier(v)).toEqual(INVALID);
  });

  it.each(['', ' ', '\n', 'abc', 'admin', 'root', "' OR 1=1 --", 'a'.repeat(100_000)])(
    'chuỗi không phải email/mã (%#) => INVALID',
    (v) => {
      expect(parseLoginIdentifier(v)).toEqual(INVALID);
    },
  );

  it('mọi nguyên nhân từ chối cho cùng một kết quả (không lộ lý do, chống dò tài khoản)', () => {
    const results = ['', 'nv-1', 'a@@b', 'a\u0000@b.c', 'x'.repeat(999), 42, null].map((v) => parseLoginIdentifier(v));
    for (const r of results) expect(r).toBe(results[0]);
    expect(Object.keys(results[0])).toEqual(['kind']);
  });

  it('kết quả INVALID bị đóng băng', () => {
    expect(Object.isFrozen(parseLoginIdentifier(''))).toBe(true);
  });

  it('kết quả hợp lệ chỉ có kind/value và không giữ khoảng trắng của đầu vào thô', () => {
    const r = parseLoginIdentifier('  NV-0001  ');
    expect(Object.keys(r).sort()).toEqual(['kind', 'value']);
    expect(JSON.stringify(r)).not.toContain(' ');
  });

  it('idempotent: phân tích lại giá trị đã chuẩn hóa cho cùng kết quả', () => {
    for (const v of [`  Le${U(0x301)}@siscom.vn `, ' NV-0042 ']) {
      const first = parseLoginIdentifier(v) as { kind: string; value: string };
      expect(parseLoginIdentifier(first.value)).toEqual(first);
    }
  });
});
