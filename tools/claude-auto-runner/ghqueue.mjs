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
