// Kiểm thử đơn vị (không mạng, không đĩa, không gh/claude thật): retry/backoff, đồng bộ tăng dần,
// đăng comment không nhân đôi, chống nhận trùng, và bảo toàn cơ chế OWNER_APPROVED.
// Chạy: node --test tools/claude-auto-runner/
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { classifyGhError, backoffDelay, createGhClient } from "./ghclient.mjs";
import { createQueueSync, postMarkedComment, PER_PAGE } from "./ghqueue.mjs";
import { chooseQueue, ALLOWED_SCOPES } from "./queue-policy.mjs";

const LOGIN = "siscomdiuehoa";

// ---------- ghclient ----------
function fakeSpawn(plan) {
  const calls = [];
  const fn = (cmd, args) => {
    const step = plan[Math.min(calls.length, plan.length - 1)];
    const call = { cmd, args, stdin: undefined, killed: false };
    calls.push(call);
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.stdin = { on() {}, end(d) { call.stdin = d; } };
    child.kill = () => { call.killed = true; };
    setTimeout(() => {
      if (step.hang) return;
      if (step.out) child.stdout.emit("data", Buffer.from(step.out));
      if (step.err) child.stderr.emit("data", Buffer.from(step.err));
      child.emit("close", step.code ?? 0);
    }, step.delay || 0);
    return child;
  };
  fn.calls = calls;
  return fn;
}
const STREAM = "stream error: stream ID 1; CANCEL; received from peer";
const noSleep = () => Promise.resolve();

test("phân loại lỗi: stream CANCEL/5xx/timeout/rate limit là tạm thời; 401/404/422 là vĩnh viễn; code 0 là ok", () => {
  assert.equal(classifyGhError({ code: 1, err: STREAM }), "transient");
  assert.equal(classifyGhError({ code: 1, err: "HTTP 502: Bad Gateway" }), "transient");
  assert.equal(classifyGhError({ code: -2, error: "gh timed out after 100ms" }), "transient");
  assert.equal(classifyGhError({ code: 1, err: "gh: API rate limit exceeded for user (HTTP 403)" }), "transient");
  assert.equal(classifyGhError({ code: 1, err: "HTTP 401: Bad credentials" }), "permanent");
  assert.equal(classifyGhError({ code: 1, err: "gh: Not Found (HTTP 404)" }), "permanent");
  assert.equal(classifyGhError({ code: 1, err: "HTTP 422: Validation Failed" }), "permanent");
  assert.equal(classifyGhError({ code: 0, out: "{}" }), "ok");
});

test("backoff: tăng theo mũ, bị chặn ở mức tối đa, jitter trong [50%,100%]", () => {
  assert.equal(backoffDelay(1, 1000, 8000, 1), 1000);
  assert.equal(backoffDelay(3, 1000, 8000, 1), 4000);
  assert.equal(backoffDelay(10, 1000, 8000, 1), 8000);
  assert.equal(backoffDelay(1, 1000, 8000, 0), 500);
  for (const a of [1, 2, 3, 4]) { const d = backoffDelay(a, 1000, 8000, 0.5); assert.ok(d >= 500 && d <= 8000); }
});

test("retry: lỗi stream CANCEL hai lần rồi thành công -> ok sau 3 lần, có backoff giữa các lần", async () => {
  const spawnFn = fakeSpawn([{ code: 1, err: STREAM }, { code: 1, err: STREAM }, { code: 0, out: "{\"ok\":1}" }]);
  const sleeps = [];
  const gh = createGhClient({ command: "gh", spawnFn, sleep: async (ms) => { sleeps.push(ms); }, rand: () => 1, baseDelayMs: 100, maxDelayMs: 1000 });
  const r = await gh(["api", "x"]);
  assert.equal(r.code, 0);
  assert.equal(r.attempts, 3);
  assert.deepEqual(sleeps, [100, 200]);
  assert.equal(spawnFn.calls.length, 3);
});

test("lỗi vĩnh viễn (401) KHÔNG thử lại", async () => {
  const spawnFn = fakeSpawn([{ code: 1, err: "HTTP 401: Bad credentials" }]);
  const gh = createGhClient({ spawnFn, sleep: noSleep });
  const r = await gh(["api", "x"]);
  assert.equal(r.code, 1); assert.equal(r.attempts, 1); assert.equal(r.kind, "permanent");
  assert.equal(spawnFn.calls.length, 1);
});

