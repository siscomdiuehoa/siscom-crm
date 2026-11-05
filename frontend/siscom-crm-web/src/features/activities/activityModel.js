// B3 A7: hàm thuần cho tab Hoạt động (không React, không DOM, không mạng) — thiết kế docs/B3_ACTIVITIES_DESIGN.md §6–§8.
// Giờ người dùng nhập/hiển thị luôn là giờ Việt Nam (UTC+7), gửi lên máy chủ dạng ISO kèm "+07:00" (máy chủ bắt buộc có múi giờ).

// Loại hoạt động => nhãn, biểu tượng Lucide, tone (§8). TASK: tone theo trạng thái/quá hạn (activityVisual).
export const TYPE_META = {
  CALL: { label: 'Cuộc gọi', icon: 'phone', tone: 'blue' },
  EMAIL: { label: 'Email', icon: 'mail', tone: 'neutral' },
  MEETING: { label: 'Gặp mặt', icon: 'users', tone: 'success' },
  SITE_SURVEY: { label: 'Khảo sát hiện trường', icon: 'hard-hat', tone: 'warning' },
  NOTE: { label: 'Ghi chú', icon: 'sticky-note', tone: 'neutral' },
  TASK: { label: 'Công việc', icon: 'square-check', tone: 'blue' }, // §8 ghi "check-square": bộ Lucide trong repo chỉ có tên mới "square-check"
};
export const ALL_TYPES = ['CALL', 'EMAIL', 'MEETING', 'SITE_SURVEY', 'NOTE', 'TASK'];
export const TECH_TYPES = ['SITE_SURVEY', 'NOTE', 'TASK'];
export const STATUS_META = { OPEN: { label: 'Đang mở', tone: 'blue' }, DONE: { label: 'Hoàn thành', tone: 'success' }, CANCELLED: { label: 'Đã huỷ', tone: 'neutral' } };
export const OVERDUE_LABEL = 'Quá hạn';

const has = (can, perm) => { try { return typeof can === 'function' && !!can(perm); } catch (e) { return false; } }; // fail-closed

// Loại được phép chọn khi ghi nhận: activity.create => 6 loại; chỉ activity.create_tech => 3 loại kỹ thuật (§5). Máy chủ luôn kiểm lại.
export function allowedTypes(can) {
  if (has(can, 'activity.create')) return ALL_TYPES.slice();
  if (has(can, 'activity.create_tech')) return TECH_TYPES.slice();
  return [];
}

export const isOverdue = (a, nowMs = Date.now()) => !!a && a.type === 'TASK' && a.status === 'OPEN' && !!a.dueAt && Date.parse(a.dueAt) < nowMs;

export function activityVisual(a, nowMs = Date.now()) {
  const m = TYPE_META[a && a.type] || { icon: 'circle', tone: 'neutral' };
  if (!a || a.type !== 'TASK') return { icon: m.icon, tone: m.tone };
  if (a.status === 'DONE') return { icon: m.icon, tone: 'success' };
  if (a.status === 'CANCELLED') return { icon: m.icon, tone: 'neutral' };
  return { icon: m.icon, tone: isOverdue(a, nowMs) ? 'error' : 'blue' };
}

// datetime-local ("YYYY-MM-DDTHH:mm", giờ VN) => "YYYY-MM-DDTHH:mm:00+07:00"; sai dạng/ngày không có thật => null.
const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
export function vnLocalToIso(v) {
  const m = LOCAL_RE.exec(String(v == null ? '' : v).trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d || t.getUTCHours() !== h || t.getUTCMinutes() !== mi) return null;
  return m[0] + ':00+07:00';
}
const pad = (n) => String(n).padStart(2, '0');
// ISO bất kỳ => "YYYY-MM-DDTHH:mm" theo giờ VN (giá trị cho ô datetime-local). Không hợp lệ => ''.
export function isoToVnLocal(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const d = new Date(t + 7 * 3600 * 1000);
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
}

