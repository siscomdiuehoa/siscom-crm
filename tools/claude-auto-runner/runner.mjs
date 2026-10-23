import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { fetchTaskComments } from "./ghqueue.mjs";

const appDir=path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),"AppData","Local"),"SISCOM-ClaudeRunner");
const configPath=path.join(appDir,"config.json");
const statePath=path.join(appDir,"state.json");
fs.mkdirSync(appDir,{recursive:true});
if(!fs.existsSync(configPath)){console.error("Missing config: "+configPath);process.exit(2)}
function readJson(p){const raw=fs.readFileSync(p,"utf8").replace(/^\\uFEFF/,"");return JSON.parse(raw)}
const cfg=readJson(configPath);
const dashboardPath=path.join(cfg.repoPath,"tools","claude-auto-runner","dashboard.html");
const state=fs.existsSync(statePath)?readJson(statePath):{processed:[],claude:{state:"idle",task:""},git:{},github:{},approval:{needed:false,message:""},timeline:[]};
const clients=new Set();
let activeTask=false;
const now=()=>new Date().toISOString();
function persist(){state.heartbeat=now();fs.writeFileSync(statePath,JSON.stringify(state,null,2),"utf8");const p="data: "+JSON.stringify(state)+"\n\n";for(const r of clients){try{r.write(p)}catch{}}}
function addEvent(type,message){state.timeline=state.timeline||[];state.timeline.push({at:now(),type,message});state.timeline=state.timeline.slice(-20);persist()}
function run(cmd,args,cwd=cfg.repoPath,timeoutMs=120000){const r=spawnSync(cmd,args,{cwd,encoding:"utf8",windowsHide:true,timeout:timeoutMs,shell:false,maxBuffer:16*1024*1024});return{code:r.status??-1,out:(r.stdout||"").trim(),err:(r.stderr||"").trim(),error:r.error?.message||""}}
function gh(args){return run(cfg.ghCommand||"gh",args,cfg.repoPath,120000)}
function git(args){return run(cfg.gitCommand||"git",args,cfg.repoPath,120000)}
function refreshLocal(){const b=git(["branch","--show-current"]);const h=git(["rev-parse","--short","HEAD"]);state.git={branch:b.out||"unknown",commit:h.out||"unknown"};persist()}
function refreshGithub(){const r=gh(["pr","list","--state","open","--limit","1","--json","number,title,statusCheckRollup,url"]);if(r.code===0){try{const p=JSON.parse(r.out||"[]")[0];if(!p){state.github={pr:"Không có PR mở",ci:"idle"}}else{const c=p.statusCheckRollup||[];const bad=c.some(x=>["FAILURE","CANCELLED","TIMED_OUT"].includes(x.conclusion));const pending=c.some(x=>!x.conclusion||x.status==="IN_PROGRESS"||x.status==="QUEUED");state.github={pr:"#"+p.number+" "+p.title,ci:bad?"failed":pending?"running":c.length?"success":"waiting",url:p.url}}}catch{}}persist()}
function risk(body){const declared=body.match(/^RISK\s*:\s*(SAFE|IMPORTANT)\s*$/im)?.[1]?.toLowerCase();if(declared==="safe"||declared==="important")return declared;const b=body.toLowerCase();const keys=["siscom_crm_dev","production","prisma migrate","db push","seed","reset database","drop database","npm install","package.json","package-lock.json","dependency","migration","schema.prisma","push --force","merge pull request","git merge"];return keys.some(k=>b.includes(k))?"important":"safe"}
function approved(body){return /OWNER_APPROVED\s*:\s*YES/i.test(body)}
function extract(body){const m="<!-- CLAUDE_TASK -->";const i=body.indexOf(m);return i>=0?body.slice(i+m.length).trim():""}
function postResult(id,title,body){const marker="<!-- CLAUDE_RESULT source="+id+" -->";const text=(marker+"\n## "+title+"\n\n"+body).slice(0,60000);return gh(["api","repos/"+cfg.repo+"/issues/"+cfg.queueIssue+"/comments","-f","body="+text])}
function runClaudeAsync(args,timeoutMs){return new Promise((resolve)=>{const child=spawn(cfg.claudeCommand||"claude",args,{cwd:cfg.repoPath,windowsHide:true,shell:false});let out="";let err="";const timer=setTimeout(()=>{try{child.kill()}catch{}},timeoutMs);child.stdout.on("data",d=>{out+=d.toString();state.claude.lastOutput=out.slice(-4000);persist()});child.stderr.on("data",d=>{err+=d.toString();state.claude.lastOutput=err.slice(-4000);persist()});child.on("error",e=>{clearTimeout(timer);resolve({code:-1,out,err,error:e.message})});child.on("close",code=>{clearTimeout(timer);resolve({code:code??-1,out:out.trim(),err:err.trim(),error:""})})})}
async function processTask(c){const task=extract(c.body||"");if(!task)return;if(risk(task)==="important"&&!approved(c.body||"")){state.claude={state:"blocked",task:"Task "+c.id+" cần chủ repo duyệt"};state.approval={needed:true,message:"Task "+c.id+": thao tác quan trọng"};addEvent("BLOCKED","Task "+c.id+" cần OWNER_APPROVED:YES");postResult(c.id,"BLOCKED — cần chủ repo duyệt","Auto-Runner phát hiện thao tác quan trọng. Chưa thực thi.");state.processed.push(c.id);persist();return}
activeTask=true;state.approval={needed:false,message:""};state.claude={state:"running",task:"Issue #"+cfg.queueIssue+" comment "+c.id,lastOutput:""};addEvent("START","Claude bắt đầu task "+c.id);
const safety=["Bạn là Claude Developer của SISCOM CRM.","Làm việc trong repository D:\\SISCOM-CRM.","Đọc AGENTS.md và CONTRIBUTING.md trước khi thao tác.","Không tự merge. Không push --force. Không đọc/in .env.","Không chạm siscom_crm_dev hoặc production database.","Nếu task cần quyền/ngữ cảnh không có, dừng và báo BLOCKED thay vì tự mở rộng phạm vi.","Báo cáo bằng tiếng Việt, nêu lệnh/test thật đã chạy; không tuyên bố PASS nếu chưa chạy.","","TASK:",task].join("\n");
const args=(cfg.claudeArgs||["-p","{prompt}"]).map(x=>x==="{prompt}"?safety:x);const r=await runClaudeAsync(args,Math.max(1,cfg.maxTaskMinutes||30)*60000);const output=[r.out,r.err,r.error].filter(Boolean).join("\n\n").trim();
if(r.code===0){state.claude={state:"idle",task:"",lastOutput:output.slice(-4000)};addEvent("DONE","Claude hoàn thành task "+c.id);postResult(c.id,"Claude completed",output||"Claude hoàn thành nhưng không có stdout.")}else{state.claude={state:"blocked",task:"Task "+c.id+" lỗi/đòi quyền",lastOutput:output.slice(-4000)};addEvent("ERROR","Claude task "+c.id+" exit="+r.code);postResult(c.id,"Claude blocked/failed","Exit code: "+r.code+"\n\n"+(output||"Không có output."))}
state.processed.push(c.id);activeTask=false;persist()}
function pollQueue(){if(activeTask)return;const q=fetchTaskComments(gh,cfg.repo,cfg.queueIssue);if(!q.ok){addEvent("GH_ERROR",q.error);return}for(const c of q.comments){if(c.user?.login!==cfg.trustedLogin)continue;if(!(c.body||"").includes("<!-- CLAUDE_TASK -->"))continue;if((state.processed||[]).includes(c.id))continue;processTask(c).catch(e=>{activeTask=false;state.claude={state:"blocked",task:"Runner exception",lastOutput:String(e)};addEvent("ERROR",String(e))});break}}
const server=http.createServer((req,res)=>{if(req.url==="/events"){res.writeHead(200,{"Content-Type":"text/event-stream","Cache-Control":"no-cache","Connection":"keep-alive"});res.write("data: "+JSON.stringify(state)+"\n\n");clients.add(res);req.on("close",()=>clients.delete(res));return}if(req.url==="/api/status"){res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify(state));return}if(req.url==="/"||req.url==="/index.html"){res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});res.end(fs.readFileSync(dashboardPath,"utf8"));return}res.writeHead(404);res.end("Not found")});
server.listen(cfg.port||45871,"127.0.0.1",()=>{addEvent("RUNNER","Auto-Runner started on http://127.0.0.1:"+(cfg.port||45871));console.log("SISCOM Claude Auto-Runner: http://127.0.0.1:"+(cfg.port||45871))});
refreshLocal();refreshGithub();persist();
setInterval(()=>{state.heartbeat=now();persist()},1000);
setInterval(refreshLocal,5000);
setInterval(refreshGithub,Math.max(10,cfg.githubPollSeconds||15)*1000);
setInterval(pollQueue,Math.max(5,cfg.pollSeconds||10)*1000);
