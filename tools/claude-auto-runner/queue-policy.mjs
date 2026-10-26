// Pure, fail-closed SISCOM queue admission rules. No network or disk access.
export const ALLOWED_SCOPES = new Set(['CODE_TEST_DRAFT_ONLY','ISOLATED_TEST_CONFIG_DRAFT_ONLY','READ_ONLY_QA']);
const validId = x => Number.isSafeInteger(Number(x)) && Number(x)>0;
const taskScope = body => {
  const all=[...String(body||'').matchAll(/^SCOPE:\s*([A-Z0-9_]+)\s*$/gm)];
  return all.length===1 && ALLOWED_SCOPES.has(all[0][1]) ? all[0][1] : null;
};
export function parseTask(c,login){
  if(!c || c.user?.login!==login || !validId(c.id) || !String(c.body||'').includes('<!-- CLAUDE_TASK -->'))return null;
  const body=String(c.body);
  return {id:Number(c.id),body,scope:taskScope(body),forbidden:/^RISK\s*:\s*FORBIDDEN\s*$/im.test(body)};
}
const allowedKeys=new Set(['OWNER_APPROVED','TASK_COMMENT_ID','SCOPE','TASK_ID','APPROVAL_LIMIT','SOURCE','AUTHORIZATION_SOURCE','TASK_URL','STATUS']);
function parseDecision(c,task,login){
  if(!c || c.user?.login!==login || !validId(c.id) || Number(c.id)<=task.id)return null;
  const body=String(c.body||'').trim();
  if(/<!--|-->/.test(body))return null;
  // Structured authorization header followed by an optional separated explanation.
  // Never interpret free-form explanation text as additional permission.
  const parts=body.split(/\r?\n/);
  const blank=parts.findIndex(x=>!x.trim());
  const header=(blank<0?parts:parts.slice(0,blank)).map(x=>x.trim()).filter(Boolean);
  const explanation=blank<0?[]:parts.slice(blank+1).filter(x=>x.trim());
  if(header.length<2 || header.length>12 || body.length>12000)return null;
  // Reject key-value lookalikes in prose, which might hide a second approval.
  if(explanation.some(x=>/^(?:OWNER_APPROVED|TASK_COMMENT_ID|SCOPE|STATUS|TASK_ID)\s*:/i.test(x.trim())))return null;
  const lines=header;
  const values=new Map();
  for(const line of lines){
    const m=/^([A-Z_]+):\s*(.+)$/.exec(line);
    if(!m || !allowedKeys.has(m[1]) || values.has(m[1]))return null;
    values.set(m[1],m[2].trim());
  }
  if(values.get('TASK_COMMENT_ID')!==String(task.id))return null;
  if(lines[0]!=='OWNER_APPROVED: YES' && lines[0]!=='OWNER_APPROVED: NO')return null;
  const yes=values.get('OWNER_APPROVED')==='YES';
  const no=values.get('OWNER_APPROVED')==='NO';
  if(!yes && !no)return null;
  if(yes && (values.get('SCOPE')!==task.scope || !task.scope))return null;
  if(no && !['REVOKED_BY_OWNER','CANCELLED_BY_OWNER','REVOKED'].includes(values.get('STATUS'))) {
    // A negative owner decision without a status is still a denial.
  }
  return {id:Number(c.id),approved:yes,comment:c,scope:values.get('SCOPE')};
}
// Never let a later revocation be overridden by an older approval.
export function decisionFor(task,comments,login){
  const decisions=(comments||[]).map(c=>parseDecision(c,task,login)).filter(Boolean);
  decisions.sort((a,b)=>b.id-a.id);
  // A revoked task requires a new task ID; do not silently reinstate it.
  return decisions.find(d=>!d.approved)||decisions[0]||null;
}
const rawScopes=body=>[...String(body||'').matchAll(/^SCOPE:\s*(\S+)\s*$/gm)].map(m=>m[1]);
// Chủ repo huỷ task bằng dòng "STATUS: CANCELLED_BY_OWNER" trong chính comment task (không phải lỗi phạm vi).
const cancelledTask=body=>/^STATUS\s*:\s*CANCELLED_BY_OWNER\s*$/im.test(String(body||''));
// completedSources: id các task đã có comment CLAUDE_RESULT do chủ tin cậy đăng (chống nhận trùng dù state.processed mất).
export function chooseQueue(tasks,comments,processed,login,completedSources=null){
  const completed=new Set((processed||[]).map(Number));
  for(const x of completedSources||[])completed.add(Number(x));
  const admitted=[],waiting=[],revoked=[],invalid=[],cancelled=[];
  for(const comment of tasks||[]){
    const t=parseTask(comment,login);
    if(!t || completed.has(t.id))continue;
    if(t.forbidden){invalid.push({id:t.id,reason:'FORBIDDEN'});continue}
    if(cancelledTask(t.body)){cancelled.push({id:t.id});continue}
    if(!t.scope){invalid.push({id:t.id,reason:'INVALID_SCOPE',scope:rawScopes(t.body).join(',')||null});continue}
    const d=decisionFor(t,comments,login);
    if(d?.approved){admitted.push({comment,approval:d.comment,scope:t.scope});continue}
    if(d && !d.approved){revoked.push({id:t.id});continue}
    waiting.push({id:t.id,scope:t.scope});
  }
  // Stable issue order; later authorized tasks may run while earlier tasks wait.
  return {selected:admitted[0]||null,waiting,revoked,invalid,cancelled,eligible:admitted.length};
}
