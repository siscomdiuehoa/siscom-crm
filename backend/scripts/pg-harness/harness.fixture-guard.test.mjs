// Test G-03: fixture hỏng/mất/ký tự lạ/thiếu mảng/chứa bí mật giả → CLI trả exit có mã (không ném exception), không lộ env/token,
// không tới cổng thực thi (không gọi bộ thực thi/adapter). Offline: không DB, không .env, không Prisma, không mạng.
// Chạy: node --test backend/scripts/pg-harness/harness.fixture-guard.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { run, EXIT } from './harness.mjs';

const SENTINEL_TOKEN = 'SYNTH-TOKEN-should-never-print-0123456789';
const SENTINEL_URL = 'postgresql://synthetic_user:SYNTH-PW-never-print@127.0.0.1:55432/siscom_crm_test_x';
const dir = mkdtempSync(join(tmpdir(), 'g03-fixture-'));
const good = JSON.parse(readFileSync(new URL('./fixtures.synthetic.json', import.meta.url), 'utf8'));
const put = (name, content) => { const p = join(dir, name); writeFileSync(p, content); return pathToFileURL(p); };
const env = { SISCOM_PG_APPROVAL_REF: 'ISSUE-8#comment-123456', SISCOM_PG_OWNER_GRANTED_DB: '1', SISCOM_PG_TEST_URL: SENTINEL_URL, SISCOM_API_TOKEN: SENTINEL_TOKEN };
const exec = (argv, fixtureUrl) => {
  const out = []; const err = [];
  const code = run(argv, env, { out: (s) => out.push(s), err: (s) => err.push(s) }, new Date(), false, fixtureUrl);
  return { code, out: out.join('\n'), err: err.join('\n'), all: [...out, ...err].join('\n') };
};
const mutate = (fn) => { const c = structuredClone(good); fn(c); return JSON.stringify(c); };

const bad = [
  ['JSON cú pháp hỏng', () => put('syntax.json', '{ "customers": [ { "key": ')],
  ['file rỗng', () => put('empty.json', '')],
  ['file không tồn tại', () => pathToFileURL(join(dir, 'missing.json'))],
  ['đường dẫn là thư mục', () => pathToFileURL(dir)],
  ['byte UTF-8 không hợp lệ', () => put('badutf8.json', Buffer.concat([Buffer.from('{"customers":[],"contacts":[],"x":"'), Buffer.from([0xff, 0xfe, 0xc3]), Buffer.from('"}')]))],
  ['BOM + ký tự điều khiển NUL', () => put('nul.json', '\u0000{"customers":[]}')],
  ['gốc JSON là null', () => put('null.json', 'null')],
  ['gốc JSON là mảng', () => put('array.json', '[]')],
  ['gốc JSON là chuỗi', () => put('str.json', '"x"')],
  ['thiếu mảng customers', () => put('nocust.json', mutate((c) => { delete c.customers; }))],
  ['customers không phải mảng', () => put('cust-obj.json', mutate((c) => { c.customers = {}; }))],
  ['thiếu mảng contacts', () => put('noct.json', mutate((c) => { delete c.contacts; }))],
  ['phần tử customers là null', () => put('cust-null.json', mutate((c) => { c.customers.push(null); }))],
  ['phần tử contacts là số', () => put('ct-num.json', mutate((c) => { c.contacts.push(7); }))],
  ['khóa nghi bí mật (password)', () => put('pw-key.json', mutate((c) => { c.customers[0].password = 'x'; }))],
  ['giá trị là chuỗi kết nối DB giả', () => put('url-val.json', mutate((c) => { c.customers[0].name = SENTINEL_URL; }))],
  ['giá trị là Bearer token giả', () => put('bearer-val.json', mutate((c) => { c.customers[0].name = `Bearer ${SENTINEL_TOKEN}`; }))],
];

for (const [name, make] of bad) {
  for (const argv of [[], ['--execute']]) {
    test(`fixture hỏng [${name}] ${argv.join(' ') || 'dry-run'} → exit ${EXIT.GATE_DENIED}, không ném, không lộ, không tới cổng`, () => {
      const url = make();
      let r;
      assert.doesNotThrow(() => { r = exec(argv, url); });
      assert.equal(r.code, EXIT.GATE_DENIED);
      assert.match(r.err, /ASSET_INVALID/);
      for (const s of [SENTINEL_TOKEN, SENTINEL_URL, 'SYNTH-PW-never-print', 'ISSUE-8#comment', 'synthetic_user']) assert.ok(!r.all.includes(s), `lộ: ${s}`);
      assert.ok(!/DENIED (APPROVAL|OWNER|GUARD)|NOT_IMPLEMENTED|MODE=DRY_RUN/.test(r.all), 'không được tới cổng thực thi/kế hoạch');
      assert.ok(!/at .*\(.*:\d+:\d+\)|node:internal/.test(r.all), 'không lộ stack trace');
    });
  }
}

test('fixture hợp lệ (đối chứng): dry-run vẫn exit 0; --execute không TTY vẫn bị cổng từ chối, không lộ env', () => {
  const url = put('good.json', JSON.stringify(good));
  const d = exec([], url);
  assert.equal(d.code, EXIT.OK);
  assert.match(d.out, /Kết quả DB integration: NOT_RUN/);
  const e = exec(['--execute'], url);
  assert.equal(e.code, EXIT.GATE_DENIED);
  assert.match(e.err, /DENIED /);
  for (const s of [SENTINEL_TOKEN, SENTINEL_URL, 'SYNTH-PW-never-print']) assert.ok(!e.all.includes(s));
});

test('dọn thư mục tạm', () => { rmSync(dir, { recursive: true, force: true }); });
