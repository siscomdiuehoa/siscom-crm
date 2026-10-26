// Đọc hàng đợi task từ comment của issue, có giới hạn bộ nhớ (chống ENOBUFS).
// Mỗi lần chỉ lấy 1 trang; gh --jq loại comment không phải CLAUDE_TASK
// (CLAUDE_RESULT có thể tới 60KB/comment) trước khi vào buffer của Node.
export const TASK_MARKER = "<!-- CLAUDE_TASK -->";
export const PER_PAGE = 100;
export const MAX_PAGES = 50;

const JQ = '{n:length,tasks:[.[]|select((.body // "")|contains("' + TASK_MARKER + '"))|{id:.id,user:{login:.user.login},body:.body}]}';

// ghRun(args) -> {code,out,err,error}. Trả {ok,error,comments}; comments theo thứ tự cũ -> mới.
export function fetchTaskComments(ghRun, repo, issue, { maxPages = MAX_PAGES } = {}) {
  const comments = [];
  for (let page = 1; page <= maxPages; page++) {
    const r = ghRun(["api", "--jq", JQ, "repos/" + repo + "/issues/" + issue + "/comments?per_page=" + PER_PAGE + "&page=" + page]);
    if (r.code !== 0) return { ok: false, error: r.err || r.error || "gh api failed", comments };
    let p;
    try { p = JSON.parse(r.out); } catch { return { ok: false, error: "gh output không phải JSON (page " + page + ")", comments }; }
    comments.push(...(p.tasks || []));
    if (!(p.n >= PER_PAGE)) break;
  }
  return { ok: true, comments };
}

// SISCOM_V4_APPROVAL: read separate approval comments; page limit preserved.
const APPROVAL_JQ='{n:length,approvals:[.[]|select((.body // "")|contains("OWNER_APPROVED:"))|{id:.id,user:{login:.user.login},body:.body}]}';
export function fetchApprovalComments(ghRun,repo,issue,{maxPages=MAX_PAGES}={}){
 const comments=[];
 for(let page=1;page<=maxPages;page++){
  const x=ghRun(["api","--jq",APPROVAL_JQ,"repos/"+repo+"/issues/"+issue+"/comments?per_page="+PER_PAGE+"&page="+page]);
  if(x.code!==0)return {ok:false,error:x.err||x.error||"gh api failed",comments};
  let p;try{p=JSON.parse(x.out)}catch{return {ok:false,error:"invalid JSON page "+page,comments}}
  comments.push(...(p.approvals||[]));
  if(!(p.n>=PER_PAGE))break;
 }
 return {ok:true,comments};
}

// ---------------------------------------------------------------------------------------------
// Bản bất đồng bộ + tăng dần (incremental). Giữ nguyên các hàm đồng bộ ở trên (đã có test).
// Mục tiêu: mỗi lượt poll chỉ tốn 1 request (thay vì 2 x số trang), không chặn event loop, và
// không mất trạng thái khi một request lỗi (chỉ thay cache sau khi MỌI trang của lượt đó thành công).
// ---------------------------------------------------------------------------------------------
export const RESULT_MARKER_PREFIX = "<!-- CLAUDE_RESULT source=";
export const APPROVAL_MARKER = "OWNER_APPROVED:";

// Một lần gọi cho cả 3 loại comment; kết quả chỉ giữ id + 80 ký tự đầu (CLAUDE_RESULT có thể tới 60KB).
const SNAPSHOT_JQ =
  '{n:length,' +
  'tasks:[.[]|select((.body // "")|contains("' + TASK_MARKER + '"))|{id:.id,user:{login:.user.login},body:.body}],' +
  'approvals:[.[]|select((.body // "")|contains("' + APPROVAL_MARKER + '"))|{id:.id,user:{login:.user.login},body:.body}],' +
  'results:[.[]|select((.body // "")|startswith("' + RESULT_MARKER_PREFIX + '"))|{id:.id,user:{login:.user.login},head:((.body // "")|.[0:80])}]}';

const byId = (a, b) => a.id - b.id;
const errMsg = (r) => String((r && (r.err || r.error)) || "gh api failed").trim().slice(0, 300);

