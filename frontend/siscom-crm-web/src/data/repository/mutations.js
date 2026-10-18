import { can, ROLES, ACTIONS } from '../../auth/permissions.js';
import { uid, maxNo, pad } from './ids.js';
import { validateCustomer, normalizeCustomer } from '../customerRules.js';

export class RepoError extends Error { constructor(message, title) { super(message); this.name = 'RepoError'; this.title = title; } }
const need = (x, action, rec) => { if (!can(x.user, action, rec)) throw new RepoError('Vai trò "' + ROLES[x.user.role].label + '" không có quyền: ' + ACTIONS[action] + (rec && rec.owner ? ' (khách hàng này do ' + rec.owner + ' phụ trách).' : '.'), 'Không đủ quyền'); };
const log = (d, x, action, entity, entityId, summary) => ({ ...d, auditLog: [{ id: uid('AU'), at: new Date().toISOString(), by: x.user.name, role: x.user.role, action, entity, entityId, summary }, ...(d.auditLog || [])].slice(0, 1000) });
const stamp = (x) => ({ updatedAt: new Date().toISOString(), updatedBy: x.user.name });
const custOf = (d, id) => d.customers.find((c) => c.id === id);

export const maxCustomerNo = (d) => maxNo(d.customers, 'KH-');
export const nextCustomerId = (d) => 'KH-' + pad(maxCustomerNo(d) + 1);

const ACTIVE = { contracts: ['Đang thực hiện', 'Chờ ký'], quotes: ['Nháp', 'Chờ duyệt', 'Đã duyệt', 'Đã gửi'] };
export function activeLinks(d, ids) {
  const has = (r) => ids.includes(r.customerId);
  const l = { contracts: d.contracts.filter((k) => has(k) && ACTIVE.contracts.includes(k.status)).length, quotes: d.quotes.filter((k) => has(k) && ACTIVE.quotes.includes(k.status)).length, projects: d.projects.filter((k) => has(k) && k.progress < 100).length, opportunities: d.opportunities.filter(has).length };
  l.total = l.contracts + l.quotes + l.projects + l.opportunities;
  const parts = [[l.contracts, 'hợp đồng đang hiệu lực'], [l.quotes, 'báo giá chưa đóng'], [l.projects, 'dự án đang thực hiện'], [l.opportunities, 'cơ hội kinh doanh']].filter((p) => p[0]).map((p) => p[0] + ' ' + p[1]);
  l.text = parts.join(', ');
  return l;
}

export function saveCustomer(d, c, contact, x) {
  const ex = custOf(d, c.id);
  need(x, ex ? 'customer.update' : 'customer.create', ex || c);
  if (ex && ex.deletedAt) throw new RepoError('Khách hàng này đã bị xoá.', 'Không thể lưu');
  const nc = normalizeCustomer(c);
  const errs = validateCustomer(nc, { customers: d.customers, selfId: c.id, original: ex });
  if (Object.keys(errs).length) { const er = new RepoError(Object.values(errs).join(' '), errs.taxId ? 'Mã số thuế không hợp lệ' : 'Dữ liệu chưa hợp lệ'); er.fields = errs; throw er; }
  const rec = ex ? { ...ex, ...nc, ...stamp(x) } : { ...nc, createdAt: c.createdAt, createdBy: x.user.name, ...stamp(x) };
  const customers = ex ? d.customers.map((k) => (k.id === c.id ? rec : k)) : [rec, ...d.customers];
  const contacts = contact ? [{ ...contact, id: uid('LH'), customerId: c.id, primary: true }, ...d.contacts] : d.contacts;
  return log({ ...d, customers, contacts }, x, ex ? 'update' : 'create', 'customer', c.id, (ex ? 'Sửa ' : 'Thêm ') + (nc.short || nc.name));
}
export function deleteCustomers(d, ids, x) {
  const targets = d.customers.filter((c) => ids.includes(c.id) && !c.deletedAt);
  targets.forEach((c) => need(x, 'customer.delete', c));
  const l = activeLinks(d, ids);
  if (l.total) throw new RepoError('Còn ' + l.text + '. Hãy xử lý các bản ghi này trước khi xoá.', 'Không thể xoá khách hàng');
  const at = new Date().toISOString();
  const customers = d.customers.map((c) => (ids.includes(c.id) && !c.deletedAt ? { ...c, deletedAt: at, deletedBy: x.user.name } : c));
  return log({ ...d, customers }, x, 'soft-delete', 'customer', ids.join(','), 'Xoá mềm ' + targets.length + ' khách hàng');
}
export function importCustomers(d, list, x) {
  need(x, 'customer.import');
  const seen = new Set(d.customers.filter((c) => !c.deletedAt && (c.taxId || '').trim()).map((c) => c.taxId.trim()));
  const rows = list.map((raw, i) => {
    const c = normalizeCustomer(raw);
    const errs = validateCustomer(c, { customers: d.customers });
    if (c.taxId) { if (!errs.taxId && seen.has(c.taxId)) errs.taxId = 'MST ' + c.taxId + ' bị trùng trong file.'; seen.add(c.taxId); }
    if (Object.keys(errs).length) { const er = new RepoError('Dòng ' + (i + 2) + ' (' + (c.name || 'không tên') + '): ' + Object.values(errs).join(' '), 'Dữ liệu nhập chưa hợp lệ'); er.fields = errs; throw er; }
    return { ...c, createdBy: x.user.name, ...stamp(x) };
  });
  return log({ ...d, customers: [...rows, ...d.customers] }, x, 'import', 'customer', '', 'Nhập ' + list.length + ' khách hàng');
}
export function saveContact(d, ct, x) {
  need(x, 'contact.write', custOf(d, ct.customerId));
  const ex = d.contacts.some((k) => k.id === ct.id);
  let contacts = ex ? d.contacts.map((k) => (k.id === ct.id ? ct : k)) : [ct, ...d.contacts];
  if (ct.primary) contacts = contacts.map((k) => (k.customerId === ct.customerId && k.id !== ct.id ? { ...k, primary: false } : k));
  return log({ ...d, contacts }, x, ex ? 'update' : 'create', 'contact', ct.id, ct.name);
}
export function deleteContact(d, id, x) {
  const ct = d.contacts.find((k) => k.id === id);
  need(x, 'contact.write', ct && custOf(d, ct.customerId));
  return log({ ...d, contacts: d.contacts.filter((k) => k.id !== id) }, x, 'delete', 'contact', id, ct ? ct.name : id);
}
export function addInteraction(d, it, x) {
  need(x, 'interaction.write', custOf(d, it.customerId));
  const rec = { ...it, id: uid('TT') };
  return log({ ...d, interactions: [rec, ...d.interactions] }, x, 'create', 'interaction', rec.id, it.type);
}
export function decideApproval(d, code, ok, x) {
  need(x, 'approval.decide');
  const ap = d.approvals.find((a) => a.code === code && a.status === 'Chờ duyệt');
  if (!ap) throw new RepoError('Báo giá ' + code + ' không còn ở trạng thái chờ duyệt.', 'Không thể xử lý');
  const at = new Date().toISOString();
  const approvals = d.approvals.map((a) => (a === ap ? { ...a, status: ok ? 'Đã duyệt' : 'Trả về', decidedBy: x.user.name, decidedAt: at } : a));
  const quotes = d.quotes.map((q) => (q.code === code ? { ...q, status: ok ? 'Đã duyệt' : 'Nháp' } : q));
  return log({ ...d, approvals, quotes }, x, ok ? 'approve' : 'reject', 'quote', code, (ok ? 'Phê duyệt ' : 'Trả về ') + code);
}