test("hết số lần thử thì trả lỗi cuối cùng (không treo, không nuốt lỗi)", async () => {
  const spawnFn = fakeSpawn([{ code: 1, err: STREAM }]);
  const gh = createGhClient({ spawnFn, sleep: noSleep, maxAttempts: 3 });
  const r = await gh(["api", "x"]);
  assert.equal(r.code, 1); assert.equal(r.attempts, 3); assert.match(r.err, /CANCEL/);
});

test("timeout: gh treo bị kill và trả code -2 (không treo Runner)", async () => {
  const spawnFn = fakeSpawn([{ hang: true }]);
  const gh = createGhClient({ spawnFn, sleep: noSleep, timeoutMs: 30, maxAttempts: 2 });
  const t0 = Date.now();
  const r = await gh(["api", "x"]);
  assert.equal(r.code, -2); assert.match(r.error, /timed out/);
  assert.ok(spawnFn.calls.every((c) => c.killed));
  assert.ok(Date.now() - t0 < 2000);
});

test("không chặn event loop: timer vẫn chạy trong lúc gh đang chờ", async () => {
  const spawnFn = fakeSpawn([{ code: 0, out: "ok", delay: 120 }]);
  const gh = createGhClient({ spawnFn });
  let ticks = 0;
  const iv = setInterval(() => ticks++, 10);
  await gh(["api", "x"]);
  clearInterval(iv);
  assert.ok(ticks >= 5, "ticks=" + ticks);
});

test("input được ghi vào stdin của gh (dùng cho --input -)", async () => {
  const spawnFn = fakeSpawn([{ code: 0, out: "{}" }]);
  const gh = createGhClient({ spawnFn });
  await gh(["api", "x", "--input", "-"], { input: "{\"body\":\"abc\"}" });
  assert.equal(spawnFn.calls[0].stdin, "{\"body\":\"abc\"}");
});

// ---------- ghqueue: đồng bộ tăng dần ----------
const mk = (id, body, login = LOGIN) => ({ id, user: { login }, body });
function fakeSnapshotGh(store) {
  // store.comments: toàn bộ comment; store.calls: URL đã gọi; store.fail: số lần lỗi sắp tới
  return async (args) => {
    const url = args[args.length - 1];
    store.calls.push(url);
    if (store.fail > 0) { store.fail--; return { code: 1, out: "", err: STREAM, error: "" }; }
    const q = new URL("http://x/" + url);
    const page = Number(q.searchParams.get("page")), since = q.searchParams.get("since");
    const per = Number(q.searchParams.get("per_page"));
    const list = store.comments.filter((c) => !since || c.updated >= since).slice((page - 1) * per, page * per);
    const pick = (c) => ({ id: c.id, user: c.user, body: c.body });
    return { code: 0, out: JSON.stringify({
      n: list.length,
      tasks: list.filter((c) => c.body.includes("<!-- CLAUDE_TASK -->")).map(pick),
      approvals: list.filter((c) => c.body.includes("OWNER_APPROVED:")).map(pick),
      results: list.filter((c) => c.body.startsWith("<!-- CLAUDE_RESULT source=")).map((c) => ({ id: c.id, user: c.user, head: c.body.slice(0, 80) })),
    }), err: "", error: "" };
  };
}
const C = (id, body, updated, login = LOGIN) => ({ id, user: { login }, body, updated });

test("đồng bộ: lần đầu là FULL (không since), lần sau TĂNG DẦN (có since) và gộp comment mới; 1 request/lượt", async () => {
  let t = Date.parse("2026-10-26T10:00:00Z");
  const store = { calls: [], fail: 0, comments: [C(1, "<!-- CLAUDE_TASK -->\nSCOPE: CODE_TEST_DRAFT_ONLY", "2026-10-26T09:00:00Z")] };
  const qs = createQueueSync({ ghAsync: fakeSnapshotGh(store), repo: "o/r", issue: 8, login: LOGIN, now: () => t });
  const a = await qs.sync();
  assert.equal(a.mode, "full"); assert.equal(a.requests, 1); assert.ok(!/since=/.test(store.calls[0]));
  assert.deepEqual(a.tasks.map((x) => x.id), [1]);
  store.comments.push(C(2, "OWNER_APPROVED: YES\nTASK_COMMENT_ID: 1\nSCOPE: CODE_TEST_DRAFT_ONLY", "2026-10-26T10:00:30Z"));
  t += 60000;
  const b = await qs.sync();
  assert.equal(b.mode, "incremental"); assert.equal(b.requests, 1); assert.match(store.calls[1], /since=/);
  assert.deepEqual(b.tasks.map((x) => x.id), [1]);       // task cũ vẫn còn trong cache
  assert.deepEqual(b.approvals.map((x) => x.id), [2]);   // approval mới được gộp
});