// ghAsync(args,{attempts,timeout,input}) -> Promise<{code,out,err,error}>
export function createQueueSync({
  ghAsync, repo, issue, login, now = () => Date.now(),
  fullEveryMs = 30 * 60 * 1000, overlapMs = 5 * 60 * 1000, maxPages = MAX_PAGES,
}) {
  const tasks = new Map(), approvals = new Map(), results = new Map();
  let lastStart = null, lastFull = 0;

  async function sync({ full = false } = {}) {
    const doFull = full || lastStart === null || now() - lastFull >= fullEveryMs;
    const startedAt = now();
    const since = doFull ? null : new Date(lastStart - overlapMs).toISOString();
    const found = { tasks: [], approvals: [], results: [] };
    let requests = 0;
    for (let page = 1; page <= maxPages; page++) {
      const url = "repos/" + repo + "/issues/" + issue + "/comments?per_page=" + PER_PAGE + "&page=" + page + (since ? "&since=" + encodeURIComponent(since) : "");
      const r = await ghAsync(["api", "--jq", SNAPSHOT_JQ, url]);
      requests++;
      if (r.code !== 0) return { ok: false, error: errMsg(r), mode: doFull ? "full" : "incremental", requests };
      let p;
      try { p = JSON.parse(r.out); } catch { return { ok: false, error: "gh output không phải JSON (page " + page + ")", mode: doFull ? "full" : "incremental", requests }; }
      found.tasks.push(...(p.tasks || [])); found.approvals.push(...(p.approvals || [])); found.results.push(...(p.results || []));
      if (!(p.n >= PER_PAGE)) break;
    }
    // Chỉ thay cache khi cả lượt thành công.
    if (doFull) { tasks.clear(); approvals.clear(); results.clear(); lastFull = startedAt; }
    for (const t of found.tasks) tasks.set(t.id, t);
    for (const a of found.approvals) approvals.set(a.id, a);
    for (const x of found.results) results.set(x.id, x);
    lastStart = startedAt;
    // Chỉ coi là "đã có kết quả" khi comment CLAUDE_RESULT do chính chủ tin cậy đăng.
    const completedSources = new Set();
    for (const x of results.values()) {
      if (x.user?.login !== login) continue;
      const m = /^<!-- CLAUDE_RESULT source=(\d+) -->/.exec(x.head || "");
      if (m) completedSources.add(Number(m[1]));
    }
    return {
      ok: true, mode: doFull ? "full" : "incremental", requests,
      tasks: [...tasks.values()].sort(byId), approvals: [...approvals.values()].sort(byId), completedSources,
    };
  }
  return { sync, reset() { tasks.clear(); approvals.clear(); results.clear(); lastStart = null; lastFull = 0; } };
}

// Đăng comment KHÔNG nhân đôi khi retry: nếu một lần đăng lỗi tạm thời (có thể server đã nhận nhưng phản hồi
// mất), kiểm tra comment có marker đã tồn tại chưa rồi mới thử lại. Nội dung gửi qua stdin (--input -) để
// không vượt giới hạn độ dài dòng lệnh Windows (~32K) như cách -f body=... trước đây với kết quả tới 60KB.
export async function postMarkedComment({
  ghAsync, repo, issue, marker, text, login, attempts = 4,
  now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), baseDelayMs = 1500, maxDelayMs = 10000,
}) {
  const body = (marker + "\n" + text).slice(0, 60000);
  const postUrl = "repos/" + repo + "/issues/" + issue + "/comments";
  const sinceIso = new Date(now() - 15 * 60 * 1000).toISOString();
  const existsJq = '[.[]|select(.user.login=="' + login + '" and ((.body // "")|startswith("' + marker + '")))|.id]';
  let lastError = "";
  for (let i = 1; i <= attempts; i++) {
    const r = await ghAsync(["api", postUrl, "--input", "-"], { attempts: 1, input: JSON.stringify({ body }) });
    if (r.code === 0) return { ok: true, attempts: i };
    lastError = errMsg(r);
    if (r.kind === "permanent") return { ok: false, error: lastError, attempts: i };
    const chk = await ghAsync(["api", "--jq", existsJq, postUrl + "?per_page=100&since=" + encodeURIComponent(sinceIso)], { attempts: 1 });
    if (chk.code === 0) {
      try { if (JSON.parse(chk.out || "[]").length > 0) return { ok: true, recovered: true, attempts: i }; } catch {}
    }
    if (i < attempts) await sleep(Math.min(maxDelayMs, baseDelayMs * 2 ** (i - 1)));
  }
  return { ok: false, error: lastError, attempts };
}