// Trường hiển thị theo loại (§8): tiêu đề + hạn/nhắc với TASK/MEETING; kết quả với CALL/MEETING/SITE_SURVEY; TASK không có thời điểm diễn ra.
export const hasTitle = (type) => type === 'TASK' || type === 'MEETING';
export const hasDue = (type) => type === 'TASK' || type === 'MEETING';
export const hasOutcome = (type) => type === 'CALL' || type === 'MEETING' || type === 'SITE_SURVEY';
export const hasOccurred = (type) => type !== 'TASK';

const s = (v) => String(v == null ? '' : v).trim();
// Kiểm tra phía giao diện (cùng giới hạn với DTO máy chủ); máy chủ luôn kiểm lại. Trả { field: thông báo }.
export function validateDraft(d) {
  const e = {}; const type = d && d.type;
  const content = s(d && d.content);
  if (!content) e.content = 'Vui lòng nhập nội dung';
  else if (content.length > 4000) e.content = 'Nội dung tối đa 4000 ký tự';
  if (hasTitle(type) && s(d.title).length > 200) e.title = 'Tiêu đề tối đa 200 ký tự';
  if (hasOutcome(type) && s(d.outcome).length > 2000) e.outcome = 'Kết quả tối đa 2000 ký tự';
  if (hasOccurred(type) && s(d.occurredAt) && !vnLocalToIso(d.occurredAt)) e.occurredAt = 'Thời điểm không hợp lệ';
  if (hasDue(type)) {
    const due = s(d.dueAt) ? vnLocalToIso(d.dueAt) : null; const rem = s(d.remindAt) ? vnLocalToIso(d.remindAt) : null;
    if (s(d.dueAt) && !due) e.dueAt = 'Hạn không hợp lệ';
    else if (type === 'TASK' && !due) e.dueAt = 'Công việc phải có hạn';
    if (s(d.remindAt) && !rem) e.remindAt = 'Thời điểm nhắc không hợp lệ';
    else if (rem && due && Date.parse(rem) > Date.parse(due)) e.remindAt = 'Thời điểm nhắc phải không sau hạn';
  }
  return e;
}

// Thân POST /customers/:id/activities: chỉ trường đúng loại, bỏ trường trống, giờ kèm +07:00. Người tạo/khách do máy chủ xác định.
export function buildCreateBody(d) {
  const type = d.type; const b = { type, content: s(d.content) };
  if (hasTitle(type) && s(d.title)) b.title = s(d.title);
  if (hasOutcome(type) && s(d.outcome)) b.outcome = s(d.outcome);
  if (hasOccurred(type) && s(d.occurredAt)) b.occurredAt = vnLocalToIso(d.occurredAt);
  if (hasDue(type) && s(d.dueAt)) b.dueAt = vnLocalToIso(d.dueAt);
  if (hasDue(type) && s(d.remindAt)) b.remindAt = vnLocalToIso(d.remindAt);
  if (s(d.contactId)) b.contactId = s(d.contactId);
  if (s(d.performedById)) b.performedById = s(d.performedById);
  return b;
}

// Chi tiết lỗi 400 (chuỗi) => { fieldErrors, extra }. Gắn theo tên trường đứng đầu (class-validator) hoặc nhắc trong câu của dịch vụ.
const FIELDS = ['title', 'content', 'outcome', 'occurredAt', 'dueAt', 'remindAt', 'contactId', 'performedById', 'type'];
const HINT_RE = [[/1 ngày sau hiện tại|occurredAt/, 'occurredAt'], [/nhắc|remindAt/, 'remindAt'], [/dueAt|\bhạn\b/, 'dueAt']];
export function detailsToFieldErrors(details) {
  const fieldErrors = {}; const extra = [];
  for (const raw of Array.isArray(details) ? details : []) {
    const t = typeof raw === 'string' ? raw : raw && (raw.message || (Array.isArray(raw.messages) ? raw.messages.join('; ') : '')) || '';
    if (!t) continue;
    const first = t.split(/[\s.:[]/)[0];
    let f = FIELDS.includes(first) ? first : null;
    if (!f) for (const [re, k] of HINT_RE) if (re.test(t)) { f = k; break; }
    if (f && !fieldErrors[f]) fieldErrors[f] = t; else extra.push(t);
  }
  return { fieldErrors, extra };
}