test("đồng bộ: full resync khi quá hạn và khi ép full; comment đã xoá biến mất khỏi cache", async () => {
  let t = Date.parse("2026-10-26T10:00:00Z");
  const store = { calls: [], fail: 0, comments: [
    C(1, "<!-- CLAUDE_TASK -->\nSCOPE: CODE_TEST_DRAFT_ONLY", "2026-10-26T09:00:00Z"),
    C(2, "OWNER_APPROVED: YES\nTASK_COMMENT_ID: 1\nSCOPE: CODE_TEST_DRAFT_ONLY", "2026-10-26T09:01:00Z"),
  ] };
  const qs = createQueueSync({ ghAsync: fakeSnapshotGh(store), repo: "o/r", issue: 8, login: LOGIN, now: () => t, fullEveryMs: 600000 });
  assert.equal((await qs.sync()).approvals.length, 1);
  store.comments = store.comments.filter((c) => c.id !== 2); // chủ repo xoá approval
  t += 60000;
  assert.equal((await qs.sync()).approvals.length, 1, "tăng dần không thấy việc xoá (đã biết)");
  const forced = await qs.sync({ full: true });
  assert.equal(forced.mode, "full"); assert.equal(forced.approvals.length, 0, "full resync phải thấy approval đã bị xoá");
  store.comments.push(C(3, "OWNER_APPROVED: YES\nTASK_COMMENT_ID: 1\nSCOPE: CODE_TEST_DRAFT_ONLY", "2026-10-26T10:05:00Z"));
  t += 700000;
  assert.equal((await qs.sync()).mode, "full", "quá fullEveryMs thì tự full");
});

test("đồng bộ: request lỗi KHÔNG làm hỏng cache; lượt sau thành công không trùng lặp", async () => {
  let t = Date.parse("2026-10-26T10:00:00Z");
  const store = { calls: [], fail: 0, comments: [C(1, "<!-- CLAUDE_TASK -->\nSCOPE: CODE_TEST_DRAFT_ONLY", "2026-10-26T09:00:00Z")] };
  const qs = createQueueSync({ ghAsync: fakeSnapshotGh(store), repo: "o/r", issue: 8, login: LOGIN, now: () => t });
  await qs.sync();
  store.fail = 1; t += 10000;
  const bad = await qs.sync();
  assert.equal(bad.ok, false); assert.match(bad.error, /CANCEL/);
  t += 10000;
  const good = await qs.sync();
  assert.equal(good.ok, true); assert.deepEqual(good.tasks.map((x) => x.id), [1]);
});

test("đồng bộ: lỗi ở trang 2 của lượt FULL không thay cache cũ (không mất dữ liệu nửa chừng)", async () => {
  let t = Date.parse("2026-10-26T10:00:00Z");
  const many = Array.from({ length: PER_PAGE + 5 }, (_, i) => C(1000 + i, "noise", "2026-10-26T09:00:00Z"));
  many.push(C(5000, "<!-- CLAUDE_TASK -->\nSCOPE: CODE_TEST_DRAFT_ONLY", "2026-10-26T09:00:00Z"));
  const store = { calls: [], fail: 0, comments: many };
  const base = fakeSnapshotGh(store);
  let n = 0;
  const qs = createQueueSync({ ghAsync: async (a) => { n++; if (n === 2) return { code: 1, out: "", err: STREAM, error: "" }; return base(a); }, repo: "o/r", issue: 8, login: LOGIN, now: () => t });
  const r1 = await qs.sync();
  assert.equal(r1.ok, false);                 // trang 2 lỗi
  const r2 = await qs.sync();
  assert.equal(r2.ok, true); assert.equal(r2.requests, 2); assert.deepEqual(r2.tasks.map((x) => x.id), [5000]);
});

