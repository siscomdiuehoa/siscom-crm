import React from 'react';
import { Button, Icon, IconButton, Input, Select, Switch } from '../../ds/index.js';
import { ApiErrorBox } from '../customers/ApiListStatus.jsx';
import { useCustomerApiState } from '../customers/useCustomerApi.js';
import { TYPE_META, allowedTypes, hasTitle, hasDue, hasOutcome, hasOccurred, validateDraft, buildCreateBody } from './activityModel.js';

const empty = (type) => ({ type, title: '', content: '', outcome: '', occurredAt: '', dueAt: '', remindAt: '', contactId: '', performedById: '', external: false });
const can = (ui, p) => typeof ui.can === 'function' && !!ui.can(p); // fail-closed

// B3 A7: drawer "Ghi nhận hoạt động" (§8): PC = drawer phải .sg-solid 640 px; điện thoại (ui.mobile) = bottom sheet.
// Loại theo quyền (6 hoặc 3); người liên hệ chỉ khi contact.read; người phụ trách chỉ khi activity.assign (ứng viên từ máy chủ). Máy chủ luôn kiểm lại.
export function ActivityDrawer({ open, ui, customerId, onClose, onSaved }) {
  const actl = ui.customerApi.activities;
  const s = useCustomerApiState(actl);
  const types = allowedTypes(ui.can);
  const canAssign = can(ui, 'activity.assign');
  const canContact = can(ui, 'contact.read');
  const canExternal = canAssign && can(ui, 'activity.assign_external') && !!(ui.customerApi && ui.customerApi.tasks);
  const [ext, setExt] = React.useState({ status: 'idle', items: [], error: null });
  const [f, setF] = React.useState(() => empty(types[0]));
  const [tried, setTried] = React.useState(false);
  React.useEffect(() => {
    if (!open) return;
    setF(empty(types[0])); setTried(false); actl.clearSubmitError();
    if (canAssign) actl.loadAssignees(customerId);
    if (canContact) actl.loadContacts(customerId);
  }, [open, customerId]); // eslint-disable-line react-hooks/exhaustive-deps
  const saving = s.submit.status === 'saving';
  const srv = s.submit.error;
  const errs = validateDraft(f);
  const err = (k) => (tried && errs[k]) || (srv && srv.fieldErrors && srv.fieldErrors[k]) || '';
  const dirty = JSON.stringify(f) !== JSON.stringify(empty(f.type)) || f.type !== types[0];
  const set = (k) => (v) => { if (srv && !srv.denied) actl.clearSubmitError(); setF((x) => ({ ...x, [k]: v && v.target ? v.target.value : v, ...(k === 'external' ? { performedById: '' } : {}) })); };
  // B3 A8: bật "Giao cho người phòng khác" => ứng viên ngoài phạm vi (API A6 external=true); chỉ với Công việc.
  React.useEffect(() => { if (!open || !f.external || !canExternal) return undefined; let live = true; setExt({ status: 'loading', items: [], error: null }); ui.customerApi.tasks.candidates(customerId, true).then((r) => { if (live) setExt(r.ok ? { status: 'ready', items: r.items, error: null } : { status: 'error', items: [], error: r.error }); }); return () => { live = false; }; }, [open, f.external, customerId]); // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => { if (saving) return; if (dirty) ui.confirm({ title: 'Huỷ ghi nhận?', description: 'Nội dung bạn vừa nhập sẽ không được lưu.', icon: 'triangle-alert', tone: 'warning', confirmLabel: 'Huỷ ghi nhận', cancelLabel: 'Tiếp tục nhập', onConfirm: onClose }); else onClose(); };
  React.useEffect(() => { if (!open) return undefined; const h = (e) => { if (e.key === 'Escape') close(); }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); });
  const save = async () => {
    setTried(true);
    if (Object.keys(errs).length || !types.includes(f.type)) return;
    const r = await actl.create(customerId, buildCreateBody(f));
    if (r.ok) { ui.toast({ tone: 'success', title: 'Đã ghi nhận ' + TYPE_META[r.activity.type].label.toLowerCase(), message: r.activity.code || '' }); onSaved && onSaved(r.activity); }
  };
  if (!open) return null;
  const mobile = !!ui.mobile;
  const as = s.assignees.customerId === customerId ? s.assignees : { status: 'idle', items: [], error: null };
  const cs = s.contacts.customerId === customerId ? s.contacts : { status: 'idle', items: [], error: null };
  const nonField = srv && !Object.keys(srv.fieldErrors || {}).length ? srv : srv && srv.extra && srv.extra.length ? { ...srv, message: srv.extra.join('; ') } : null;
  const panelStyle = mobile
    ? { position: 'relative', width: '100%', maxHeight: '92dvh', display: 'flex', flexDirection: 'column', borderRadius: 'var(--radius-xl24, 24px) var(--radius-xl24, 24px) 0 0', boxShadow: 'var(--shadow-lg)', animation: 'sg-toast-in var(--dur-slow) var(--ease-out)' }
    : { position: 'relative', width: 'min(640px,100%)', height: '100%', display: 'flex', flexDirection: 'column', borderRadius: '20px 0 0 20px', boxShadow: 'var(--shadow-lg)', animation: 'sg-toast-in var(--dur-slow) var(--ease-out)' };
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 65, display: 'flex', justifyContent: 'flex-end', alignItems: mobile ? 'flex-end' : 'stretch' }}>
      <div onClick={close} style={{ position: 'absolute', inset: 0, background: 'var(--overlay)', backdropFilter: 'blur(4px)', animation: 'sg-fade var(--dur-base)' }} />
      <aside role="dialog" aria-modal="true" aria-label="Ghi nhận hoạt động" className="sg-solid" style={panelStyle}>
        <header style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: mobile ? '16px 16px 12px' : '20px 24px', borderBottom: '1px solid var(--border-subtle)' }}>
          <span className="sg-kpi__icon"><Icon name="plus" size={18} /></span>
          <div style={{ flex: 1, minWidth: 0 }}><h2 style={{ margin: 0, font: 'var(--type-h3)' }}>Ghi nhận hoạt động</h2><p style={{ margin: '2px 0 0', font: 'var(--type-sm)', color: 'var(--text-2)' }}>Giờ nhập theo giờ Việt Nam. Chỉ nội dung là bắt buộc{f.type === 'TASK' ? '; công việc cần có hạn' : ''}.</p></div>
          <IconButton icon="x" label="Đóng" size="sm" onClick={close} />
        </header>
        <div className="sg-scroll" style={{ flex: 1, overflow: 'auto', padding: mobile ? 16 : 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {nonField ? <ApiErrorBox error={nonField} /> : null}
          <div role="radiogroup" aria-label="Loại hoạt động" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {types.map((t) => {
              const on = f.type === t;
              return (
                <button key={t} type="button" role="radio" aria-checked={on} className="sg-chip" onClick={() => set('type')(t)}
                  style={on ? { background: 'var(--primary-soft)', borderColor: 'transparent', color: 'var(--primary-text)' } : undefined}>
                  <Icon name={TYPE_META[t].icon} size={14} />{TYPE_META[t].label}
                </button>
              );
            })}
          </div>
          {hasTitle(f.type) ? <Input label="Tiêu đề" value={f.title} onChange={set('title')} maxLength={200} error={err('title')} placeholder={f.type === 'TASK' ? 'Ví dụ: Gửi báo giá' : 'Ví dụ: Họp khảo sát nhu cầu'} /> : null}
          <Input label="Nội dung" required multiline rows={4} value={f.content} onChange={set('content')} maxLength={4000} error={err('content')} placeholder="Đã trao đổi gì, cần làm gì…" />
          {hasOutcome(f.type) ? <Input label="Kết quả" multiline rows={2} value={f.outcome} onChange={set('outcome')} maxLength={2000} error={err('outcome')} /> : null}
          <div style={{ display: 'grid', gridTemplateColumns: mobile ? 'minmax(0,1fr)' : 'repeat(2, minmax(0,1fr))', gap: 12 }}>
            {hasOccurred(f.type) ? <Input label="Thời điểm diễn ra" type="datetime-local" value={f.occurredAt} onChange={set('occurredAt')} error={err('occurredAt')} hint="Để trống = lúc lưu" /> : null}
            {hasDue(f.type) ? <Input label="Hạn" required={f.type === 'TASK'} type="datetime-local" value={f.dueAt} onChange={set('dueAt')} error={err('dueAt')} /> : null}
            {hasDue(f.type) ? <Input label="Nhắc lúc" type="datetime-local" value={f.remindAt} onChange={set('remindAt')} error={err('remindAt')} hint="Không sau hạn" /> : null}
          </div>
          {canContact ? (
            <Select label="Người liên hệ" value={f.contactId} onChange={set('contactId')} error={err('contactId')}
              disabled={cs.status !== 'ready'} hint={cs.status === 'loading' ? 'Đang tải…' : cs.status === 'error' ? 'Chưa tải được người liên hệ' : ''}
              options={[{ value: '', label: '— Không chọn —' }].concat(cs.items.map((c) => ({ value: c.id, label: c.fullName + (c.isPrimary ? ' (chính)' : '') })))} />
          ) : null}
          {canExternal && f.type === 'TASK' ? <div><Switch label="Giao cho người phòng khác" checked={f.external} onChange={set('external')} /><p style={{ margin: '4px 0 0', font: 'var(--type-caption)', color: 'var(--text-3)' }}>Người nhận chỉ xem thẻ việc, không xem hồ sơ khách.</p></div> : null}
          {canAssign && f.external && f.type === 'TASK' ? (
            <Select label="Người phụ trách" value={f.performedById} onChange={set('performedById')} error={err('performedById')} disabled={ext.status !== 'ready'}
              hint={ext.status === 'loading' ? 'Đang tải…' : ext.status === 'error' ? 'Chưa tải được danh sách' : 'Người phòng khác, không đọc được khách; có quyền theo việc đến khi xong'}
              options={[{ value: '', label: '— Chọn người —' }].concat(ext.items.map((e) => ({ value: e.id, label: e.fullName + ' · ' + e.code + (e.departmentCode ? ' · ' + e.departmentCode : '') })))} />
          ) : null}
          {canAssign && !(f.external && f.type === 'TASK') ? (
            <Select label="Người phụ trách" value={f.performedById} onChange={set('performedById')} error={err('performedById')}
              disabled={as.status !== 'ready'} hint={as.status === 'loading' ? 'Đang tải…' : as.status === 'error' ? 'Chưa tải được danh sách; hoạt động sẽ ghi cho bạn' : 'Chỉ người đọc được khách này'}
              options={[{ value: '', label: 'Tôi (người ghi nhận)' }].concat(as.items.map((e) => ({ value: e.id, label: e.fullName + ' · ' + e.code + (e.departmentCode ? ' · ' + e.departmentCode : '') })))} />
          ) : null}
        </div>
        <footer style={{ display: 'flex', alignItems: 'center', gap: 8, padding: mobile ? '12px 16px calc(12px + env(safe-area-inset-bottom))' : '14px 24px', borderTop: '1px solid var(--border-subtle)', background: 'var(--surface-sunken)', flexWrap: 'wrap' }}>
          {tried && Object.keys(errs).length ? <span style={{ flex: 1, display: 'inline-flex', alignItems: 'center', gap: 6, font: 'var(--type-sm)', color: 'var(--error-text)' }}><Icon name="circle-alert" size={14} />{Object.keys(errs).length} trường cần sửa</span> : <span style={{ flex: 1 }} />}
          <Button variant="secondary" disabled={saving} onClick={close}>Huỷ</Button>
          <Button icon="check" loading={saving} onClick={save}>Lưu</Button>
        </footer>
      </aside>
    </div>
  );
}
