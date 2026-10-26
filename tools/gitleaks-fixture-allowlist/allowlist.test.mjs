// Kiem thu allowlist gitleaks (2 fixture lich su) bang CHINH scanner gitleaks, khong chi thu regex.
// Khong chua bi mat that: moi mau am tinh la chuoi TONG HOP, ghep luc chay; dong fixture goc doc tu lich su Git.
//
//   GITLEAKS_BIN=<duong dan gitleaks 8.30.1> node --test tools/gitleaks-fixture-allowlist/allowlist.test.mjs
//   GITLEAKS_CONFIG=<tep cau hinh can thu> (mac dinh: .gitleaks.toml o goc repo)
//
// Moi mau am tinh phai bi cau hinh "baseline" (chi giu ngoai le cu, khong co 2 allowlist fixture) phat hien
// truoc; neu khong thi test that bai (tranh test vo nghia). Can lich su day du (fetch-depth 0).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = process.env.GITLEAKS_BIN || 'gitleaks';
const CONFIG = resolve(process.env.GITLEAKS_CONFIG || join(REPO, '.gitleaks.toml'));

const SPEC = { path: 'backend/src/common/auth/http/auth-security.a5.spec.ts', commit: '0b498f4' };
const SQL = { path: 'backend/docs/B1.3_M1_CONSTRAINT_TESTS.sql.txt', commit: 'b36f33e' };

// FAIL-CLOSED: thieu gitleaks hoac sai phien ban => test THAT BAI ro rang (khong skip xanh, khong sinh 0 ca).
// CI kiem them tong ket node:test: tests 25 / skipped 0 / todo 0 / fail 0.
const EXPECTED_VERSION = process.env.GITLEAKS_EXPECTED_VERSION || '8.30.1';
const probe = spawnSync(BIN, ['version'], { encoding: 'utf8' });
if (probe.error || probe.status !== 0) {
  throw new Error(`FAIL-CLOSED: khong chay duoc gitleaks (GITLEAKS_BIN=${BIN}): ${probe.error ? probe.error.message : 'exit ' + probe.status}`);
}
const gotVersion = String(probe.stdout).trim().replace(/^v/, '');
if (gotVersion !== EXPECTED_VERSION) {
  throw new Error(`FAIL-CLOSED: sai phien ban gitleaks: can ${EXPECTED_VERSION}, nhan "${gotVersion}"`);
}

// Mau tong hop do nguoi viet test tao ra, ghep luc chay (khong nam nguyen van trong tep nay).
const synth = (tag) => ['Tong', 'hop', tag, 'Zx7Qm2Lp9Vk4Rw8'].join('-');

const gitShow = (c, p) => execFileSync('git', ['-C', REPO, 'show', `${c}:${p}`], { encoding: 'utf8' });
const fixtureLine = ({ path, commit }, needle) => {
  const lines = gitShow(commit, path).split('\n').filter((l) => l.includes(needle));
  assert.equal(lines.length >= 1, true, `khong tim thay dong fixture trong ${commit}`);
  return lines.find((l) => /^(\s*const SECRET_PW = |INSERT INTO app_meta \(key, value\) VALUES \('auth_bootstrap_done', )/.test(l));
};

// Gitleaks (che do git) co the gom ca ky tu xuong dong dung truoc vao "line" khi dong khong o dau tep/hunk,
// nen moi mau duoc thu o 2 vi tri: dong dau tep va dong sau mot dong dem.
const POSITIONS = { 'dong-dau': '', 'sau-dong-dem': '// dem\n' };
const at = (files, pre) => Object.fromEntries(Object.entries(files).map(([k, v]) => [k, pre + v]));

// "baseline" = cau hinh hien co nhung chi giu ngoai le cu (cat tu comment mo dau 2 allowlist fixture).
const baselineConfig = (dir) => {
  const text = readFileSync(CONFIG, 'utf8').replace(/\r\n/g, '\n');
  const i = text.indexOf('# Hai false positive');
  assert.notEqual(i, -1, 'khong tim thay moc comment cua 2 allowlist fixture');
  const p = join(dir, 'baseline.toml');
  writeFileSync(p, text.slice(0, i));
  return p;
};

// Tao repo git tam 1 commit voi cac tep, quet bang gitleaks, tra ve cac phat hien (da redact).
const scan = (config, files, dir) => {
  const repo = mkdtempSync(join(dir, 'r-'));
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.email', 't@example.invalid');
  git('config', 'user.name', 't');
  git('config', 'commit.gpgsign', 'false');
  for (const [p, content] of Object.entries(files)) {
    const full = join(repo, p);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  git('add', '-A');
  git('commit', '-q', '-m', 'm');
  const report = join(repo, '..', `rep-${Math.random().toString(36).slice(2)}.json`);
  const r = spawnSync(BIN, ['git', '--config', config, '--redact', '--no-banner', '-l', 'error', '--exit-code', '2', '-r', report, repo], { encoding: 'utf8' });
  assert.notEqual(r.status, 1, `gitleaks loi cau hinh/van hanh (exit 1): ${r.stderr}`);
  const found = existsSync(report) ? JSON.parse(readFileSync(report, 'utf8')) : [];
  return found.map((f) => ({ file: f.File, line: f.StartLine, rule: f.RuleID }));
};

const specOrig = fixtureLine(SPEC, 'const SECRET_PW = ');
const sqlOrig = fixtureLine(SQL, "'auth_bootstrap_done', ");
const replaceLiteral = (line, from, to) => {
  assert.ok(line.includes(from), 'dong fixture khong chua literal mong doi');
  return line.replace(from, to);
};
const specLit = /'([^']+)'/.exec(specOrig)[1];
const sqlLit = /, '([^']+)'\);/.exec(sqlOrig)[1];

