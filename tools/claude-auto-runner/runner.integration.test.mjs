// Kiểm thử tích hợp: chạy runner.mjs THẬT như tiến trình con, với gh/claude GIẢ (test-support/), thư mục dữ liệu tạm
// (LOCALAPPDATA trỏ tới thư mục tạm) và cổng ngẫu nhiên. KHÔNG chạm GitHub thật, Claude thật, state/config thật.
// Chạy: node --test tools/claude-auto-runner/
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import http from "node:http";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const LOGIN = "siscomdiuehoa";
const procs = new Set();
const dirs = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

after(() => { for (const p of procs) { try { p.kill(); } catch {} } for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });

function mkEnv({ comments, faults = {}, state = null, cfgExtra = {} }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "runner-it-"));
  dirs.push(root);
  const appDir = path.join(root, "SISCOM-ClaudeRunner");
  fs.mkdirSync(appDir, { recursive: true });
  const ghState = path.join(root, "gh-state.json");
  const e = { root, appDir, ghState, ghLog: path.join(root, "gh-log.jsonl"), claudeLog: path.join(root, "claude-log.jsonl"), port: 0 };
  fs.writeFileSync(ghState, JSON.stringify({ comments: comments.map((c) => ({ created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...c })), nextId: 9000, faults, gets: 0 }));
  fs.writeFileSync(e.ghLog, ""); fs.writeFileSync(e.claudeLog, "");
  if (state) fs.writeFileSync(path.join(appDir, "state.json"), JSON.stringify(state));
  e.cfg = (port) => ({
    queueIssue: 8, repo: "o/r", trustedLogin: LOGIN, repoPath: repoRoot, port,
    claudeCommand: process.execPath, claudePrefixArgs: [path.join(here, "test-support", "fake-claude.mjs")], claudeArgs: ["-p", "{prompt}"],
    ghCommand: process.execPath, ghPrefixArgs: [path.join(here, "test-support", "fake-gh.mjs")],
    gitCommand: "git", pollMs: 120, githubPollSeconds: 10, maxTaskMinutes: 1,
    ghBackoffMs: 20, ghRetries: 3, postBackoffMs: 20, postAttempts: 4, maxBackoffMs: 300, ...cfgExtra,
  });
  return e;
}
const readLines = (f) => fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const ghComments = (e) => JSON.parse(fs.readFileSync(e.ghState, "utf8")).comments;
const setFaults = (e, f) => { const s = JSON.parse(fs.readFileSync(e.ghState, "utf8")); s.faults = { ...s.faults, ...f }; fs.writeFileSync(e.ghState, JSON.stringify(s)); };

async function startRunner(e, port = null) {
  e.port = port || await freePort();
  fs.writeFileSync(path.join(e.appDir, "config.json"), JSON.stringify(e.cfg(e.port)));
  const env = { ...process.env, LOCALAPPDATA: e.root, FAKE_GH_STATE: e.ghState, FAKE_GH_LOG: e.ghLog, FAKE_CLAUDE_LOG: e.claudeLog };
  const proc = spawn(process.execPath, [path.join(here, "runner.mjs")], { env, cwd: repoRoot, windowsHide: true });
  procs.add(proc);
  let out = "";
  proc.stdout.on("data", (d) => { out += d; }); proc.stderr.on("data", (d) => { out += d; });
  const exited = new Promise((res) => proc.on("exit", (code) => { procs.delete(proc); res(code); }));
  return { proc, exited, output: () => out, kill: async () => { try { proc.kill(); } catch {} await exited; } };
}
const getStatus = (port, timeout = 1500) => new Promise((resolve, reject) => {
  const t0 = Date.now();
  const req = http.get({ host: "127.0.0.1", port, path: "/api/status", timeout }, (res) => { let b = ""; res.on("data", (d) => { b += d; }); res.on("end", () => { try { resolve({ ms: Date.now() - t0, body: JSON.parse(b) }); } catch (err) { reject(err); } }); });
  req.on("timeout", () => { req.destroy(new Error("status timeout")); }); req.on("error", reject);
});
async function waitFor(fn, ms = 15000, step = 80) { const t0 = Date.now(); let last; while (Date.now() - t0 < ms) { try { last = await fn(); if (last) return last; } catch {} await sleep(step); } throw new Error("waitFor timeout; last=" + JSON.stringify(last)); }

