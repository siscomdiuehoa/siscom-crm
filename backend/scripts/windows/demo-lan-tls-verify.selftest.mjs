// Tu kiem T4 cua demo-lan-tls-verify.mjs: doi chieu CA mkcert voi kho CA Windows theo SHA-256 (PR #199, kiem truoc merge).
// Chay: node --test backend\scripts\windows\demo-lan-tls-verify.selftest.mjs
// CHI DOC kho Windows (Get-ChildItem Cert:\...). Khong cai/xoa chung chi, khong doc .env, khong mang.
// Fixture chi la chung chi CONG KHAI: CA (CA thu cua may chu gia lap) va SAME_NAME (CUNG TEN "CN=selftest CA", KHAC khoa).
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readWindowsRootStore, checkCaNotInWindowsStore } from './demo-lan-tls-verify-winstore.mjs';

// Chung chi CONG KHAI nhung truc tiep (repo chan *.pem bang .gitignore). Khoa rieng KHONG nam trong repo.
const CA = `-----BEGIN CERTIFICATE-----
MIIDHTCCAgWgAwIBAgIUS5TkXCWARAuFXrJrisEY57QsazowDQYJKoZIhvcNAQEL
BQAwFjEUMBIGA1UEAwwLc2VsZnRlc3QgQ0EwHhcNMjYxMTAyMDE1OTAyWhcNMjYx
MjAyMDE1OTAyWjAWMRQwEgYDVQQDDAtzZWxmdGVzdCBDQTCCASIwDQYJKoZIhvcN
AQEBBQADggEPADCCAQoCggEBANn9IG2/I/DXz7drvg2+4agQbYjK+E3ja0uBAJbs
oFjaU84omEtr+JLsfkUx/oJ/rGtFjt7MsQlXHkCggQjZR+avXkshpEdqGVqPDPW6
GORQj+Ivx8vJgn3bsIWBafbyUssugWv5fEhyxpjuDYZdYowEMENU5dlDZ0l+ldB+
kgID/pdLbtPphiOGuGMugBfvvuQICxFRuJVvSWz7ZBrgZD4w9KERJLIu8ohD1Byq
hspDib5eb0Q2t80XrD59EqEtNjYGoPrZVZ9OfM9JoNwnxWKNenrPPw+2Khhn0Cw2
L27kYbu6qns2o9cbbY701ABnNaxoDeZocpGgFjsmqAHb8LMCAwEAAaNjMGEwHQYD
VR0OBBYEFGANVWKu6sZnxkvquB+zRlRTf5whMB8GA1UdIwQYMBaAFGANVWKu6sZn
xkvquB+zRlRTf5whMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMA0G
CSqGSIb3DQEBCwUAA4IBAQAjxxahUz1NbKbEZ/GGCZJAMgB5Ft4idy8BzndrjW3T
OVLSgGqk3lX7hFYNZe6H8MbYjD+5g4xWl4Yu/kZ4ow/yI14gGS8WbahceQqwCNsa
7YKjQXWJVFs3cHVko5uf4fU5KS9yCwygeelcwll9F6Th5Wv3Ml4CFddVNsSOGLN9
WtEhbmL+N/hxkC37aJLCPNQFsAPB+cAicsYvCp/V7EIiudLN+3KwSbNM0wvDDeOj
Mp20lXhLuP6s87aTC4KyYDF8KcBhxeanZawITFTMw0wxLy9A0/OnsVaJDEBNR/mn
HUxrhHPBnWERcyR9iEYhRto0V/844MvSZJUy9DmBocXX
-----END CERTIFICATE-----
`;
const SAME_NAME = `-----BEGIN CERTIFICATE-----
MIIDDTCCAfWgAwIBAgIUcX/QkNWNLfpZ9p+GdxmlaZY6laYwDQYJKoZIhvcNAQEL
BQAwFjEUMBIGA1UEAwwLc2VsZnRlc3QgQ0EwHhcNMjYxMTAyMDQ1MDU2WhcNMjYx
MjAyMDQ1MDU2WjAWMRQwEgYDVQQDDAtzZWxmdGVzdCBDQTCCASIwDQYJKoZIhvcN
AQEBBQADggEPADCCAQoCggEBALiE1xVFPZXYq6ZdJH/QdSdOJR22e7V+xoYg3644
3Ko55H+cgxZy8JH7joMvuCAk49aI08SZxhf/pMvFIvro6BiB0Rdz4l6/dYBiANkC
hOY1cZR+uOdPcfK7aUKJvygEWw46blHJ3p6jG/G46VJkVcPi3YKMYP2087OFS/FJ
hREdCSTo4lfLEEyYSx4AIKmbsKHmq42Ymyme+jFTKpbplsPHn7vryNCleLp4oiHF
buKtmRPbEQy3s6cWY+wwbQZwPRj2cG2D+mOc+IOEHMyyL2OtYi/kcv5GbYpB2h2+
R+bCh0jyDGs0SQfv6pb+U8Y0N8/OUQ0JIbyojCtFXz60bdkCAwEAAaNTMFEwHQYD
VR0OBBYEFLySGaeIWfTA7N4JTf2m9iPSexLzMB8GA1UdIwQYMBaAFLySGaeIWfTA
7N4JTf2m9iPSexLzMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEB
AI/yxf0OWoChRbjKey77KpK1dZGSNccn6rx1jSJGokX2FG0/CyDk1wzPJS9UOc9z
W9rYokcUJW9ptMFEQ6xIklEQdaF/uVL436VQ39AVFE0pytYouRUGXGpsYvFxKd2P
Ri/PS6NEwJDSiqWzLCidvSaYEfpEbThMukJ435tJdxLzjI2KnAokavFVijFhk3VG
dEu8SjxbVzGCCXuAaMXsqk/eJtymVtOA0njj5AjKEt+h8NrtU+spGNU1v1j8SIxY
gQ+oV2K4iIQojLt8iRtmNH5MEFgY92u9ub3U5cyk3k940lTZ6Zd0lri6w/ofyBB0
LBJWJz0Tzp5nZcDl1kaclP4=
-----END CERTIFICATE-----
`;
const der = (pem) => new crypto.X509Certificate(pem).raw;
const store = (...certs) => async () => ({ ok: true, certs: certs.map(([s, pem]) => ({ store: s, der: der(pem) })) });
// exec gia: goi callback dung chu ky child_process.execFile.
const fakeExec = (err, stdout = '', stderr = '') => (_f, _a, _o, cb) => setImmediate(() => cb(err, stdout, stderr));
const isWin = process.platform === 'win32';