test("completedSources chỉ lấy CLAUDE_RESULT do chủ tin cậy đăng và marker phải ở đầu comment", async () => {
  const store = { calls: [], fail: 0, comments: [
    C(1, "<!-- CLAUDE_TASK -->\nSCOPE: CODE_TEST_DRAFT_ONLY", "2026-10-26T09:00:00Z"),
    C(2, "<!-- CLAUDE_RESULT source=1 -->\n## Claude completed", "2026-10-26T09:05:00Z"),
    C(3, "<!-- CLAUDE_RESULT source=77 -->\n## giả mạo", "2026-10-26T09:06:00Z", "someone-else"),
    C(4, "trích dẫn: <!-- CLAUDE_RESULT source=88 --> ở giữa", "2026-10-26T09:07:00Z"),
  ] };
  const s = await createQueueSync({ ghAsync: fakeSnapshotGh(store), repo: "o/r", issue: 8, login: LOGIN, now: () => 1 }).sync();
  assert.deepEqual([...s.completedSources], [1]);
});

// ---------- postMarkedComment ----------
function fakePostGh(store) {
  return async (args, opts = {}) => {
    const isPost = args.includes("--input");
    store.calls.push({ args, input: opts.input, attempts: opts.attempts });
    if (isPost) {
      store.posts++;
      const failMode = store.postPlan.shift();
      if (failMode === "ok") { store.comments.push(JSON.parse(opts.input).body); return { code: 0, out: "{}", err: "", error: "", kind: "ok" }; }
      if (failMode === "lost") { store.comments.push(JSON.parse(opts.input).body); return { code: 1, out: "", err: STREAM, error: "", kind: "transient" }; }
      if (failMode === "permanent") return { code: 1, out: "", err: "HTTP 404: Not Found", error: "", kind: "permanent" };
      return { code: 1, out: "", err: STREAM, error: "", kind: "transient" };
    }
    const marker = /startswith\("(.+?)"\)/.exec(args[2])[1];
    return { code: 0, out: JSON.stringify(store.comments.filter((b) => b.startsWith(marker)).map((_, i) => i + 1)), err: "", error: "", kind: "ok" };
  };
}
const postArgs = (store, extra = {}) => ({ ghAsync: fakePostGh(store), repo: "o/r", issue: 8, marker: "<!-- CLAUDE_RESULT source=9 -->", text: "## T\n\nnoi dung", login: LOGIN, sleep: noSleep, ...extra });

test("đăng comment: thành công ngay, nội dung gửi qua stdin JSON (không dùng -f body=)", async () => {
  const store = { calls: [], comments: [], posts: 0, postPlan: ["ok"] };
  const r = await postMarkedComment(postArgs(store));
  assert.equal(r.ok, true);
  const post = store.calls.find((c) => c.args.includes("--input"));
  assert.ok(post && post.args.includes("-") && !post.args.includes("-f"));
  assert.ok(JSON.parse(post.input).body.startsWith("<!-- CLAUDE_RESULT source=9 -->\n## T"));
});

test("đăng comment: phản hồi bị mất nhưng comment ĐÃ lên -> phát hiện, KHÔNG đăng lần hai (không nhân đôi)", async () => {
  const store = { calls: [], comments: [], posts: 0, postPlan: ["lost", "ok"] };
  const r = await postMarkedComment(postArgs(store));
  assert.equal(r.ok, true); assert.equal(r.recovered, true);
  assert.equal(store.posts, 1); assert.equal(store.comments.length, 1);
});

test("đăng comment: lỗi tạm thời thật sự (chưa lên) -> thử lại tới khi thành công, đúng 1 comment", async () => {
  const store = { calls: [], comments: [], posts: 0, postPlan: ["fail", "fail", "ok"] };
  const r = await postMarkedComment(postArgs(store));
  assert.equal(r.ok, true); assert.equal(store.posts, 3); assert.equal(store.comments.length, 1);
});

test("đăng comment: lỗi vĩnh viễn không thử lại; hết lượt thì trả lỗi để Runner đưa vào hàng chờ", async () => {
  const s1 = { calls: [], comments: [], posts: 0, postPlan: ["permanent"] };
  const a = await postMarkedComment(postArgs(s1));
  assert.equal(a.ok, false); assert.equal(s1.posts, 1);
  const s2 = { calls: [], comments: [], posts: 0, postPlan: ["fail", "fail", "fail", "fail"] };
  const b = await postMarkedComment(postArgs(s2, { attempts: 4 }));
  assert.equal(b.ok, false); assert.equal(s2.posts, 4); assert.equal(s2.comments.length, 0);
});

