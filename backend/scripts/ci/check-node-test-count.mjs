// Kiem tra bao cao JUnit cua `node --test`: dem testcase THUC, fail-closed.
// Ly do: `node --test` thoat ma 0 voi 0 test khi glob khong khop (xem docs/PG_HARNESS_CI_EVIDENCE_PLAN.md, PR #128).
// Khong DB, khong .env, khong mang. Dung: node check-node-test-count.mjs <junit.xml> <minTests>
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function parseJunit(xml) {
  // Chi dem phan tu <testcase> that (khong dem <testcases>); node --test ghi mot <testcase> cho moi test/subtest la ca la.
  const testcases = (xml.match(/<testcase\b/g) ?? []).length;
  const failures = (xml.match(/<failure\b/g) ?? []).length;
  const errors = (xml.match(/<error\b/g) ?? []).length;
  const skipped = (xml.match(/<skipped\b/g) ?? []).length;
  return { testcases, failures, errors, skipped };
}

export function evaluate(xml, minTests) {
  const r = parseJunit(xml);
  const problems = [];
  if (!Number.isInteger(minTests) || minTests < 1) problems.push(`minTests khong hop le: ${minTests}`);
  if (r.testcases === 0) problems.push('0 testcase: glob rong hoac bao cao rong');
  else if (r.testcases < minTests) problems.push(`${r.testcases} testcase < nguong ${minTests}`);
  if (r.failures > 0 || r.errors > 0) problems.push(`failures=${r.failures} errors=${r.errors}`);
  return { ...r, minTests, ok: problems.length === 0, problems };
}

function main(argv) {
  const [file, min] = argv;
  if (!file || min === undefined) {
    console.error('Dung: node check-node-test-count.mjs <junit.xml> <minTests>');
    return 2;
  }
  let xml;
  try {
    xml = readFileSync(file, 'utf8');
  } catch (e) {
    console.error(`Khong doc duoc bao cao: ${e.code ?? e.message}`);
    return 2;
  }
  const res = evaluate(xml, Number(min));
  console.log(
    `node --test JUnit: testcase=${res.testcases} failures=${res.failures} errors=${res.errors} skipped=${res.skipped} nguong>=${res.minTests}`,
  );
  if (!res.ok) {
    for (const p of res.problems) console.error(`LOI: ${p}`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