test('fixture: hai CA cung ten nhung khac SHA-256', () => {
  const a = new crypto.X509Certificate(CA), b = new crypto.X509Certificate(SAME_NAME);
  assert.equal(a.subject, b.subject);
  assert.notEqual(a.fingerprint256, b.fingerprint256);
});

test('CA CO trong kho Windows => PRESENT, ok=false, neu ten kho', async () => {
  const r = await checkCaNotInWindowsStore(CA, { reader: store(['Cert:\\LocalMachine\\Root', SAME_NAME], ['Cert:\\CurrentUser\\Root', CA]) });
  assert.equal(r.ok, false); assert.equal(r.status, 'PRESENT'); assert.match(r.detail, /CurrentUser\\Root/);
});

test('CA KHONG co, chi co CA CUNG TEN khac khoa => NOT_PRESENT (so SHA-256, khong so ten)', async () => {
  const r = await checkCaNotInWindowsStore(CA, { reader: store(['Cert:\\CurrentUser\\Root', SAME_NAME]) });
  assert.equal(r.ok, true); assert.equal(r.status, 'NOT_PRESENT');
});

test('loi doc kho (PowerShell thoat ma loi) => ERROR, khong PASS', async () => {
  const reader = () => readWindowsRootStore({ platform: 'win32', exec: fakeExec(Object.assign(new Error('Command failed'), { code: 1 }), '', 'Get-ChildItem : Access is denied.') });
  const r = await checkCaNotInWindowsStore(CA, { reader });
  assert.equal(r.ok, false); assert.equal(r.status, 'ERROR'); assert.match(r.detail, /READ_ERROR: Get-ChildItem : Access is denied/);
});

test('qua thoi gian doc kho => ERROR TIMEOUT, khong PASS', async () => {
  const reader = () => readWindowsRootStore({ platform: 'win32', timeoutMs: 5, exec: fakeExec(Object.assign(new Error('killed'), { killed: true, signal: 'SIGTERM' })) });
  const r = await checkCaNotInWindowsStore(CA, { reader });
  assert.equal(r.ok, false); assert.equal(r.status, 'ERROR'); assert.match(r.detail, /TIMEOUT/);
});