test("đăng comment dài 60.000 ký tự đi qua stdin, không phụ thuộc giới hạn dòng lệnh", async () => {
  const store = { calls: [], comments: [], posts: 0, postPlan: ["ok"] };
  await postMarkedComment(postArgs(store, { text: "x".repeat(100000) }));
  const post = store.calls.find((c) => c.args.includes("--input"));
  assert.equal(JSON.parse(post.input).body.length, 60000);
  assert.ok(post.args.every((a) => a.length < 200), "không có đối số dài trên dòng lệnh");
});

// ---------- chính sách hàng đợi ----------
const task = (id, scope = "CODE_TEST_DRAFT_ONLY", extra = "") => ({ id, user: { login: LOGIN }, body: "<!-- CLAUDE_TASK -->\nTASK_ID: T" + id + "\nSCOPE: " + scope + "\n" + extra });
const approve = (id, taskId, scope = "CODE_TEST_DRAFT_ONLY") => ({ id, user: { login: LOGIN }, body: "OWNER_APPROVED: YES\nTASK_COMMENT_ID: " + taskId + "\nSCOPE: " + scope });

test("chống nhận trùng: task đã có CLAUDE_RESULT không được chọn lại dù state.processed bị mất", () => {
  const q = chooseQueue([task(10)], [approve(11, 10)], [], LOGIN, new Set([10]));
  assert.equal(q.selected, null); assert.equal(q.eligible, 0);
  const q2 = chooseQueue([task(10)], [approve(11, 10)], [], LOGIN, new Set());
  assert.equal(q2.selected.comment.id, 10);
});

test("KHÔNG nới cơ chế phê duyệt: task chưa duyệt vẫn ở hàng chờ, không bao giờ được chọn", () => {
  const q = chooseQueue([task(20)], [], [], LOGIN, new Set());
  assert.equal(q.selected, null); assert.deepEqual(q.waiting.map((x) => x.id), [20]);
  // approval của task khác / sai scope / sai tác giả / đứng trước task: không có hiệu lực
  assert.equal(chooseQueue([task(21)], [approve(22, 999)], [], LOGIN).selected, null);
  assert.equal(chooseQueue([task(21)], [approve(22, 21, "READ_ONLY_QA")], [], LOGIN).selected, null);
  assert.equal(chooseQueue([task(30)], [{ ...approve(31, 30), user: { login: "mallory" } }], [], LOGIN).selected, null);
  assert.equal(chooseQueue([task(40)], [approve(39, 40)], [], LOGIN).selected, null);
});

test("phạm vi chưa được cho phép (READ_ONLY_DIAGNOSTICS, READ_ONLY) vẫn INVALID — chỉ thêm chẩn đoán, không nới chính sách", () => {
  assert.equal(ALLOWED_SCOPES.has("READ_ONLY_DIAGNOSTICS"), false);
  const q = chooseQueue([task(50, "READ_ONLY_DIAGNOSTICS"), task(51, "READ_ONLY")], [approve(52, 50, "READ_ONLY_DIAGNOSTICS")], [], LOGIN);
  assert.equal(q.selected, null);
  assert.deepEqual(q.invalid.map((x) => [x.id, x.reason, x.scope]), [[50, "INVALID_SCOPE", "READ_ONLY_DIAGNOSTICS"], [51, "INVALID_SCOPE", "READ_ONLY"]]);
});

test("task bị chủ huỷ (STATUS: CANCELLED_BY_OWNER) được xếp 'cancelled', không bị tính là lỗi phạm vi, không chạy", () => {
  const q = chooseQueue([task(60, "READ_ONLY", "STATUS: CANCELLED_BY_OWNER")], [approve(61, 60, "READ_ONLY")], [], LOGIN);
  assert.equal(q.selected, null); assert.deepEqual(q.cancelled.map((x) => x.id), [60]); assert.equal(q.invalid.length, 0);
});

test("thu hồi (OWNER_APPROVED: NO) thắng approval cũ; task FORBIDDEN không chạy", () => {
  const no = { id: 72, user: { login: LOGIN }, body: "OWNER_APPROVED: NO\nTASK_COMMENT_ID: 70\nSTATUS: REVOKED_BY_OWNER" };
  assert.equal(chooseQueue([task(70)], [approve(71, 70), no], [], LOGIN).selected, null);
  const forb = { id: 80, user: { login: LOGIN }, body: "<!-- CLAUDE_TASK -->\nRISK: FORBIDDEN\nSCOPE: CODE_TEST_DRAFT_ONLY" };
  assert.equal(chooseQueue([forb], [approve(81, 80)], [], LOGIN).selected, null);
});
