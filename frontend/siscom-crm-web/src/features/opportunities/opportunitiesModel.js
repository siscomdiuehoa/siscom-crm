// Sales S10: hàm thuần cho màn hình Cơ hội (không React/DOM/mạng). Đặc tả docs/SALES_DESIGN.md §6, §8; API §7.
// Mọi cổng ở đây chỉ là tiện ích giao diện (fail-closed); máy chủ luôn kiểm lại quyền, phạm vi, phiên bản và mọi quy tắc nghiệp vụ.

const scopeOfSafe = (scopeOf, p) => { try { return typeof scopeOf === 'function' ? scopeOf(p) || null : null; } catch (e) { return null; } };
const t = (v) => String(v == null ? '' : v).trim();

export const OPP_PAGE_SIZE = 20;
export const STATUS_META = {
  OPEN: { label: 'Đang mở', tone: 'info' },
  ON_HOLD: { label: 'Tạm hoãn', tone: 'warning' },
  WON: { label: 'Thắng', tone: 'success' },
  LOST: { label: 'Thua', tone: 'error' },
};
export const STATUS_FILTERS = [{ value: '', label: 'Mọi trạng thái' }, ...Object.keys(STATUS_META).map((k) => ({ value: k, label: STATUS_META[k].label }))];
export const statusLabel = (s) => (STATUS_META[s] || {}).label || s || '—';
export const WON_DOC_TYPES = [{ value: 'HOP_DONG', label: 'Hợp đồng' }, { value: 'DON_DAT_HANG', label: 'Đơn đặt hàng' }];

