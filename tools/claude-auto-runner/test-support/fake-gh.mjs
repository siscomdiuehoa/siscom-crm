// gh giả cho kiểm thử Runner (KHÔNG chạm GitHub thật). Trạng thái ở tệp JSON do biến FAKE_GH_STATE chỉ tới:
// { comments:[{id,user,body,created_at,updated_at}], nextId, faults:{ failNext, blackoutUntil, dropResponseOnce,
//   deleteAfterGets:{id,afterGets}, failMessage }, gets }
// Mỗi lần gọi ghi 1 dòng JSON vào FAKE_GH_LOG: {t, kind, ...}.
import fs from "node:fs";

const statePath = process.env.FAKE_GH_STATE;
const logPath = process.env.FAKE_GH_LOG;
const argv = process.argv.slice(2);
const log = (o) => { try { fs.appendFileSync(logPath, JSON.stringify({ t: Date.now(), pid: process.pid, ...o }) + "\n"); } catch {} };
const load = () => JSON.parse(fs.readFileSync(statePath, "utf8"));
const save = (s) => { const tmp = statePath + "." + process.pid + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(s)); fs.renameSync(tmp, statePath); };
const fail = (msg, code = 1) => { process.stderr.write(msg + "\n"); process.exit(code); };
const FAIL_MSG = "stream error: stream ID 1; CANCEL; received from peer";

const s = load();
const f = s.faults || {};
const failMessage = f.failMessage || FAIL_MSG;

// Sự cố giả lập
if (f.blackoutUntil && Date.now() < f.blackoutUntil) { log({ kind: "fail", why: "blackout" }); fail(failMessage); }
if (f.failNext > 0) { f.failNext--; s.faults = f; save(s); log({ kind: "fail", why: "failNext" }); fail(failMessage); }

if (argv[0] === "pr") { log({ kind: "pr" }); process.stdout.write("[]"); process.exit(0); }
if (argv[0] !== "api") { log({ kind: "unknown", argv }); fail("fake-gh: unsupported " + argv.join(" ")); }

const jqIdx = argv.indexOf("--jq");
const jq = jqIdx >= 0 ? argv[jqIdx + 1] : "";
const url = argv.filter((a, i) => !a.startsWith("--") && i !== jqIdx + 1 && a !== "api" && !(argv[i - 1] === "--input")).find((a) => a.startsWith("repos/")) || "";
const isPost = argv.includes("--input");

const readStdin = () => { try { return fs.readFileSync(0, "utf8"); } catch { return ""; } };

if (isPost) {
  const body = JSON.parse(readStdin() || "{}").body || "";
  const id = s.nextId++;
  s.comments.push({ id, user: "siscomdiuehoa", body, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  const drop = f.dropResponseOnce && /CLAUDE_RESULT/.test(body);
  if (drop) { f.dropResponseOnce = false; s.faults = f; }
  save(s);
  log({ kind: "post", id, head: body.slice(0, 60), dropped: !!drop });
  if (drop) fail(failMessage); // máy chủ đã nhận nhưng phản hồi mất
  process.stdout.write(JSON.stringify({ id }));
  process.exit(0);
}

// GET comments
const q = new URL("http://x/" + url);
const page = Number(q.searchParams.get("page") || 1);
const per = Number(q.searchParams.get("per_page") || 100);
const since = q.searchParams.get("since");
// Đếm lần đọc snapshot và (nếu cấu hình) xoá comment SAU lần đọc thứ N — áp dụng TRƯỚC khi tính trang trả về.
const isSnapshot = /CLAUDE_TASK/.test(jq) && /OWNER_APPROVED/.test(jq);
if (isSnapshot) {
  s.gets = (s.gets || 0) + 1;
  const d = f.deleteAfterGets;
  if (d && s.gets > d.afterGets) { s.comments = s.comments.filter((c) => c.id !== d.id); }
  save(s);
}
let list = s.comments.filter((c) => !since || new Date(c.updated_at) >= new Date(since));
const slice = list.slice((page - 1) * per, page * per);
const u = (c) => ({ id: c.id, user: { login: c.user }, body: c.body });

if (isSnapshot) {
  log({ kind: "get-snapshot", page, since: !!since, n: slice.length });
  const out = {
    n: slice.length,
    tasks: slice.filter((c) => c.body.includes("<!-- CLAUDE_TASK -->")).map(u),
    approvals: slice.filter((c) => c.body.includes("OWNER_APPROVED:")).map(u),
    results: slice.filter((c) => c.body.startsWith("<!-- CLAUDE_RESULT source=")).map((c) => ({ id: c.id, user: { login: c.user }, head: c.body.slice(0, 80) })),
  };
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}
// kiểm tra tồn tại marker: jq có dạng [.[]|select(.user.login=="L" and ((.body // "")|startswith("M")))|.id]
const m = /login=="([^"]+)".*startswith\("(.+?)"\)/.exec(jq);
if (m) {
  log({ kind: "get-exists" });
  const ids = slice.filter((c) => c.user === m[1] && c.body.startsWith(m[2])).map((c) => c.id);
  process.stdout.write(JSON.stringify(ids));
  process.exit(0);
}
log({ kind: "get-other", jq: jq.slice(0, 40) });
process.stdout.write(JSON.stringify(slice));
