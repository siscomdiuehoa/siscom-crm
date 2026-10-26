import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { fetchTaskComments, fetchApprovalComments } from "./ghqueue.mjs";
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
function gh(args){return run(cfg.ghCommand||"gh",args,cfg.repoPath,120000)}
function git(args){return run(cfg.gitCommand||"git",args,cfg.repoPath,120000)}
function refreshLocal(){const b=git(["branch","--show-current"]);const h=git(["rev-parse","--short","HEAD"]);state.git={branch:b.out||"unknown",commit:h.out||"unknown"};persist()}
function refreshGithub(){const r=gh(["pr","list","--state","open","--limit","1","--json","number,title,statusCheckRollup,url"]);if(r.code===0){try{const p=JSON.parse(r.out||"[]")[0];if(!p){state.github={pr:"Không có PR mở",ci:"idle"}}else{const c=p.statusCheckRollup||[];const bad=c.some(x=>["FAILURE","CANCELLED","TIMED_OUT"].includes(x.conclusion));const pending=c.some(x=>!x.conclusion||x.status==="IN_PROGRESS"||x.status==="QUEUED");state.github={pr:"#"+p.number+" "+p.title,ci:bad?"failed":pending?"running":c.length?"success":"waiting",url:p.url}}}catch{}}persist()}
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
function postResult(id,title,body){const marker="<!-- CLAUDE_RESULT source="+id+" -->";const text=(marker+"\n## "+title+"\n\n"+body).slice(0,60000);return gh(["api","repos/"+cfg.repo+"/issues/"+cfg.queueIssue+"/comments","-f","body="+text])}
function runClaudeAsync(args,timeoutMs){
  return new Promise(resolve=>{
    let child, out="", err="", finished=false, timer;
    const done=(result)=>{if(finished)return;finished=true;clearTimeout(timer);resolve(result)};
    try{
      child=spawn(cfg.claudeCommand||"claude",args,{cwd:cfg.repoPath,windowsHide:true,shell:false});
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
 if(r.code===0 && taskOutcome==="DONE"){state.claude={state:"idle",task:"",lastOutput:output.slice(-4000)};addEvent("DONE","Claude hoàn thành task "+c.id);postResult(c.id,"Claude completed",output||"Claude hoàn thành nhưng không có stdout.")}else{state.claude={state:"blocked",task:"Task "+c.id+" lỗi/đòi quyền",lastOutput:output.slice(-4000)};addEvent(taskOutcome==="BLOCKED"?"BLOCKED":"ERROR","Claude task "+c.id+" outcome="+taskOutcome+" exit="+r.code);postResult(c.id,"Claude blocked/failed","Outcome: "+taskOutcome+"; Exit code: "+r.code+"\n\n"+(output||"Không có output."))}
state.processed.push(c.id);state.activeTaskId=null;activeTask=false;persist()}
// SISCOM_V4_1_QUEUE: skip unapproved jobs without losing them; process at most one eligible task per poll.
function pollQueue(){
  if(activeTask)return;
  const q=fetchTaskComments(gh,cfg.repo,cfg.queueIssue);
  if(!q.ok){addEvent("GH_ERROR",q.error);return}
  const a=fetchApprovalComments(gh,cfg.repo,cfg.queueIssue);
  if(!a.ok){addEvent("APPROVAL_FETCH_ERROR",a.error);return}
  const pick=chooseQueue(q.comments,a.comments,state.processed,cfg.trustedLogin);
  const report={waiting:pick.waiting.length,revoked:pick.revoked.length,invalid:pick.invalid.length,eligible:pick.eligible};
  const signature=JSON.stringify(report);
  if(state.queueSummarySignature!==signature){
    state.queueSummarySignature=signature;state.queue=report;
    addEvent("QUEUE",`Eligible: ${report.eligible}; awaiting owner: ${report.waiting}; revoked: ${report.revoked}; invalid: ${report.invalid}`);
  }
  if(!pick.selected){
    // No eligible task is not a request for owner approval. Keep unapproved tasks pending.
    if(state.claude?.state==="waiting_approval"){
      state.claude={state:"idle",task:"No approved task ready"};
      state.approval={needed:false,message:""};state.waitingApproval=null;persist();
    }
    return;
  }
  processTask(pick.selected.comment,a.comments).catch(e=>{
    activeTask=false;state.claude={state:"blocked",task:"Runner exception",lastOutput:String(e)};
    addEvent("ERROR",String(e));
  });
}
if(state.claude?.state==="running"){
  state.claude={state:"blocked",task:"Interrupted previous run; manual retry required",lastOutput:state.claude.lastOutput||""};
  if(Number.isSafeInteger(Number(state.activeTaskId)) && !(state.processed||[]).includes(Number(state.activeTaskId))){
    state.processed.push(Number(state.activeTaskId));
    state.recoveryReview=state.recoveryReview||[];state.recoveryReview.push(Number(state.activeTaskId));
  }
  state.activeTaskId=null;
  addEvent("RECOVERY","Previous task interrupted; manual review required, not automatically replayed");
}
const server=http.createServer((req,res)=>{if(req.url==="/events"){res.writeHead(200,{"Content-Type":"text/event-stream","Cache-Control":"no-cache","Connection":"keep-alive"});res.write("data: "+JSON.stringify(state)+"\n\n");clients.add(res);req.on("close",()=>clients.delete(res));return}if(req.url==="/api/status"){res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify(state));return}if(req.url==="/"||req.url==="/index.html"){res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});res.end(fs.readFileSync(dashboardPath,"utf8"));return}res.writeHead(404);res.end("Not found")});
server.listen(cfg.port||45871,"127.0.0.1",()=>{addEvent("RUNNER","Auto-Runner started on http://127.0.0.1:"+(cfg.port||45871));console.log("SISCOM Claude Auto-Runner: http://127.0.0.1:"+(cfg.port||45871))});
refreshLocal();refreshGithub();persist();
setInterval(()=>{state.heartbeat=now();persist()},1000);
setInterval(refreshLocal,5000);
setInterval(refreshGithub,Math.max(10,cfg.githubPollSeconds||15)*1000);
setInterval(pollQueue,Math.max(5,cfg.pollSeconds||10)*1000);