test('dau ra bi cat (thieu END) => ERROR, khong PASS', async () => {
  const b64 = der(SAME_NAME).toString('base64');
  const reader = () => readWindowsRootStore({ platform: 'win32', exec: fakeExec(null, 'C Cert:\\CurrentUser\\Root ' + b64 + '\r\n') });
  const r = await checkCaNotInWindowsStore(CA, { reader });
  assert.equal(r.ok, false); assert.match(r.detail, /thieu dong END/);
});

test('kho doc ra 0 chung chi => ERROR, khong PASS', async () => {
  const reader = () => readWindowsRootStore({ platform: 'win32', exec: fakeExec(null, 'END\r\n') });
  const r = await checkCaNotInWindowsStore(CA, { reader });
  assert.equal(r.ok, false); assert.match(r.detail, /0 chung chi/);
});

test('khong phai Windows => ERROR, khong PASS', async () => {
  const r = await checkCaNotInWindowsStore(CA, { reader: () => readWindowsRootStore({ platform: 'linux' }) });
  assert.equal(r.ok, false); assert.match(r.detail, /NOT_WINDOWS/);
});

test('dau ra PowerShell dung dinh dang => tach dung tung chung chi va kho', async () => {
  const out = 'C Cert:\\CurrentUser\\Root ' + der(SAME_NAME).toString('base64') + '\r\nC Cert:\\LocalMachine\\Root ' + der(CA).toString('base64') + '\r\nEND\r\n';
  const r = await checkCaNotInWindowsStore(CA, { reader: () => readWindowsRootStore({ platform: 'win32', exec: fakeExec(null, out) }) });
  assert.equal(r.status, 'PRESENT'); assert.match(r.detail, /LocalMachine\\Root/);
});

// ---- Kho Windows THAT (chi doc) ----
test('THAT: CA thu KHONG co trong kho Windows => NOT_PRESENT', { skip: !isWin }, async () => {
  const r = await checkCaNotInWindowsStore(CA);
  assert.equal(r.status, 'NOT_PRESENT', r.detail);
});

test('THAT: mot CA goc dang co trong kho Windows => PRESENT (khong can cai them gi)', { skip: !isWin }, async () => {
  const real = await readWindowsRootStore();
  assert.equal(real.ok, true, real.detail);
  const c = real.certs.find((x) => x.store === 'Cert:\\CurrentUser\\Root');
  const pem = new crypto.X509Certificate(c.der).toString();
  const r = await checkCaNotInWindowsStore(pem);
  assert.equal(r.status, 'PRESENT', r.detail);
});

test('THAT: duong dan PowerShell sai => READ_ERROR, khong PASS', { skip: !isWin }, async () => {
  const r = await checkCaNotInWindowsStore(CA, { reader: () => readWindowsRootStore({ psPath: 'C:\\khong-ton-tai\\powershell.exe' }) });
  assert.equal(r.status, 'ERROR'); assert.match(r.detail, /READ_ERROR/);
});

test('THAT: gioi han thoi gian 1 ms => TIMEOUT, khong PASS', { skip: !isWin }, async () => {
  const r = await checkCaNotInWindowsStore(CA, { reader: () => readWindowsRootStore({ timeoutMs: 1 }) });
  assert.equal(r.status, 'ERROR'); assert.match(r.detail, /TIMEOUT/);
});

// ---- Script chinh LUON chay khi goi truc tiep (QA Codex PR #199: ban co nhan dien isMain thoat 0 im lang khi chay qua symlink) ----
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const runNoArgs = (dir) => spawnSync(process.execPath, [path.join(dir, 'demo-lan-tls-verify.mjs')], { encoding: 'utf8', timeout: 30000 });
test('chay truc tiep khong tham so => BLOCKED, ma 2 (khong bao gio thoat 0 im lang)', () => {
  const r = runNoArgs(SCRIPT_DIR);
  assert.equal(r.status, 2, r.stdout + r.stderr); assert.match(r.stdout, /BLOCKED/);
});
test('chay qua lien ket thu muc (junction/symlink) khong tham so => BLOCKED, ma 2', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'siscom-tlsv-'));
  const link = path.join(tmp, 'lien-ket');
  try { fs.symlinkSync(SCRIPT_DIR, link, 'junction'); } catch (e) { fs.rmSync(tmp, { recursive: true, force: true }); t.skip('khong tao duoc lien ket: ' + e.code); return; }
  try {
    const r = runNoArgs(link);
    assert.equal(r.status, 2, r.stdout + r.stderr); assert.match(r.stdout, /BLOCKED/);
  } finally { fs.unlinkSync(link); fs.rmSync(tmp, { recursive: true, force: true }); }
});