const T = (id, scope = "CODE_TEST_DRAFT_ONLY", extra = "") => ({ id, user: LOGIN, body: "<!-- CLAUDE_TASK -->\nTASK_ID: TASK-" + id + "\nSCOPE: " + scope + "\n" + extra });
const A = (id, taskId, scope = "CODE_TEST_DRAFT_ONLY") => ({ id, user: LOGIN, body: "OWNER_APPROVED: YES\nTASK_COMMENT_ID: " + taskId + "\nSCOPE: " + scope });
const resultsFor = (e, id) => ghComments(e).filter((c) => c.body.startsWith("<!-- CLAUDE_RESULT source=" + id + " -->"));
const acksFor = (e, id) => ghComments(e).filter((c) => c.body.startsWith("<!-- RUNNER_ACK source=" + id + " -->"));
const claudeStarts = (e) => readLines(e.claudeLog).filter((x) => x.kind === "start").map((x) => x.id);

test("IT1 nhận task hợp lệ -> ACK -> chạy -> RESULT -> chuyển sang task kế tiếp; tuần tự; chưa duyệt/INVALID không chạy", async () => {
  const e = mkEnv({ comments: [
    T(100), A(101, 100), T(102), A(103, 102),
    T(104),                                           // chưa có phê duyệt -> chờ
    T(105, "READ_ONLY"), A(106, 105, "READ_ONLY"), // phạm vi không được phép -> INVALID (READ_ONLY_DIAGNOSTICS đã được owner cho phép 28/10)
    T(107), A(108, 999),                              // approval cho task khác -> không có hiệu lực
  ] });
  const r = await startRunner(e);
  await waitFor(async () => { const s = (await getStatus(e.port)).body; return s.processed?.includes(100) && s.processed?.includes(102); });
  await sleep(600); // cho thêm vài lượt poll: không task nào khác được chạy
  assert.deepEqual(claudeStarts(e).sort(), ["100", "102"]);
  const cl = readLines(e.claudeLog);
  const i100e = cl.findIndex((x) => x.id === "100" && x.kind === "end"), i102s = cl.findIndex((x) => x.id === "102" && x.kind === "start");
  assert.ok(i100e >= 0 && i102s > i100e, "task 102 chỉ bắt đầu sau khi task 100 kết thúc (không chạy song song)");
  for (const id of [100, 102]) { assert.equal(resultsFor(e, id).length, 1, "đúng 1 RESULT cho " + id); assert.equal(acksFor(e, id).length, 1, "đúng 1 ACK cho " + id); }
  const s = (await getStatus(e.port)).body;
  assert.ok(s.queue.waitingIds.includes(104) && s.queue.waitingIds.includes(107));
  assert.ok(s.queue.invalidDetail.includes("105:INVALID_SCOPE(READ_ONLY)"));
  assert.equal(s.claude.state, "idle");
  assert.ok(!s.processed.includes(104) && !s.processed.includes(105) && !s.processed.includes(107));
  await r.kill();
});

