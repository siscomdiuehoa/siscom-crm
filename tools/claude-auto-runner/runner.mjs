import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { createQueueSync, postMarkedComment } from "./ghqueue.mjs";
import { createGhClient, errText } from "./ghclient.mjs";
import { chooseQueue, decisionFor, parseTask } from "./queue-policy.mjs";

const appDir=path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),"AppData","Local"),"SISCOM-ClaudeRunner");
const configPath=path.join(appDir,"config.json");
const statePath=path.join(appDir,"state.json");
fs.mkdirSync(appDir,{recursive:true});
if(!fs.existsSync(configPath)){console.error("Missing config: "+configPath);process.exit(2)}
function readJson(p){const raw=fs.readFileSync(p,"utf8").replace(/^\uFEFF/,"");return JSON.parse(raw)}
const cfg=readJson(configPath);
const dashboardPath=path.join(cfg.repoPath,"tools","claude-auto-runner","dashboard.html");
const state=fs.existsSync(statePath)?readJson(statePath):{processed:[],claude:{state:"idle",task:""},git:{},github:{},approval:{needed:false,message:""},timeline:[]};
// Prevent duplicate runners: start polling only after the HTTP port is bound.
const clients=new Set();
process.on("uncaughtException", e=>{console.error("RUNNER_FATAL",e);process.exitCode=1});
process.on("unhandledRejection", e=>console.error("RUNNER_REJECTION",e));
let activeTask=false;
const now=()=>new Date().toISOString();
function persist(){state.heartbeat=now();const tmp=statePath+"."+process.pid+".tmp";fs.writeFileSync(tmp,JSON.stringify(state,null,2),"utf8");fs.renameSync(tmp,statePath);const p="data: "+JSON.stringify(state)+"\n\n";for(const r of clients){try{r.write(p)}catch{}}}
function addEvent(type,message){state.timeline=state.timeline||[];state.timeline.push({at:now(),type,message});state.timeline=state.timeline.slice(-20);persist()}
function run(cmd,args,cwd=cfg.repoPath,timeoutMs=120000){const r=spawnSync(cmd,args,{cwd,encoding:"utf8",windowsHide:true,timeout:timeoutMs,shell:false,maxBuffer:16*1024*1024});return{code:r.status??-1,out:(r.stdout||"").trim(),err:(r.stderr||"").trim(),error:r.error?.message||""}}
function git(args){return run(cfg.gitCommand||"git",args,cfg.repoPath,120000)}
// gh chạy BẤT ĐỒNG BỘ (không chặn event loop/HTTP/heartbeat), có timeout + retry/backoff cho lỗi tạm thời.
// Lỗi thoáng qua (ví dụ "stream error ... CANCEL") được thử lại; cấu hình thử nghiệm: ghPrefixArgs, ghTimeoutMs, ghRetries, ghBackoffMs.
let ghRetryNote="";
const ghAsync=createGhClient({command:cfg.ghCommand||"gh",prefixArgs:cfg.ghPrefixArgs||[],cwd:cfg.repoPath,timeoutMs:cfg.ghTimeoutMs||45000,maxAttempts:cfg.ghRetries||3,baseDelayMs:cfg.ghBackoffMs||1000,maxDelayMs:Math.max(8000,(cfg.ghBackoffMs||1000)*8),onRetry:e=>{ghRetryNote="retry "+e.attempt+": "+e.error}});
function refreshLocal(){const b=git(["branch","--show-current"]);const h=git(["rev-parse","--short","HEAD"]);state.git={branch:b.out||"unknown",commit:h.out||"unknown"};persist()}
let githubRefreshing=false;
async function refreshGithub(){if(githubRefreshing)return;githubRefreshing=true;try{const r=await ghAsync(["pr","list","--state","open","--limit","1","--json","number,title,statusCheckRollup,url"],{attempts:1});if(r.code===0){try{const p=JSON.parse(r.out||"[]")[0];if(!p){state.github={pr:"Không có PR mở",ci:"idle"}}else{const c=p.statusCheckRollup||[];const bad=c.some(x=>["FAILURE","CANCELLED","TIMED_OUT"].includes(x.conclusion));const pending=c.some(x=>!x.conclusion||x.status==="IN_PROGRESS"||x.status==="QUEUED");state.github={pr:"#"+p.number+" "+p.title,ci:bad?"failed":pending?"running":c.length?"success":"waiting",url:p.url}}}catch{}}persist()}finally{githubRefreshing=false}}
// SISCOM_V4_1_APPROVAL: strict, independent, owner-authored approval for exact task ID.
// Fail closed: do not trust approval markers embedded in tasks or results.
function risk(body){return /^RISK\s*:\s*FORBIDDEN\s*$/im.test(body)?"forbidden":"important"}
// SISCOM_SAFE_QUEUE_V5_1: both selection and execution use queue-policy.mjs.
// Never allow a second, incompatible approval parser to reject or widen decisions.
function extractTaskOutcome(stdout){
  const out=String(stdout||"").trim();
  // Explicit result must be the final stdout line; examples embedded in the task
  // cannot be interpreted as a successful completion.
  const line=out.match(/(?:^|\n)SISCOM_TASK_OUTCOME:\s*(DONE|BLOCKED|FAILED)\s*$/i);
  const selfReportedBlocked=/(?:^|\n)\s*(?:[-*]\s*)?(?:trạng thái|status)\s*:\s*\**\s*BLOCKED\b/i.test(out);
  if(selfReportedBlocked)return "BLOCKED";
  return line ? line[1].toUpperCase() : "UNKNOWN";
}
// SISCOM_APPROVAL_BRIDGE_V1_END
function extract(body){const m="<!-- CLAUDE_TASK -->";const i=body.indexOf(m);return i>=0?body.slice(i+m.length).trim():""}
// Comment RESULT/ACK: đăng không nhân đôi khi retry (xem postMarkedComment). RESULT chưa đăng được (mất kết nối)
// được giữ ở pending-posts.json (không đưa vào state/SSE vì có thể tới 60KB) và thử lại khi GitHub phục hồi.
const pendingPath=path.join(appDir,"pending-posts.json");
function loadPending(){try{return fs.existsSync(pendingPath)?readJson(pendingPath):[]}catch{return []}}
function savePending(list){const tmp=pendingPath+"."+process.pid+".tmp";fs.writeFileSync(tmp,JSON.stringify(list),"utf8");fs.renameSync(tmp,pendingPath);state.pendingPosts=list.map(p=>({source:p.source,kind:p.kind,attempts:p.attempts,since:p.since}));persist()}
const postOpts=()=>({ghAsync,repo:cfg.repo,issue:cfg.queueIssue,login:cfg.trustedLogin,baseDelayMs:cfg.postBackoffMs||1500});
async function postMarked(kind,id,marker,title,body,{persistent=true}={}){
  const text="## "+title+"\n\n"+body;
  const r=await postMarkedComment({...postOpts(),marker,text,attempts:cfg.postAttempts||4});
  if(r.ok)return true;
  if(persistent){const list=loadPending();if(!list.some(p=>p.marker===marker)){list.push({source:id,kind,marker,text,attempts:0,since:now()});savePending(list)}}
  addEvent(persistent?"POST_PENDING":"POST_FAILED",kind+" "+id+" chưa đăng được ("+r.error+")"+(persistent?"; sẽ thử lại khi GitHub phục hồi":""));
  return false}
