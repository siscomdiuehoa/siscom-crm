import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkPasswordPolicy, COMMON_PASSWORDS, PASSWORD_MAX, PASSWORD_MIN, passwordStrength, POLICY_MESSAGES } from './password-policy';

interface Vec { password: string; email: string | null; code: string | null; ok: boolean; strength: number; note: string }
interface RawVec extends Partial<Vec> { repeat?: [string, number]; suffix?: string }
// Vector dài biểu diễn bằng repeat [đơn vị, số lần] (+ suffix) để file JSON không chứa chuỗi dài bị Gitleaks coi là khoá.
const expand = (v: RawVec): Vec => ({ ...(v as Vec), password: v.password ?? (v.repeat ? v.repeat[0].repeat(v.repeat[1]) + (v.suffix ?? '') : '') });
const vectors: Vec[] = (JSON.parse(readFileSync(join(__dirname, 'password-policy.vectors.json'), 'utf8')).cases as RawVec[]).map(expand);

describe('password-policy (D17) — vector dùng chung BE/FE', () => {
  it('hằng số: 12–128; danh sách phổ biến chữ thường, không trùng', () => {
    expect(PASSWORD_MIN).toBe(12); expect(PASSWORD_MAX).toBe(128);
    expect(COMMON_PASSWORDS.length).toBeGreaterThanOrEqual(25);
    expect(new Set(COMMON_PASSWORDS).size).toBe(COMMON_PASSWORDS.length);
    for (const p of COMMON_PASSWORDS) expect(p).toBe(p.toLowerCase());
  });
  it.each(vectors.map((v) => [v.note, v] as const))('vector: %s', (_n, v) => {
    const problems = checkPasswordPolicy(v.password, { email: v.email, code: v.code });
    expect(problems.length === 0).toBe(v.ok);
    expect(passwordStrength(v.password, { email: v.email, code: v.code })).toBe(v.strength);
  });
  it('thông điệp cụ thể theo từng quy tắc (tiếng Việt, không lộ mật khẩu)', () => {
    expect(checkPasswordPolicy('Abcdefgh1!x', {})).toEqual([POLICY_MESSAGES.length]);
    expect(checkPasswordPolicy('abababab1212', {})).toEqual([POLICY_MESSAGES.classes]);
    expect(checkPasswordPolicy('Admin-Secure#2026', { email: 'admin@siscom.local' })).toEqual([POLICY_MESSAGES.identifier]);
    expect(checkPasswordPolicy('Nv-0003-Strong!', { code: 'NV-0003' })).toEqual([POLICY_MESSAGES.identifier]);
    expect(checkPasswordPolicy('Baaaa-Strong#2026', {})).toEqual([POLICY_MESSAGES.repeat]);
    expect(checkPasswordPolicy('Password12345', {})).toEqual([POLICY_MESSAGES.common]);
    expect(checkPasswordPolicy(' Brand@301085', {})).toEqual([POLICY_MESSAGES.whitespace]);
    expect(checkPasswordPolicy('siscomcrm2026', {})).toEqual(expect.arrayContaining([POLICY_MESSAGES.common])); // F5: tên công ty trong denylist
    expect(COMMON_PASSWORDS).toEqual(expect.arrayContaining(['siscom', 'siscomcrm']));
    const many = checkPasswordPolicy('aaaa', {});
    expect(many).toEqual(expect.arrayContaining([POLICY_MESSAGES.length, POLICY_MESSAGES.classes, POLICY_MESSAGES.repeat]));
    for (const m of Object.values(POLICY_MESSAGES)) expect(m).not.toMatch(/Brand@301085|aaaa/);
  });
  it('đầu vào không phải chuỗi => chỉ báo độ dài, không ném', () => {
    expect(checkPasswordPolicy(undefined as unknown as string, {})).toEqual([POLICY_MESSAGES.length]);
    expect(passwordStrength(null as unknown as string)).toBe(0);
  });
});