test("IT2 GitHub mất kết nối: Runner KHÔNG treo (HTTP vẫn phản hồi nhanh), ghi GH_ERROR, tự phục hồi, task chạy đúng 1 lần, RESULT không nhân đôi", async () => {
  const e = mkEnv({ comments: [T(200), A(201, 200)], faults: { blackoutUntil: Date.now() + 2500, dropResponseOnce: true } });
  const r = await startRunner(e);
  await waitFor(() => getStatus(e.port), 8000, 50); // chờ HTTP lên
  // trong lúc mất kết nối: dashboard/API phải trả lời nhanh
  const samples = [];
  for (let i = 0; i < 8; i++) { samples.push((await getStatus(e.port, 800)).ms); await sleep(150); }
  assert.ok(Math.max(...samples) < 500, "API chậm khi mất kết nối: " + samples.join(","));
  let s = (await getStatus(e.port)).body;
  assert.ok(s.poll.consecutiveErrors > 0, "phải ghi nhận lỗi liên tiếp");
  assert.ok(s.timeline.some((t) => t.type === "GH_ERROR"));
  assert.equal(claudeStarts(e).length, 0, "chưa chạy task khi chưa xác minh được phê duyệt");
  // phục hồi
  await waitFor(async () => (await getStatus(e.port)).body.processed?.includes(200), 20000);
  s = (await getStatus(e.port)).body;
  assert.ok(s.timeline.some((t) => t.type === "GH_RECOVERED"), "phải có sự kiện phục hồi");
  assert.equal(s.poll.consecutiveErrors, 0);
  assert.deepEqual(claudeStarts(e), ["200"]);
  await waitFor(() => resultsFor(e, 200).length >= 1, 15000); // processed được ghi TRƯỚC khi đăng RESULT
  await sleep(1200);                                            // chờ thêm: không được có comment thứ hai
  assert.equal(resultsFor(e, 200).length, 1, "phản hồi đăng bị mất nhưng comment đã lên: không được đăng lần hai");
  assert.equal(fs.existsSync(path.join(e.appDir, "pending-posts.json")) ? JSON.parse(fs.readFileSync(path.join(e.appDir, "pending-posts.json"), "utf8")).length : 0, 0);
  await r.kill();
});

test("IT3 RESULT chưa đăng được (GitHub sập lúc xong việc) được giữ lại rồi đăng sau khi phục hồi; task không chạy lại", async () => {
  const e = mkEnv({ comments: [T(300), A(301, 300)], cfgExtra: { postAttempts: 2 }});
  const r = await startRunner(e);
  await waitFor(() => claudeStarts(e).length === 1, 10000, 30);
  setFaults(e, { blackoutUntil: Date.now() + 2500 }); // sập ngay khi Claude đang chạy/xong
  await waitFor(async () => (await getStatus(e.port)).body.processed?.includes(300), 10000);
  await waitFor(async () => { const s = (await getStatus(e.port)).body; return (s.pendingPosts || []).length > 0 || resultsFor(e, 300).length > 0; }, 10000);
  await waitFor(() => resultsFor(e, 300).length === 1, 20000);
  assert.equal(resultsFor(e, 300).length, 1);
  assert.deepEqual(claudeStarts(e), ["300"]);
  const s = (await getStatus(e.port)).body;
  assert.equal((s.pendingPosts || []).length, 0);
  await r.kill();
});

test("IT4 không chạy hai Runner: Runner thứ hai bị từ chối cổng, THOÁT mã 3 và không ghi đè state của Runner đầu", async () => {
  const e = mkEnv({ comments: [], state: { processed: [], claude: { state: "running", task: "x", lastOutput: "" }, activeTaskId: null, timeline: [] } });
  const r1 = await startRunner(e);
  await waitFor(async () => (await getStatus(e.port)).body.timeline.some((t) => t.type === "RECOVERY"), 8000);
  const r2 = await startRunner(e, e.port);
  const code = await Promise.race([r2.exited, sleep(8000).then(() => "timeout")]);
  assert.equal(code, 3);
  assert.match(r2.output(), /RUNNER_PORT_ERROR/);
  const s = (await getStatus(e.port)).body;
  assert.equal(s.timeline.filter((t) => t.type === "RECOVERY").length, 1, "Runner thứ hai không được chạy lại bước khôi phục");
  const hb1 = s.heartbeat; await sleep(1300);
  assert.notEqual((await getStatus(e.port)).body.heartbeat, hb1, "Runner đầu vẫn sống");
  await r1.kill();
});