async function flushPending(){
  const list=loadPending();if(!list.length)return;const keep=[];
  for(const p of list){
    const r=await postMarkedComment({...postOpts(),marker:p.marker,text:p.text,attempts:1});
    if(r.ok){addEvent("POST_RETRIED",p.kind+" "+p.source+" đã đăng sau khi phục hồi kết nối")}
    else if(++p.attempts>=50){addEvent("POST_DROPPED",p.kind+" "+p.source+" bỏ sau 50 lần thử; cần đăng thủ công")}
    else keep.push(p)}
  savePending(keep)}
const postResult=(id,title,body)=>postMarked("RESULT",id,"<!-- CLAUDE_RESULT source="+id+" -->",title,body);
const postAck=(id)=>postMarked("ACK",id,"<!-- RUNNER_ACK source="+id+" -->","Runner ACK","Runner đã xác minh phê duyệt và bắt đầu task "+id+" lúc "+now()+". Kết quả sẽ đăng bằng comment CLAUDE_RESULT source="+id+".",{persistent:false});
function runClaudeAsync(args,timeoutMs){
  return new Promise(resolve=>{
    let child, out="", err="", finished=false, timer;
    const done=(result)=>{if(finished)return;finished=true;clearTimeout(timer);resolve(result)};
    try{
      child=spawn(cfg.claudeCommand||"claude",[...(cfg.claudePrefixArgs||[]),...args],{cwd:cfg.repoPath,windowsHide:true,shell:false});
      const collect=(kind,d)=>{
        const value=d.toString();
        if(kind==="out")out=(out+value).slice(-200000);
        else err=(err+value).slice(-30000);
        state.claude.lastOutput=(out+"\\n"+err).slice(-4000);
        persist();
      };
      child.stdout?.on("data",d=>collect("out",d));
      child.stderr?.on("data",d=>collect("err",d));
      child.on("error",e=>done({code:-1,out,err,error:e.message}));
      child.on("close",code=>done({code:code??-1,out:out.trim(),err:err.trim(),error:""}));
      timer=setTimeout(()=>{try{child.kill()}catch{};done({code:-2,out,err,error:"Claude timed out; task requires manual review before retry"})},timeoutMs);
    }catch(e){done({code:-1,out,err,error:String(e)})}
  });
}
async function processTask(c, approvals=null){
 const task=extract(c.body||"");if(!task)return;
 if(risk(task)==="forbidden"){
   state.claude={state:"blocked",task:"Task "+c.id+" explicitly FORBIDDEN"};
   state.approval={needed:true,message:"Task forbidden; manual review"};
   state.processed.push(c.id);addEvent("BLOCKED","Task "+c.id+" forbidden");return;
 }
 const parsedTask=parseTask(c,cfg.trustedLogin);
 const taskScope=parsedTask?.scope||null;
 const decision=parsedTask ? decisionFor(parsedTask,approvals||[],cfg.trustedLogin) : null;
 const verifiedApproval=decision?.approved===true ? decision.comment : null;
  if(!verifiedApproval){
   const first=state.waitingApproval?.taskId!==c.id;
   state.waitingApproval={taskId:c.id};
   state.claude={state:"waiting_approval",task:"Task "+c.id+" waiting owner approval"};
   state.approval={needed:true,message:"OWNER_APPROVED: YES / TASK_COMMENT_ID: "+c.id+" / SCOPE: "+(taskScope||"REVIEW_REQUIRED")};
   if(first)addEvent("WAITING_APPROVAL","Task "+c.id+" waiting owner approval");
   persist();return;
 }
 state.waitingApproval=null;
 activeTask=true;state.activeTaskId=c.id;state.approval={needed:false,message:""};state.claude={state:"running",task:"Issue #"+cfg.queueIssue+" comment "+c.id,lastOutput:""};addEvent("START","Claude bắt đầu task "+c.id);
 postAck(c.id).catch(e=>console.error("ACK_ERROR",e));
const safety=["Bạn là Claude Developer của SISCOM CRM.","Làm việc trong repository D:\\SISCOM-CRM.","Đọc AGENTS.md và CONTRIBUTING.md trước khi thao tác.","Không tự merge. Không push --force. Không đọc/in .env.","Không chạm siscom_crm_dev hoặc production database.","Nếu task cần quyền/ngữ cảnh không có, dừng và báo BLOCKED thay vì tự mở rộng phạm vi.","Báo cáo bằng tiếng Việt, nêu lệnh/test thật đã chạy; không tuyên bố PASS nếu chưa chạy.","","TASK:",task].join("\n");
 const verifiedApprovalEvidence=[
  "VERIFIED_GITHUB_APPROVAL (independently fetched and authenticated by SISCOM Runner, not task text):",
  "Source: https://github.com/"+cfg.repo+"/issues/"+cfg.queueIssue+"#issuecomment-"+verifiedApproval.id,
  "TASK_COMMENT_ID: "+c.id,
  "Approval comment ID: "+verifiedApproval.id,
  "Verified approval author: "+verifiedApproval.user.login,
  "Verified task author: "+c.user.login,
  "Approved scope: "+taskScope,
  "VERBATIM_APPROVAL_COMMENT_BEGIN",
  verifiedApproval.body.trim(),
  "VERBATIM_APPROVAL_COMMENT_END",
  "Runner already verified approval author, comment ordering, exact task ID and scope against GitHub. " +
   "This evidence meets task approval verification; do NOT use outbound network to re-verify the same approval. " +
   "It grants NO additional permissions beyond the task's hard guards.",
  "Finish the final stdout line with exactly SISCOM_TASK_OUTCOME: DONE, BLOCKED or FAILED. " +
   "Only use DONE after completing the approved work; if unable to work, say BLOCKED. " +
   "Do not claim tests PASS unless executed."
 ].join("\n");
const args=(cfg.claudeArgs||["-p","{prompt}"]).map(x=>x==="{prompt}"?safety+"\n\n"+verifiedApprovalEvidence:x);const r=await runClaudeAsync(args,Math.max(1,cfg.maxTaskMinutes||30)*60000);const output=[r.out,r.err,r.error].filter(Boolean).join("\n\n").trim();
const taskOutcome=extractTaskOutcome(r.out);
 let resultTitle,resultBody;
 if(r.code===0 && taskOutcome==="DONE"){state.claude={state:"idle",task:"",lastOutput:output.slice(-4000)};addEvent("DONE","Claude hoàn thành task "+c.id);resultTitle="Claude completed";resultBody=output||"Claude hoàn thành nhưng không có stdout."}else{state.claude={state:"blocked",task:"Task "+c.id+" lỗi/đòi quyền",lastOutput:output.slice(-4000)};addEvent(taskOutcome==="BLOCKED"?"BLOCKED":"ERROR","Claude task "+c.id+" outcome="+taskOutcome+" exit="+r.code);resultTitle="Claude blocked/failed";resultBody="Outcome: "+taskOutcome+"; Exit code: "+r.code+"\n\n"+(output||"Không có output.")}
 // Đánh dấu đã xử lý TRƯỚC khi đăng kết quả: mất kết nối khi đăng không bao giờ làm task chạy lại.
 state.processed.push(c.id);state.activeTaskId=null;persist();
 try{await postResult(c.id,resultTitle,resultBody)}finally{activeTask=false;persist()}}
