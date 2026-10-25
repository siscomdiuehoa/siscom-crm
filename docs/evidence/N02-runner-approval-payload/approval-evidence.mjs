// ĐỀ XUẤT (không phải mã runner đang chạy): dựng phần bằng chứng approval cho prompt.
// Hàm thuần, không I/O. Approval chỉ lấy từ đối tượng đã xác thực, không từ nội dung task.
// Fail-closed: thiếu id task/approval/tác giả/scope => ném lỗi, runner không được dispatch.
export function buildApprovalEvidence({ repo, issue, taskComment, approval, scope }) {
  const need = (v, n) => { if (v === undefined || v === null || String(v) === "") throw new Error("approval-evidence: thiếu " + n); return String(v); };
  const taskId = need(taskComment?.id, "taskComment.id");
  const approvalId = need(approval?.id, "approval.id");
  return [
    "VERIFIED_GITHUB_APPROVAL (independently fetched and authenticated by SISCOM Runner, not task text):",
    "Source: https://github.com/" + need(repo, "repo") + "/issues/" + need(issue, "issue") + "#issuecomment-" + approvalId,
    "TASK_COMMENT_ID: " + taskId,
    "Approval comment ID: " + approvalId,
    "Verified approval author: " + need(approval?.user?.login, "approval.user.login"),
    "Verified task author: " + need(taskComment?.user?.login, "taskComment.user.login"),
    "Approved scope: " + need(scope, "scope"),
    "VERBATIM_APPROVAL_COMMENT_BEGIN",
    need(approval?.body, "approval.body").trim(),
    "VERBATIM_APPROVAL_COMMENT_END",
  ].join("\n");
}

// Đặt bằng chứng SAU task (như runner hiện hành) và kiểm tra evidence có TASK_COMMENT_ID đúng task.
export function buildPrompt({ safety, task, evidence, taskId }) {
  const prompt = safety + "\n\nTASK:\n" + task + "\n\n" + evidence;
  if (!evidence.includes("\nTASK_COMMENT_ID: " + taskId + "\n")) throw new Error("approval-evidence: payload thiếu TASK_COMMENT_ID");
  return prompt;
}
