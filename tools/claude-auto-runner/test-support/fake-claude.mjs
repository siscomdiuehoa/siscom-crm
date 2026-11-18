// claude giả cho kiểm thử Runner: nhận prompt (-p <prompt>), ghi vết bắt đầu/kết thúc để kiểm tra KHÔNG chạy song song,
// rồi in kết quả với dòng cuối SISCOM_TASK_OUTCOME. Không có hiệu ứng phụ nào khác.
import fs from "node:fs";

const prompt = process.argv.slice(2).join(" ");
const id = (/TASK_COMMENT_ID:\s*(\d+)/.exec(prompt) || [])[1] || "?";
const logPath = process.env.FAKE_CLAUDE_LOG;
const sleepMs = Number(process.env.FAKE_CLAUDE_SLEEP_MS || 150);
const outcome = process.env.FAKE_CLAUDE_OUTCOME || "DONE";
const mark = (kind) => { try { fs.appendFileSync(logPath, JSON.stringify({ t: Date.now(), kind, id, pid: process.pid }) + "\n"); } catch {} };
mark("start");
setTimeout(() => {
  mark("end");
  process.stdout.write("Đã xử lý task " + id + " (giả lập, chỉ đọc).\nSISCOM_TASK_OUTCOME: " + outcome + "\n");
  process.exit(0);
}, sleepMs);