// SISCOM_V4_1_QUEUE: skip unapproved jobs without losing them; process at most one eligible task per poll.
// Đồng bộ hàng đợi tăng dần: 1 request/lượt (full resync định kỳ + ngay trước khi chạy task), không chặn event loop.
const queueSync=createQueueSync({ghAsync,repo:cfg.repo,issue:cfg.queueIssue,login:cfg.trustedLogin,fullEveryMs:(cfg.fullSyncMinutes||30)*60000});
const pollBaseMs=cfg.pollMs||Math.max(5,cfg.pollSeconds||10)*1000;
state.poll=state.poll||{consecutiveErrors:0};
let polling=false,nextPollAt=0;
function pollFailed(err){
  const p=state.poll;const first=(p.consecutiveErrors||0)===0||p.lastError!==err;
  p.consecutiveErrors=(p.consecutiveErrors||0)+1;p.lastError=err;p.lastErrorAt=now();
  // Giãn cách giữa các lượt poll khi GitHub lỗi liên tiếp (tối đa 2 phút), tự phục hồi khi hết lỗi.
  nextPollAt=Date.now()+Math.min(cfg.maxBackoffMs||120000,pollBaseMs*2**Math.min(p.consecutiveErrors,6));
  if(first)addEvent("GH_ERROR",err+(ghRetryNote?" ["+ghRetryNote+"]":"")+" — Runner tự thử lại, không treo");else persist();
}
function pollOk(info){
  const p=state.poll;
  if((p.consecutiveErrors||0)>0)addEvent("GH_RECOVERED","Kết nối GitHub phục hồi sau "+p.consecutiveErrors+" lượt lỗi");
  p.consecutiveErrors=0;p.lastError=null;p.lastOkAt=now();p.mode=info.mode;p.requests=info.requests;nextPollAt=0;ghRetryNote="";
}
// SISCOM_V4_1_QUEUE: skip unapproved jobs without losing them; process at most one eligible task per poll.
async function pollQueue(){
  if(activeTask||polling||Date.now()<nextPollAt)return;
  polling=true;
  try{
    const s=await queueSync.sync();
    if(!s.ok){pollFailed(s.error);return}
    pollOk(s);
    await flushPending();
    const pick=chooseQueue(s.tasks,s.approvals,state.processed,cfg.trustedLogin,s.completedSources);
    const describeInvalid=i=>i.id+":"+i.reason+(i.scope?"("+i.scope+")":"");
    const report={waiting:pick.waiting.length,revoked:pick.revoked.length,invalid:pick.invalid.length,cancelled:pick.cancelled.length,eligible:pick.eligible,
      waitingIds:pick.waiting.map(w=>w.id),invalidDetail:pick.invalid.map(describeInvalid)};
    const signature=JSON.stringify(report);
    if(state.queueSummarySignature!==signature){
      state.queueSummarySignature=signature;state.queue=report;
      addEvent("QUEUE",`Eligible: ${report.eligible}; awaiting owner: ${report.waiting}; revoked: ${report.revoked}; invalid: ${report.invalid}; cancelled: ${report.cancelled}`+(report.invalid?" ["+report.invalidDetail.join(", ")+"]":""));
    }
    if(!pick.selected){
      // No eligible task is not a request for owner approval. Keep unapproved tasks pending.
      if(state.claude?.state==="waiting_approval"){
        state.claude={state:"idle",task:"No approved task ready"};
        state.approval={needed:false,message:""};state.waitingApproval=null;persist();
      }
      return;
    }
    // Xác minh lại bằng đồng bộ ĐẦY ĐỦ ngay trước khi chạy: bắt phê duyệt bị thu hồi/xoá giữa hai lượt poll
    // và bảo đảm cache tăng dần không bỏ sót; không khớp thì KHÔNG chạy (fail-closed).
    const f=await queueSync.sync({full:true});
    if(!f.ok){pollFailed(f.error);return}
    const again=chooseQueue(f.tasks,f.approvals,state.processed,cfg.trustedLogin,f.completedSources);
    if(!again.selected||again.selected.comment.id!==pick.selected.comment.id){addEvent("QUEUE","Task "+pick.selected.comment.id+" không còn hợp lệ khi xác minh đầy đủ; không chạy");return}
    processTask(again.selected.comment,f.approvals).catch(e=>{
      activeTask=false;state.claude={state:"blocked",task:"Runner exception",lastOutput:String(e)};
      addEvent("ERROR",String(e));
    });
  }catch(e){
    // Lỗi của vòng poll (không phải của task đang chạy): ghi nhận, không đổi trạng thái Claude.
    addEvent("ERROR","poll: "+String(e));
  }finally{polling=false}
}
// Chạy SAU khi bind cổng (xem server.listen): Runner thứ hai bị từ chối cổng không được ghi đè state của Runner đang chạy.
function recoverInterrupted(){
  if(state.claude?.state!=="running")return;
  state.claude={state:"blocked",task:"Interrupted previous run; manual retry required",lastOutput:state.claude.lastOutput||""};
  if(Number.isSafeInteger(Number(state.activeTaskId)) && !(state.processed||[]).includes(Number(state.activeTaskId))){
    state.processed.push(Number(state.activeTaskId));
    state.recoveryReview=state.recoveryReview||[];state.recoveryReview.push(Number(state.activeTaskId));
  }
  state.activeTaskId=null;
  addEvent("RECOVERY","Previous task interrupted; manual review required, not automatically replayed");
}
const server=http.createServer((req,res)=>{if(req.url==="/events"){res.writeHead(200,{"Content-Type":"text/event-stream","Cache-Control":"no-cache","Connection":"keep-alive"});res.write("data: "+JSON.stringify(state)+"\n\n");clients.add(res);req.on("close",()=>clients.delete(res));return}if(req.url==="/api/status"){res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify(state));return}if(req.url==="/"||req.url==="/index.html"){res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});res.end(fs.readFileSync(dashboardPath,"utf8"));return}res.writeHead(404);res.end("Not found")});
// Chống chạy hai Runner: cổng HTTP là khóa duy nhất. Không bind được cổng => THOÁT NGAY (trước đây lỗi EADDRINUSE chỉ
// bị ghi log nhưng các timer vẫn chạy, tạo ra Runner thứ hai không có dashboard vẫn nhận task). Timer chỉ khởi động
// SAU KHI bind cổng thành công.
server.on("error",e=>{console.error("RUNNER_PORT_ERROR "+(e&&e.code||"")+": không bind được cổng "+(cfg.port||45871)+" — có thể đã có Runner khác đang chạy. Thoát.");process.exit(3)});
server.listen(cfg.port||45871,"127.0.0.1",()=>{
  recoverInterrupted();
  addEvent("RUNNER","Auto-Runner started on http://127.0.0.1:"+(cfg.port||45871));console.log("SISCOM Claude Auto-Runner: http://127.0.0.1:"+(cfg.port||45871));
  refreshLocal();refreshGithub().catch(()=>{});persist();
  setInterval(()=>{state.heartbeat=now();persist()},1000);
  setInterval(refreshLocal,5000);
  setInterval(()=>refreshGithub().catch(()=>{}),Math.max(10,cfg.githubPollSeconds||15)*1000);
  setInterval(()=>pollQueue().catch(e=>addEvent("ERROR","poll: "+String(e))),pollBaseMs);
});