// ───── Số tiền VNĐ ─────
// API trả / nhận CHUỖI chữ số (bigint phía máy chủ). null = "Chưa rõ" — không bao giờ hiển thị thành 0 (§6, TC 7). Không ép về Number (mất chính xác).
export const AMOUNT_UNKNOWN = 'Chưa rõ';
const DIGITS = /^(0|[1-9]\d{0,14})$/;
export function moneyVN(v) {
  if (v === null || v === undefined || v === '') return AMOUNT_UNKNOWN;
  const s = String(v);
  if (!DIGITS.test(s)) return AMOUNT_UNKNOWN;
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' đ';
}
// Ô nhập số tiền: cho phép dấu chấm / phẩy / khoảng trắng ngăn nhóm. Trả { value: chuỗi chữ số | null } hoặc { error }.
export function parseAmountInput(text) {
  const raw = t(text);
  if (!raw) return { value: null };
  const s = raw.replace(/(đ|vnd|vnđ)$/i, '').replace(/[.,\s ]/g, '');
  if (!/^\d+$/.test(s)) return { error: 'Giá trị chỉ gồm chữ số (VNĐ, chưa VAT).' };
  const n = s.replace(/^0+(?=\d)/, '');
  if (n.length > 15) return { error: 'Giá trị tối đa 15 chữ số.' };
  return { value: n };
}
// Ô nhập số tiền hiển thị theo cách ghi số của văn bản hành chính / kế toán Việt Nam: dấu chấm ngăn nhóm hàng nghìn (1.234.567).
// Chỉ định dạng khi nội dung là số nguyên (chữ số + dấu ngăn nhóm . , khoảng trắng, có thể kèm "đ"/"VNĐ" ở cuối); có chữ / ký tự lạ thì GIỮ NGUYÊN
// để validate báo lỗi — không đoán ("1 tỷ" không tự thành 1). Giá trị gửi máy chủ vẫn là chuỗi chữ số qua parseAmountInput (không đổi).
const AMOUNT_SEP = /[.,\s ]/g;
const amountDigits = (raw) => raw.trim().replace(/\s*(đ|vnđ|vnd)$/i, '').replace(AMOUNT_SEP, '');
export function groupAmountText(text) {
  const raw = text == null ? '' : String(text);
  const d = amountDigits(raw);
  if (!d) return /^[.,\s ]*$/.test(raw) ? '' : raw;
  if (!/^\d+$/.test(d)) return raw;
  return d.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
// Xử lý một lần gõ trong ô số tiền: trả { text, caret } — chữ đã định dạng và vị trí con trỏ giữ đúng sau cùng số chữ số như trước khi chèn dấu chấm.
// Backspace / Delete chỉ xoá trúng dấu chấm (chữ số không đổi) => xoá luôn chữ số bên cạnh, để phím xoá luôn có tác dụng.
export function amountTyping(prev, raw, caret, inputType) {
  let text = raw == null ? '' : String(raw);
  let pos = typeof caret === 'number' && caret >= 0 && caret <= text.length ? caret : text.length;
  const before = prev == null ? '' : String(prev);
  if (text.length === before.length - 1 && text.replace(AMOUNT_SEP, '') === before.replace(AMOUNT_SEP, '')) {
    if (inputType === 'deleteContentBackward') {
      let i = pos - 1; while (i >= 0 && !/\d/.test(text[i])) i--;
      if (i >= 0) { text = text.slice(0, i) + text.slice(i + 1); pos = i; }
    } else if (inputType === 'deleteContentForward') {
      let i = pos; while (i < text.length && !/\d/.test(text[i])) i++;
      if (i < text.length) text = text.slice(0, i) + text.slice(i + 1);
    }
  }
  // Vừa gõ dấu cách: giữ nguyên chữ (người dùng có thể đang gõ "1 tỷ"); nếu gõ tiếp chữ số thì lần sau sẽ định dạng lại.
  if (/\s$/.test(text.slice(0, pos))) return { text, caret: pos };
  const out = groupAmountText(text);
  if (out === text) return { text: out, caret: pos };
  if (!/^[\d.]*$/.test(out)) return { text: out, caret: Math.min(pos, out.length) };
  // Số chữ số bên trái con trỏ (trừ các số 0 đứng đầu đã bỏ) => đặt con trỏ ngay sau chừng ấy chữ số trong chữ mới.
  const all = text.replace(/\D/g, ''); const dropped = all.length - out.replace(/\D/g, '').length;
  let left = Math.max(0, text.slice(0, pos).replace(/\D/g, '').length - dropped);
  if (left === 0) return { text: out, caret: 0 };
  let i = 0; for (; i < out.length && left > 0; i++) if (/\d/.test(out[i])) left--;
  return { text: out, caret: i };
}

// ───── Ngày (cột kiểu ngày, không giờ): 'YYYY-MM-DD' ─────
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
export function dateVN(ymd) { const m = YMD.exec(String(ymd || '')); return m ? m[3] + '/' + m[2] + '/' + m[1] : '—'; }
export function isValidYmd(v) {
  const m = YMD.exec(String(v || '')); if (!m) return false;
  const d = new Date(v + 'T00:00:00.000Z'); const y = d.getUTCFullYear();
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v && y >= 2000 && y <= 2100;
}
// Hôm nay theo giờ Việt Nam (UTC+7, không đổi giờ mùa) dạng YYYY-MM-DD.
export const todayVN = (now = Date.now()) => new Date(now + 7 * 3600e3).toISOString().slice(0, 10);
// "Quá hạn chốt": đang mở và ngày dự kiến chốt đã qua (so chuỗi YYYY-MM-DD là so ngày).
export const isCloseOverdue = (o, today = todayVN()) => !!o && o.status === 'OPEN' && typeof o.expectedCloseDate === 'string' && o.expectedCloseDate < today;

// ───── Danh sách ─────
const SORTS = ['updatedAt', 'createdAt', 'expectedCloseDate', 'code'];
// Truy vấn GET /opportunities. Bộ lọc rỗng không gửi; từ khoá < 2 ký tự không gửi (máy chủ từ chối); deleted chỉ nhận 'only'.
export function buildListQuery(f = {}) {
  const q = {};
  if (STATUS_META[f.status]) q.status = f.status;
  for (const k of ['stageId', 'typeId', 'ownerId', 'customerId']) if (t(f[k])) q[k] = t(f[k]);
  for (const k of ['closeFrom', 'closeTo']) if (isValidYmd(f[k])) q[k] = f[k];
  const kw = t(f.q); if (kw.length >= 2) q.q = kw.slice(0, 100);
  if (f.deleted === 'only') q.deleted = 'only';
  const page = Number.isInteger(f.page) && f.page > 0 ? f.page : 1;
  // pageSize: mặc định 20; kanban (S11) xin tối đa 100 thẻ mỗi cột (giới hạn của máy chủ).
  const pageSize = Number.isInteger(f.pageSize) && f.pageSize >= 1 && f.pageSize <= 100 ? f.pageSize : OPP_PAGE_SIZE;
  return { ...q, page, pageSize, sortBy: SORTS.includes(f.sortBy) ? f.sortBy : 'updatedAt', sortOrder: f.sortOrder === 'asc' ? 'asc' : 'desc' };
}

// Route: #/pipeline, #/pipeline/view/:id
export function parseOpportunitiesRoute(parts) {
  if (parts[1] === 'view' && parts[2]) { let id = parts[2]; try { id = decodeURIComponent(id); } catch (e) { /* giữ nguyên, máy chủ trả 400/404 */ } return { page: 'pipeline', id }; }
  return { page: 'pipeline' };
}

// ───── Thao tác hiện trên một cơ hội ─────
// ctx = { scopeOf(p) -> 'ALL' | 'DEPARTMENT' | 'OWN' | null, meId }. Quy tắc §5.4: ALL => mọi cơ hội thấy được; OWN => chỉ khi mình phụ trách cơ hội;
// DEPARTMENT chưa được hỗ trợ cho opportunity.* (máy chủ từ chối) => không hiện. Bản kỹ thuật (access = 'TASK') không có thao tác nào.
const holds = (ctx, perm, o) => {
  const s = scopeOfSafe(ctx.scopeOf, perm);
  if (s === 'ALL') return true;
  return s === 'OWN' && !!ctx.meId && !!o.owner && o.owner.id === ctx.meId;
};
export function opportunityActions(o, ctx = {}) {
  if (!o || o.access !== 'FULL' || o.deletedAt) return [];
  const out = [];
  const open = o.status === 'OPEN'; const hold = o.status === 'ON_HOLD'; const closed = o.status === 'WON' || o.status === 'LOST';
  // Sửa trường: máy chủ từ chối khi cơ hội đã đóng (Thắng / Thua) => không hiện nút.
  if (!closed && holds(ctx, 'opportunity.update', o)) out.push('edit');
  if (open && holds(ctx, 'opportunity.move_stage', o)) out.push('stage');
  if (holds(ctx, 'opportunity.close', o)) {
    if (open) out.push('hold');
    if (hold) out.push('holdEdit', 'resume');
    if (open || hold) out.push('win', 'lose');
  }
  if (holds(ctx, 'opportunity.assign', o)) out.push('assign');
  if (closed && scopeOfSafe(ctx.scopeOf, 'opportunity.reopen') === 'ALL') out.push('reopen');
  if (scopeOfSafe(ctx.scopeOf, 'opportunity.delete') === 'ALL') out.push('delete');
  return out;
}
// Thêm hoạt động / tài liệu cho cơ hội: người đạt opportunity.update trên cơ hội (kể cả khi đã đóng); bản kỹ thuật và cơ hội đã xoá thì không.
export const holdsUpdate = (o, ctx = {}) => !!o && o.access === 'FULL' && !o.deletedAt && holds(ctx, 'opportunity.update', o);
// Danh sách "Đã xoá" + nút Khôi phục: opportunity.restore phạm vi ALL và có opportunity.read (§5.4).
export const canRestore = (scopeOf) => scopeOfSafe(scopeOf, 'opportunity.restore') === 'ALL' && scopeOfSafe(scopeOf, 'opportunity.read') !== null;
export const ACTION_LABEL = { edit: 'Sửa', stage: 'Chuyển giai đoạn', hold: 'Tạm hoãn', holdEdit: 'Đổi hạn hoãn', resume: 'Tiếp tục', win: 'Thắng', lose: 'Thua', assign: 'Chuyển người phụ trách', reopen: 'Mở lại', delete: 'Xoá' };
export const ACTION_ICON = { edit: 'pencil', stage: 'arrow-right', hold: 'pause', holdEdit: 'calendar-clock', resume: 'play', win: 'trophy', lose: 'circle-x', assign: 'user-round-cog', reopen: 'rotate-ccw', delete: 'trash-2' };
// Nút "Tạo cơ hội": có opportunity.create (máy chủ kiểm theo KHÁCH được chọn).
export const canCreate = (scopeOf) => scopeOfSafe(scopeOf, 'opportunity.create') !== null;
// Mục "Cơ hội kinh doanh" trên thanh bên: có ít nhất một mã đọc (đường đầy đủ hoặc theo việc).
export const canSeeOpportunities = (scopeOf) => scopeOfSafe(scopeOf, 'opportunity.read') !== null || scopeOfSafe(scopeOf, 'opportunity.read_assigned') !== null;

// ───── Biểu mẫu "Tạo cơ hội" (§8.3) ─────
export const TYPE_HINT = 'Chọn theo PHẠM VI SISCOM CHÀO, không phải toàn bộ công trình. Ví dụ: chỉ bán FCU cho khách sạn → chọn "Cung cấp thiết bị, vật tư".';
export const EMPTY_CREATE = { customerId: '', title: '', typeId: '', isProjectLinked: false, projectName: '', offerScope: '', needSummary: '', expectedAmount: '', expectedCloseDate: '' };
// Loại bắt buộc gắn dự án (Thi công / Cung cấp và thi công) theo cờ requiresProject của GET /opportunities/meta.
export const typeRequiresProject = (meta, typeId) => !!meta && Array.isArray(meta.types) && meta.types.some((x) => x.id === typeId && x.requiresProject === true);
// Ô "Gắn với dự án/công trình": tự bật và khoá khi loại bắt buộc.
export const projectLinked = (form, meta) => typeRequiresProject(meta, form.typeId) || form.isProjectLinked === true;

export function validateCreate(form, meta) {
  const e = {};
  if (!t(form.customerId)) e.customerId = 'Chọn khách hàng';
  const title = t(form.title);
  if (!title) e.title = 'Vui lòng nhập tiêu đề cơ hội'; else if (title.length > 200) e.title = 'Tiêu đề tối đa 200 ký tự';
  if (!t(form.typeId)) e.typeId = 'Chọn loại cơ hội';
  if (projectLinked(form, meta)) {
    const pn = t(form.projectName); const os = t(form.offerScope);
    if (!pn) e.projectName = 'Vui lòng nhập tên dự án/công trình'; else if (pn.length > 200) e.projectName = 'Tên dự án tối đa 200 ký tự';
    if (!os) e.offerScope = 'Vui lòng nhập phạm vi SISCOM đang chào'; else if (os.length > 2000) e.offerScope = 'Phạm vi chào tối đa 2000 ký tự';
  }
  if (t(form.needSummary).length > 4000) e.needSummary = 'Nhu cầu tối đa 4000 ký tự';
  const amount = parseAmountInput(form.expectedAmount);
  if (amount.error) e.expectedAmount = amount.error;
  if (t(form.expectedCloseDate) && !isValidYmd(form.expectedCloseDate)) e.expectedCloseDate = 'Ngày không hợp lệ';
  return e;
}
// Thân POST /opportunities. Không gửi người phụ trách / giai đoạn / trạng thái / xác suất (máy chủ tự đặt). Không gắn dự án => không gửi tên dự án, phạm vi chào.
export function toCreateBody(form, meta) {
  const linked = projectLinked(form, meta);
  const body = { customerId: t(form.customerId), title: t(form.title), typeId: t(form.typeId), isProjectLinked: linked };
  if (linked) { body.projectName = t(form.projectName); body.offerScope = t(form.offerScope); }
  if (t(form.needSummary)) body.needSummary = t(form.needSummary);
  const amount = parseAmountInput(form.expectedAmount);
  if (amount.value) body.expectedAmountVnd = amount.value;
  if (isValidYmd(form.expectedCloseDate)) body.expectedCloseDate = form.expectedCloseDate;
  return body;
}
// Tên trường của máy chủ -> tên trường của biểu mẫu (lỗi 400 theo trường).
export const SERVER_FIELD = { expectedAmountVnd: 'expectedAmount', wonAmountVnd: 'wonAmount' };
export function serverFieldErrors(details) {
  const out = {}; const extra = [];
  for (const d of Array.isArray(details) ? details : []) {
    if (d && typeof d === 'object' && d.field) { const k = SERVER_FIELD[d.field] || d.field; if (!out[k]) out[k] = String(d.message || 'Không hợp lệ'); }
    else if (d) extra.push(String(d && d.message ? d.message : d));
  }
  return { fieldErrors: out, extra };
}
// Ô có trong từng hộp thao tác (§8.3). Máy chủ có thể từ chối vì một ô KHÔNG có trong hộp (ví dụ rời Tiếp cận khi chưa ghi nhu cầu của khách:
// lỗi gắn vào needSummary) — nếu chỉ đánh dấu theo ô thì người dùng không thấy lý do (lỗi nghiệm thu staging 19/11/2026).
export const ACTION_FIELDS = {
  stage: ['stageId', 'probability'], hold: ['holdUntil', 'holdReason'], holdEdit: ['holdUntil', 'holdReason'], resume: ['reason'],
  win: ['wonAmount', 'wonDocType', 'wonDocNo', 'wonDocDate', 'wonDocUrl', 'wonDocFileName', 'handoverToId', 'handoverDueDate'],
  lose: ['lostReasonId', 'lostNote'], assign: ['ownerId', 'reason'], reopen: ['reason'], delete: ['reason'],
};
// Lỗi phải hiện thành câu trong hộp: lỗi theo trường cho ô không có trong hộp + lỗi không gắn trường (extra). Không lặp câu.
// editable = có ít nhất một ô thuộc biểu mẫu Sửa cơ hội (người dùng sửa bằng nút Sửa rồi thao tác lại).
export function unplacedErrors(kind, fieldErrors, extra) {
  const own = ACTION_FIELDS[kind] || []; const messages = []; let editable = false;
  const add = (m) => { const s = String(m == null ? '' : m).trim(); if (s && !messages.includes(s)) messages.push(s); };
  for (const [k, m] of Object.entries(fieldErrors && typeof fieldErrors === 'object' ? fieldErrors : {})) {
    if (own.includes(k)) continue;
    if (EDIT_FIELDS.includes(k)) editable = true;
    add(m);
  }
  for (const m of Array.isArray(extra) ? extra : []) add(m);
  return { messages, editable };
}

// ───── Hộp thoại thao tác (§8.3 "Các hộp thoại khác") ─────
// kind: stage | hold | holdEdit | resume | win | lose | assign | reopen | delete. Mọi thao tác gửi version đã tải (khoá lạc quan).
export const ACTION_TITLE = { stage: 'Chuyển giai đoạn', hold: 'Tạm hoãn cơ hội', holdEdit: 'Đổi hạn tạm hoãn', resume: 'Tiếp tục cơ hội', win: 'Chốt Thắng', lose: 'Chốt Thua', assign: 'Chuyển người phụ trách', reopen: 'Mở lại cơ hội', delete: 'Xoá cơ hội' };
export const ACTION_DONE = { stage: 'Đã chuyển giai đoạn', hold: 'Đã tạm hoãn', holdEdit: 'Đã đổi hạn tạm hoãn', resume: 'Đã tiếp tục cơ hội', win: 'Đã chốt Thắng', lose: 'Đã chốt Thua', assign: 'Đã chuyển người phụ trách', reopen: 'Đã mở lại cơ hội', delete: 'Đã xoá cơ hội' };
// T-09: máy chủ cắt danh sách người nhận ở 500 người (truncated = true) => báo ngắn dưới ô chọn, không cắt âm thầm.
export const CANDIDATES_TRUNCATED_HINT = 'Chỉ hiện 500 người đầu theo tên — danh sách còn người khác chưa hiện.';
// Thao tác cần danh sách người nhận từ máy chủ (S10a): assign => owner-candidates; win => handover-candidates.
export const ACTION_CANDIDATES = { assign: 'owner-candidates', win: 'handover-candidates' };
const EMPTY_ACTION = { stageId: '', probability: 'KEEP', holdUntil: '', holdReason: '', reason: '', wonAmount: '', wonDocType: 'HOP_DONG', wonDocNo: '', wonDocDate: '', wonDocUrl: '', wonDocFileName: '', handoverToId: '', handoverDueDate: '', lostReasonId: '', lostNote: '', ownerId: '' };
// Giá trị ban đầu của hộp thoại: đổi hạn hoãn lấy hạn / lý do đang có; Thắng gợi ý giá trị chốt = giá trị dự kiến (người dùng sửa được).
export function initAction(kind, o) {
  const f = { ...EMPTY_ACTION };
  if (kind === 'holdEdit' && o) { f.holdUntil = o.holdUntil || ''; f.holdReason = o.holdReason || ''; }
  if (kind === 'win' && o && o.expectedAmountVnd) f.wonAmount = groupAmountText(String(o.expectedAmountVnd));
  return f;
}
const HTTPS = /^https:\/\/[^\s]+$/i;
const need = (e, k, v, msg, max) => { const s = t(v); if (!s) e[k] = msg; else if (max && s.length > max) e[k] = 'Tối đa ' + max + ' ký tự'; };
export function validateAction(kind, f, ctx = {}) {
  const e = {}; const o = ctx.o || {}; const meta = ctx.meta || {};
  if (kind === 'stage') {
    if (!t(f.stageId)) e.stageId = 'Chọn giai đoạn'; else if (o.stage && o.stage.id === f.stageId) e.stageId = 'Cơ hội đang ở giai đoạn này';
  } else if (kind === 'hold' || kind === 'holdEdit') {
    if (!isValidYmd(f.holdUntil)) e.holdUntil = 'Chọn ngày liên hệ lại';
    need(e, 'holdReason', f.holdReason, 'Tạm hoãn phải ghi lý do', 500);
  } else if (kind === 'resume') {
    if (t(f.reason).length > 500) e.reason = 'Tối đa 500 ký tự';
  } else if (kind === 'win') {
    const a = parseAmountInput(f.wonAmount);
    if (a.error) e.wonAmount = a.error; else if (a.value === null) e.wonAmount = 'Vui lòng nhập giá trị chốt';
    if (!WON_DOC_TYPES.some((x) => x.value === f.wonDocType)) e.wonDocType = 'Chọn loại chứng từ';
    need(e, 'wonDocNo', f.wonDocNo, 'Vui lòng nhập số chứng từ', 100);
    if (!isValidYmd(f.wonDocDate)) e.wonDocDate = 'Chọn ngày chứng từ';
    const url = t(f.wonDocUrl);
    if (!url) e.wonDocUrl = 'Vui lòng nhập đường dẫn chứng từ'; else if (!HTTPS.test(url) || url.length > 1000) e.wonDocUrl = 'Đường dẫn phải là địa chỉ https hợp lệ';
    if (t(f.wonDocFileName).length > 255) e.wonDocFileName = 'Tối đa 255 ký tự';
    if (!t(f.handoverToId)) e.handoverToId = 'Chọn người nhận bàn giao';
    if (t(f.handoverDueDate) && !isValidYmd(f.handoverDueDate)) e.handoverDueDate = 'Ngày không hợp lệ';
  } else if (kind === 'lose') {
    if (!t(f.lostReasonId)) e.lostReasonId = 'Chọn lý do thua';
    const r = (meta.lostReasons || []).find((x) => x.id === f.lostReasonId);
    if (r && r.requiresNote && !t(f.lostNote)) e.lostNote = 'Lý do này phải kèm ghi chú';
    if (t(f.lostNote).length > 2000) e.lostNote = 'Tối đa 2000 ký tự';
  } else if (kind === 'assign') {
    if (!t(f.ownerId)) e.ownerId = 'Chọn người nhận';
    need(e, 'reason', f.reason, 'Chuyển người phụ trách phải ghi lý do', 500);
  } else if (kind === 'reopen') {
    need(e, 'reason', f.reason, 'Mở lại cơ hội phải ghi lý do', 500);
  } else if (kind === 'delete') {
    need(e, 'reason', f.reason, 'Xoá cơ hội phải ghi lý do', 500);
  } else e._ = 'Thao tác không hợp lệ';
  return e;
}
// Yêu cầu HTTP của thao tác: { method, suffix, body }. Đường dẫn = /opportunities/:id + suffix.
export function toActionRequest(kind, f, o) {
  const v = { version: o.version };
  switch (kind) {
    case 'stage': return { method: 'POST', suffix: '/stage', body: { ...v, stageId: f.stageId, ...(o.probabilityOverridden ? { probability: f.probability === 'RESET' ? 'RESET' : 'KEEP' } : {}) } };
    case 'hold': case 'holdEdit': return { method: 'POST', suffix: '/hold', body: { ...v, holdUntil: f.holdUntil, holdReason: t(f.holdReason) } };
    case 'resume': return { method: 'POST', suffix: '/resume', body: { ...v, ...(t(f.reason) ? { reason: t(f.reason) } : {}) } };
    case 'win': return { method: 'POST', suffix: '/win', body: { ...v, wonAmountVnd: parseAmountInput(f.wonAmount).value, wonDocType: f.wonDocType, wonDocNo: t(f.wonDocNo), wonDocDate: f.wonDocDate, wonDocUrl: t(f.wonDocUrl),
      ...(t(f.wonDocFileName) ? { wonDocFileName: t(f.wonDocFileName) } : {}), handoverToId: f.handoverToId, ...(isValidYmd(f.handoverDueDate) ? { handoverDueDate: f.handoverDueDate } : {}) } };
    case 'lose': return { method: 'POST', suffix: '/lose', body: { ...v, lostReasonId: f.lostReasonId, ...(t(f.lostNote) ? { lostNote: t(f.lostNote) } : {}) } };
    case 'assign': return { method: 'POST', suffix: '/assign', body: { ...v, ownerId: f.ownerId, reason: t(f.reason) } };
    case 'reopen': return { method: 'POST', suffix: '/reopen', body: { ...v, reason: t(f.reason) } };
    case 'delete': return { method: 'DELETE', suffix: '', body: { ...v, reason: t(f.reason) } };
    default: return null;
  }
}

// ───── S10c: Sửa cơ hội (PATCH /opportunities/:id, §6.3) ─────
// Biểu mẫu điền sẵn từ chi tiết đã tải. Giá trị trống giữ là '' (không phải 0).
export function initEdit(o) {
  return {
    title: o.title || '', typeId: o.type ? o.type.id : '', isProjectLinked: !!o.isProjectLinked, projectName: o.projectName || '', offerScope: o.offerScope || '', needSummary: o.needSummary || '',
    expectedAmount: o.expectedAmountVnd === null || o.expectedAmountVnd === undefined ? '' : groupAmountText(String(o.expectedAmountVnd)), expectedCloseDate: o.expectedCloseDate || '',
    contactId: o.contact ? o.contact.id : '', probability: String(o.probability), probabilityReason: '',
  };
}
const probabilityOf = (v) => { const s = t(v); return /^\d{1,3}$/.test(s) && Number(s) <= 100 ? Number(s) : null; };
export const probabilityChanged = (form, o) => { const p = probabilityOf(form.probability); return p !== null && p !== o.probability; };
export function validateEdit(form, meta, o) {
  const e = validateCreate({ ...form, customerId: 'x' }, meta); // cùng giới hạn với biểu mẫu tạo; khách hàng không đổi được
  const p = probabilityOf(form.probability);
  if (p === null) e.probability = 'Xác suất là số nguyên từ 0 đến 100';
  else if (p !== o.probability) need(e, 'probabilityReason', form.probabilityReason, 'Sửa xác suất phải ghi lý do', 500);
  return e;
}
// Thân PATCH: CHỈ trường thực sự đổi (không gồm version — controller thêm). Xoá chữ / xoá giá trị => null (máy chủ hiểu là xoá, không phải 0).
// Bỏ gắn dự án => chỉ gửi isProjectLinked=false (máy chủ tự xoá tên dự án + phạm vi chào). Lý do xác suất chỉ gửi khi xác suất đổi.
export function toPatchBody(o, form, meta) {
  const b = {};
  if (t(form.title) !== t(o.title)) b.title = t(form.title);
  if (t(form.typeId) && (!o.type || form.typeId !== o.type.id)) b.typeId = form.typeId;
  const linked = projectLinked(form, meta);
  if (linked !== !!o.isProjectLinked) b.isProjectLinked = linked;
  if (linked) for (const k of ['projectName', 'offerScope']) if (t(form[k]) !== t(o[k])) b[k] = t(form[k]) || null;
  if (t(form.needSummary) !== t(o.needSummary)) b.needSummary = t(form.needSummary) || null;
  const amount = parseAmountInput(form.expectedAmount);
  const was = o.expectedAmountVnd === null || o.expectedAmountVnd === undefined ? null : String(o.expectedAmountVnd);
  if (!amount.error && amount.value !== was) b.expectedAmountVnd = amount.value;
  if (t(form.expectedCloseDate) !== t(o.expectedCloseDate)) b.expectedCloseDate = isValidYmd(form.expectedCloseDate) ? form.expectedCloseDate : null;
  const contactWas = o.contact ? o.contact.id : '';
  if (t(form.contactId) !== contactWas) b.contactId = t(form.contactId) || null;
  if (probabilityChanged(form, o)) { b.probability = probabilityOf(form.probability); b.probabilityReason = t(form.probabilityReason); }
  return b;
}

// ───── S10c: Lịch sử thay đổi (GET /opportunities/:id/changes) ─────
// T-02 (review Astra #259): danh sách phân trang có "Tải thêm". Đang tải lại trang 1 (version đổi) => đánh dấu reloading và CHẶN "Tải thêm",
// để không nối trang N+1 của lượt cũ vào trang 1 mới (mất các trang ở giữa, nút "Tải thêm" biến mất dù chưa đủ). Kết quả tải lại thay toàn bộ state.
export const pagedReloadStart = (x, idle) => (x && x.status === 'ready' ? { ...x, reloading: true } : idle);
export const pagedCanLoadMore = (x) => !!x && x.status === 'ready' && !x.reloading && x.more !== 'loading' && x.page < x.totalPages;
export const CHANGE_LABEL = { STAGE: 'Giai đoạn', STATUS: 'Trạng thái', HOLD: 'Ngày liên hệ lại', AMOUNT: 'Giá trị dự kiến', PROBABILITY: 'Xác suất', CLOSE_DATE: 'Dự kiến chốt', OWNER: 'Người phụ trách' };
// Một dòng lịch sử => { label, text }. Giá trị trống của số tiền là "Chưa rõ" (không phải 0). Mã giai đoạn đổi sang tên theo danh mục (nếu có).
// Người phụ trách lưu bằng id. T-03: API trả kèm oldOwner / newOwner (tên đọc cùng snapshot) => "Chuyển từ <cũ> sang <mới>". Thiếu tên (bản ghi cũ,
// nhân viên không còn tìm thấy) => dùng người phụ trách hiện tại nếu trùng id, còn lại câu chung. KHÔNG bao giờ hiện id thô.
export function describeChange(c, ctx = {}) {
  const stages = (ctx.meta && ctx.meta.stages) || []; const o = ctx.o || {};
  const label = CHANGE_LABEL[c.field] || String(c.field || '—');
  if (c.field === 'OWNER') {
    const nameOf = (p, id) => (p && p.fullName ? p.fullName : o.owner && id && o.owner.id === id ? o.owner.fullName : null);
    const from = nameOf(c.oldOwner, c.oldValue); const to = nameOf(c.newOwner, c.newValue);
    if (from && to) return { label, text: 'Chuyển từ ' + from + ' sang ' + to };
    if (to) return { label, text: 'Chuyển cho ' + to };
    if (from) return { label, text: 'Chuyển từ ' + from + ' sang người khác' };
    return { label, text: 'Đã chuyển người phụ trách' };
  }
  const fmt = (v) => {
    if (v === null || v === undefined || v === '') return c.field === 'AMOUNT' ? AMOUNT_UNKNOWN : '—';
    if (c.field === 'AMOUNT') return moneyVN(v);
    if (c.field === 'PROBABILITY') return v + '%';
    if (c.field === 'CLOSE_DATE' || c.field === 'HOLD') return dateVN(v);
    if (c.field === 'STAGE') return (stages.find((x) => x.code === v) || {}).label || String(v);
    if (c.field === 'STATUS') return statusLabel(v);
    return String(v);
  };
  return { label, text: fmt(c.oldValue) + ' → ' + fmt(c.newValue) };
}

// ───── S10c: Tài liệu cơ hội (§6.14) — chỉ đường dẫn https + tên tệp ─────
export const DOC_KINDS = [{ value: 'TECHNICAL', label: 'Kỹ thuật' }, { value: 'COMMERCIAL', label: 'Thương mại' }];
export const docKindLabel = (k) => (DOC_KINDS.find((x) => x.value === k) || {}).label || k;
export const EMPTY_DOC = { kind: 'TECHNICAL', fileName: '', url: '' };
// Chỉ đường dẫn https mới thành liên kết bấm được (không bao giờ javascript:, http:, data:).
export const safeHttps = (u) => (typeof u === 'string' && HTTPS.test(u) ? u : null);
export function validateDocument(f) {
  const e = {};
  if (!DOC_KINDS.some((x) => x.value === f.kind)) e.kind = 'Chọn nhóm tài liệu';
  need(e, 'fileName', f.fileName, 'Vui lòng nhập tên tệp', 255);
  const url = t(f.url);
  if (!url) e.url = 'Vui lòng nhập đường dẫn'; else if (!HTTPS.test(url) || url.length > 1000) e.url = 'Đường dẫn phải là địa chỉ https hợp lệ, không có khoảng trắng';
  return e;
}
export const toDocumentBody = (f) => ({ kind: f.kind, fileName: t(f.fileName), url: t(f.url) });
export function validateReason(reason, msg) { const e = {}; need(e, 'reason', reason, msg, 500); return e; }

// ───── S11: kanban (§8.1) ─────
export const BOARD_PAGE_SIZE = 100;
// T-02: số dòng lịch sử thay đổi mỗi lần tải (máy chủ cho tối đa 100).
export const CHANGES_PAGE_SIZE = 50;
// Tổng giá trị dự kiến của các thẻ ĐÃ TẢI trong một cột, tách riêng số thẻ "chưa rõ giá trị" (không bao giờ cộng chúng như 0).
// Chỉ tính thẻ đường đầy đủ; cộng bằng BigInt trên chuỗi chữ số. Không có thẻ nào có giá trị => sum = null (không phải "0").
export function sumAmounts(items) {
  let sum = 0n; let known = 0; let unknown = 0;
  for (const o of Array.isArray(items) ? items : []) {
    if (!o || o.access !== 'FULL') continue;
    const v = o.expectedAmountVnd;
    if (v === null || v === undefined || v === '' || !DIGITS.test(String(v))) { unknown += 1; continue; }
    sum += BigInt(String(v)); known += 1;
  }
  return { sum: known ? sum.toString() : null, known, unknown };
}
// Số tiền rút gọn cho tiêu đề cột: tỷ / triệu với một chữ số thập phân (cắt, không làm tròn lên); nhỏ hơn 1 triệu thì ghi đủ. null => "Chưa rõ".
// PR250-R1-01: đây là bộ định dạng của TỔNG nhiều cơ hội nên KHÔNG dùng DIGITS (giới hạn 15 chữ số của MỘT cơ hội) — tổng hợp lệ có thể dài hơn.
// Nhận mọi chuỗi số nguyên không âm (không có số 0 đứng đầu); tính bằng BigInt, không bao giờ qua Number.
const TOTAL_DIGITS = /^(0|[1-9]\d*)$/;
export function moneyShortVN(v) {
  if (v === null || v === undefined || v === '' || !TOTAL_DIGITS.test(String(v))) return AMOUNT_UNKNOWN;
  const n = BigInt(String(v));
  const short = (unit, name) => { const whole = n / unit; const dec = (n % unit) / (unit / 10n); return whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (dec ? ',' + dec : '') + ' ' + name; };
  if (n >= 1000000000n) return short(1000000000n, 'tỷ');
  if (n >= 1000000n) return short(1000000n, 'triệu');
  return moneyVN(String(v)); // < 1 triệu: luôn trong giới hạn của moneyVN
}
// Dòng tổng của cột: "9,8 tỷ", "1,2 tỷ + 2 chưa rõ", "2 chưa rõ"; cột trống => ''.
export function columnTotalLabel(items) {
  const t = sumAmounts(items);
  const parts = [];
  if (t.sum !== null) parts.push(moneyShortVN(t.sum));
  if (t.unknown) parts.push(t.unknown + ' chưa rõ');
  return parts.join(' + ');
}
// T-04: dòng tổng của cột từ GET /opportunities/board-summary (tính trên MỌI cơ hội đang mở của cột, không chỉ thẻ đã tải). Cùng định dạng với
// columnTotalLabel: tổng rút gọn + "n chưa rõ"; cột không có cơ hội nào (count 0) => ''. Dữ liệu lạ => '' (không đoán).
export function summaryTotalLabel(s) {
  if (!s || !Number.isInteger(s.count) || s.count <= 0) return '';
  const parts = [];
  if (s.sumExpectedAmountVnd !== null && s.sumExpectedAmountVnd !== undefined) parts.push(moneyShortVN(s.sumExpectedAmountVnd));
  if (Number.isInteger(s.unknownAmountCount) && s.unknownAmountCount > 0) parts.push(s.unknownAmountCount + ' chưa rõ');
  return parts.join(' + ');
}
// Tra cột theo stageId trong phản hồi board-summary; giai đoạn không có cơ hội nào không có dòng => cột rỗng (count 0).
export function summaryOf(summary, stageId) {
  const list = summary && Array.isArray(summary.stages) ? summary.stages : [];
  return list.find((x) => x && x.stageId === stageId) || { stageId, count: 0, knownAmountCount: 0, unknownAmountCount: 0, sumExpectedAmountVnd: null };
}
// ───── S10c R2 (PR249-R1-01): lưu lại sau xung đột phiên bản (409) ─────
// Vấn đề: sau 409, chi tiết được tải lại (version mới) nhưng biểu mẫu vẫn giữ MỌI giá trị cũ; so biểu mẫu cũ với bản mới sẽ coi cả những ô
// người dùng CHƯA chạm là "đã đổi" và ghi đè thay đổi của người kia. Cách xử lý: so biểu mẫu với bản GỐC lúc mở (base) để biết ô nào người dùng
// thực sự sửa; ô chưa sửa nhận giá trị của bản mới; ô CẢ HAI cùng sửa (khác nhau) => xung đột, giao diện chặn lưu tới khi người dùng chọn rõ.
export const EDIT_FIELDS = ['title', 'typeId', 'isProjectLinked', 'projectName', 'offerScope', 'needSummary', 'expectedAmount', 'expectedCloseDate', 'contactId', 'probability'];
export const EDIT_FIELD_LABEL = {
  title: 'Tiêu đề', typeId: 'Loại cơ hội', isProjectLinked: 'Gắn với dự án/công trình', projectName: 'Tên dự án/công trình', offerScope: 'Phạm vi SISCOM đang chào',
  needSummary: 'Nhu cầu của khách', expectedAmount: 'Giá trị dự kiến', expectedCloseDate: 'Dự kiến chốt', contactId: 'Người liên hệ', probability: 'Xác suất',
};
// Chuẩn hoá để SO SÁNH (không để gửi): số tiền theo giá trị (bỏ dấu ngăn nhóm; trống và 0 là hai giá trị KHÁC nhau), xác suất theo số, chữ thì cắt khoảng trắng.
const editKey = (k, v) => {
  if (k === 'isProjectLinked') return v === true ? '1' : '0';
  if (k === 'expectedAmount') { const a = parseAmountInput(v); return a.error ? 'x:' + t(v) : a.value === null ? '' : 'n:' + a.value; }
  if (k === 'probability') { const p = probabilityOf(v); return p === null ? 'x:' + t(v) : 'n:' + p; }
  return t(v);
};
// Các ô người dùng đã sửa so với bản gốc lúc mở biểu mẫu.
export const editTouched = (base, form) => { const b = initEdit(base); return EDIT_FIELDS.filter((k) => editKey(k, form[k]) !== editKey(k, b[k])); };
// base: bản lúc mở (hoặc lần đồng bộ trước); latest: bản vừa tải lại; form: biểu mẫu đang nhập.
// Trả { form, conflicts[{ k, mine, theirs }] }: form đã nhận giá trị mới ở các ô CHƯA sửa; conflicts = ô cả hai cùng sửa thành giá trị khác nhau.
export function rebaseEdit(base, latest, form) {
  const b = initEdit(base); const l = initEdit(latest); const next = { ...form }; const conflicts = [];
  for (const k of EDIT_FIELDS) {
    const mine = editKey(k, form[k]); const was = editKey(k, b[k]); const theirs = editKey(k, l[k]);
    if (mine === was) next[k] = l[k];
    else if (theirs !== was && theirs !== mine) conflicts.push({ k, mine: form[k], theirs: l[k] });
  }
  // Lý do sửa xác suất chỉ có nghĩa khi xác suất của mình còn khác bản mới (máy chủ từ chối lý do thừa).
  if (editKey('probability', next.probability) === editKey('probability', l.probability)) next.probabilityReason = '';
  return { form: next, conflicts };
}
// Chữ hiển thị một giá trị của ô số tiền trong khối xung đột: trống => "Chưa rõ" (không phải 0).
export const amountInputText = (v) => { const a = parseAmountInput(v); return a.error ? t(v) : moneyVN(a.value); };
