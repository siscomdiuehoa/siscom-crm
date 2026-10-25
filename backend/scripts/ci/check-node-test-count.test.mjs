import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluate, parseJunit } from './check-node-test-count.mjs';

const tc = (n) => '<testsuites><testsuite>' + '<testcase name="t"/>'.repeat(n) + '</testsuite></testsuites>';
const script = new URL('./check-node-test-count.mjs', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');

test('0 testcase => fail-closed', () => {
  const r = evaluate('<testsuites></testsuites>', 1);
  assert.equal(r.ok, false);
  assert.match(r.problems.join(), /0 testcase/);
});
test('duoi nguong => fail', () => assert.equal(evaluate(tc(249), 250).ok, false));
test('dat nguong => ok', () => assert.equal(evaluate(tc(288), 250).ok, true));
test('co <failure> => fail du du so luong', () => {
  const xml = tc(300).replace('<testcase name="t"/>', '<testcase name="t"><failure/></testcase>');
  assert.equal(evaluate(xml, 250).ok, false);
});
test('khong nham <testcases> voi <testcase>', () => assert.equal(parseJunit('<testcases/>').testcases, 0));
test('minTests khong hop le (NaN/0) => fail', () => {
  assert.equal(evaluate(tc(5), NaN).ok, false);
  assert.equal(evaluate(tc(5), 0).ok, false);
});
test('CLI: thieu tep => exit 2; rong => exit 1; du => exit 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'junit-'));
  try {
    const run = (f, m) => spawnSync(process.execPath, [script, f, m], { encoding: 'utf8' }).status;
    assert.equal(run(join(dir, 'none.xml'), '1'), 2);
    const empty = join(dir, 'e.xml'); writeFileSync(empty, '<testsuites/>');
    assert.equal(run(empty, '1'), 1);
    const ok = join(dir, 'o.xml'); writeFileSync(ok, tc(3));
    assert.equal(run(ok, '3'), 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// OVN05: test bị skip/todo vẫn là <testcase> + <skipped>; không được tính vào ngưỡng và không được lọt cổng (fail-open trước đây).
const skippedTc = (n) => '<testcase name="s"><skipped type="skipped" message="x"/></testcase>'.repeat(n);
test('toàn bộ test bị skip => fail dù đủ số testcase', () => {
  const xml = `<testsuites><testsuite>${skippedTc(300)}</testsuite></testsuites>`;
  const r = evaluate(xml, 250);
  assert.equal(r.ok, false);
  assert.match(r.problems.join(), /skipped/);
});
test('một test skip trong bộ đủ ngưỡng => fail (cổng offline không cho phép skip)', () => {
  const xml = `<testsuites><testsuite>${'<testcase name="t"/>'.repeat(300)}${skippedTc(1)}</testsuite></testsuites>`;
  assert.equal(evaluate(xml, 250).ok, false);
});
test('ngưỡng chỉ tính test đã chạy: 260 chạy + 50 skip vs ngưỡng 300 => fail', () => {
  const xml = `<testsuites><testsuite>${'<testcase name="t"/>'.repeat(260)}${skippedTc(50)}</testsuite></testsuites>`;
  const r = evaluate(xml, 300);
  assert.equal(r.ok, false);
  assert.equal(r.executed, 260);
});
test('không skip, đủ ngưỡng => vẫn ok (không làm hỏng đường đạt)', () => {
  const r = evaluate(tc(272), 250);
  assert.equal(r.ok, true);
  assert.equal(r.executed, 272);
});