// [ten, tep -> noi dung, ket qua mong doi voi cau hinh dang thu]
const cases = () => {
  const s = synth('q01');
  const specVariants = {
    'spec: doi literal cung dong': [{ [SPEC.path]: replaceLiteral(specOrig, specLit, s) + '\n' }],
    'spec: noi them secret cung dong': [{ [SPEC.path]: specOrig + ` const OTHER_API_KEY = '${s}';\n` }],
    'spec: secret o dong khac cung tep': [{ [SPEC.path]: specOrig + `\n  const OTHER_API_KEY = '${s}';\n` }],
    'spec: dong goc o tep khac': [{ 'backend/src/other/other.spec.ts': specOrig + '\n' }],
    'spec: path them tien to': [{ ['x/' + SPEC.path]: specOrig + '\n' }],
    'spec: path them hau to .bak': [{ [SPEC.path + '.bak']: specOrig + '\n' }],
  };
  const sqlVariants = {
    'sql: doi literal cung dong': [{ [SQL.path]: replaceLiteral(sqlOrig, sqlLit, s) + '\n' }],
    'sql: noi them secret cung dong': [{ [SQL.path]: sqlOrig + ` -- OTHER_API_KEY = '${s}'\n` }],
    'sql: secret o dong khac cung tep': [{ [SQL.path]: sqlOrig + `\nINSERT INTO app_meta (key, value) VALUES ('auth_bootstrap_done', '${s}');\n` }],
    'sql: dong goc o tep khac': [{ 'backend/docs/OTHER.sql.txt': sqlOrig + '\n' }],
    'sql: path them tien to': [{ ['x/' + SQL.path]: sqlOrig + '\n' }],
    'sql: path them hau to .bak': [{ [SQL.path + '.bak']: sqlOrig + '\n' }],
  };
  return { ...specVariants, ...sqlVariants };
};

test('fixture goc (2 dong lich su tai tep dung) duoc bo qua; baseline van phat hien', () => {
  const dir = mkdtempSync(join(tmpdir(), 'q01-'));
  try {
    const base = baselineConfig(dir);
    for (const [pos, pre] of Object.entries(POSITIONS)) {
      for (const [name, o] of [['spec', { [SPEC.path]: specOrig + '\n' }], ['sql', { [SQL.path]: sqlOrig + '\n' }]]) {
        assert.ok(scan(base, at(o, pre), dir).length >= 1, `${name}/${pos}: baseline phai phat hien fixture goc`);
        assert.deepEqual(scan(CONFIG, at(o, pre), dir), [], `${name}/${pos}: fixture goc phai duoc bo qua boi cau hinh dang thu`);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const [name, [files0]] of Object.entries(cases())) for (const [pos, pre] of Object.entries(POSITIONS)) {
  test(`am tinh van bi phat hien: ${name} [${pos}]`, () => {
    const files = at(files0, pre);
    const dir = mkdtempSync(join(tmpdir(), 'q01-'));
    try {
      const baseN = scan(baselineConfig(dir), files, dir).length;
      assert.ok(baseN >= 1, 'tien dieu kien: baseline phai phat hien mau nay (neu khong test vo nghia)');
      const got = scan(CONFIG, files, dir);
      assert.ok(got.length >= 1, `cau hinh dang thu BO SOT mau am tinh: ${name}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
