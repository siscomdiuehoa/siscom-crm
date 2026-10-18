import { isEmailB1 } from './vn-email';
import { isVnPhone, normalizePhoneE164 } from './vn-phone';
import { isTaxId } from './vn-tax-id';
import { isWebsite } from './vn-website';

// Các ca bám bộ test frontend customer-optional-fields.test.html (B1.1).
describe('validators B1.1', () => {
  it.each(['0903123456', '0903 123 456', '028 3822 1234', '+84 903 123 456', '+84 28 3822 1234', '0084 903123456', '(028) 3822-1234', '02743700100', '+1 415 555 2671', '+82 2 1234 5678', '+44 20 7946 0958'])('SĐT hợp lệ: %s', (p) => expect(isVnPhone(p)).toBe(true));
  it.each(['', '123', '903123456', '+84', '+84 12', '0123', '+0 123456789', 'abcdefghij', '+1 23', '09031234567890'])('SĐT không hợp lệ: "%s"', (p) => expect(isVnPhone(p)).toBe(false));
  it('phone_e164: VN -> +84, quốc tế giữ nguyên, sai -> null', () => {
    expect(normalizePhoneE164('0903 123 456')).toBe('+84903123456');
    expect(normalizePhoneE164('+84 903 123 456')).toBe('+84903123456');
    expect(normalizePhoneE164('0084 903123456')).toBe('+84903123456');
    expect(normalizePhoneE164('+82 2 1234 5678')).toBe('+82212345678');
    expect(normalizePhoneE164('123')).toBeNull();
  });
  it('MST', () => {
    expect(isTaxId('0312345678')).toBe(true);
    expect(isTaxId('0312345678-001')).toBe(true);
    expect(isTaxId('12345')).toBe(false);
    expect(isTaxId('031234567x')).toBe(false);
  });
  it('email / website', () => {
    expect(isEmailB1('a@b.vn')).toBe(true);
    expect(isEmailB1('x@')).toBe(false);
    expect(isEmailB1('a b@c.vn')).toBe(false);
    expect(isWebsite('congty.vn')).toBe(true);
    expect(isWebsite('https://www.congty.vn/trang')).toBe(true);
    expect(isWebsite('a b')).toBe(false);
  });
});