test("IT5 khởi động lại không chạy lại task đã xử lý; và dù MẤT state.processed vẫn không chạy lại nhờ comment CLAUDE_RESULT", async () => {
  const e = mkEnv({ comments: [T(400), A(401, 400)] });
  let r = await startRunner(e);
  await waitFor(async () => (await getStatus(e.port)).body.processed?.includes(400));
  await waitFor(() => resultsFor(e, 400).length === 1, 8000);
  await r.kill();
  r = await startRunner(e);                       // khởi động lại, state còn
  await sleep(1200);
  assert.deepEqual(claudeStarts(e), ["400"]);
  await r.kill();
  fs.rmSync(path.join(e.appDir, "state.json"));   // mất state
  r = await startRunner(e);
  await sleep(1500);
  assert.deepEqual(claudeStarts(e), ["400"], "mất state.processed vẫn không nhận trùng");
  assert.equal(resultsFor(e, 400).length, 1);
  await r.kill();
});

test("IT6 phê duyệt bị thu hồi/xoá giữa hai lượt poll: xác minh đầy đủ ngay trước khi chạy -> KHÔNG chạy (fail-closed)", async () => {
  const e = mkEnv({ comments: [T(500), A(501, 500)], faults: { deleteAfterGets: { id: 501, afterGets: 1 } } });
  const r = await startRunner(e);
  await waitFor(async () => (await getStatus(e.port)).body.timeline.some((t) => /không còn hợp lệ/.test(t.message)), 10000);
  await sleep(500);
  assert.equal(claudeStarts(e).length, 0);
  const s = (await getStatus(e.port)).body;
  assert.ok(!s.processed.includes(500));
  assert.ok(s.queue.waitingIds.includes(500) || s.queue.eligible === 0);
  await r.kill();
});

test("IT7 Claude trả BLOCKED/không có outcome: Runner không coi là DONE, vẫn đăng RESULT 'blocked/failed' và chuyển tiếp", async () => {
  const e = mkEnv({ comments: [T(600), A(601, 600), T(602), A(603, 602)], cfgExtra: {} });
  process.env.FAKE_CLAUDE_OUTCOME = "BLOCKED";
  const r = await startRunner(e);
  delete process.env.FAKE_CLAUDE_OUTCOME;
  await waitFor(async () => { const s = (await getStatus(e.port)).body; return s.processed?.includes(600) && s.processed?.includes(602); }, 15000);
  await waitFor(() => resultsFor(e, 600).length === 1 && resultsFor(e, 602).length === 1, 10000);
  const res = resultsFor(e, 600)[0];
  assert.match(res.body, /Claude blocked\/failed/);
  assert.equal(resultsFor(e, 602).length, 1, "task kế tiếp vẫn được nhận sau task bị BLOCKED");
  await r.kill();
});

test("IT8 lỗi thoáng qua (stream CANCEL) được retry TRONG lượt poll: không báo GH_ERROR, task vẫn chạy đúng 1 lần", async () => {
  const e = mkEnv({ comments: [T(700), A(701, 700)], faults: { failNext: 2 } });
  const r = await startRunner(e);
  await waitFor(async () => (await getStatus(e.port)).body.processed?.includes(700), 15000);
  await waitFor(() => resultsFor(e, 700).length === 1, 8000);
  const s = (await getStatus(e.port)).body;
  assert.ok(!s.timeline.some((t) => t.type === "GH_ERROR"), "retry phải che được lỗi thoáng qua");
  assert.ok(readLines(e.ghLog).filter((x) => x.kind === "fail").length >= 2, "đã thật sự có lỗi được giả lập");
  assert.deepEqual(claudeStarts(e), ["700"]);
  await r.kill();
});
