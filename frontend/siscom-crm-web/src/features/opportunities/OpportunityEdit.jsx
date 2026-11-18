import React from 'react';
import { Button, Checkbox, Input, Modal, Select } from '../../ds/index.js';
import { ApiErrorBox } from '../customers/ApiListStatus.jsx';
import { useCustomerApiState } from '../customers/useCustomerApi.js';
import { initEdit, typeRequiresProject, projectLinked, probabilityChanged, TYPE_HINT } from './opportunitiesModel.js';

// Sales S10c: hộp thoại "Sửa cơ hội" (PATCH /opportunities/:id, §6.3). Chỉ gửi trường thực sự đổi + version đã tải; không đổi khách hàng,
// giai đoạn, trạng thái, người phụ trách ở đây (có thao tác riêng). Xoá giá trị dự kiến => "Chưa rõ" (null), không phải 0. Máy chủ kiểm lại mọi quy tắc.
const has = (ui, p) => typeof ui.can === 'function' && !!ui.can(p); // fail-closed

export function EditOpportunityDialog({ ui, o, onClose, onDone, onStale }) {
  const opps = ui.customerApi.opportunities;
  const s = useCustomerApiState(opps);
  const meta = s.meta.data;
  const [f, setF] = React.useState(() => initEdit(o));
  const [errs, setErrs] = React.useState({});
  const [error, setError] = React.useState(null);
  // Người liên hệ: chỉ khi có contact.read và người dùng đọc được hồ sơ khách (customerReadable do máy chủ trả).
  const customerId = o.customer ? o.customer.id : null;
  const canContact = has(ui, 'contact.read') && o.customerReadable === true && !!customerId;
  const [contacts, setContacts] = React.useState({ status: canContact ? 'loading' : 'none', items: [] });
  React.useEffect(() => { opps.loadMeta(); }, [opps]);
  React.useEffect(() => {
    if (!canContact) return undefined;
    let live = true;
    opps.contacts(customerId).then((r) => { if (live) setContacts(r.ok ? { status: 'ready', items: r.items } : { status: 'error', items: [] }); });
    return () => { live = false; };
  }, [opps, canContact, customerId]);
  const busy = !!s.busy;
  const set = (k) => (v) => {
    const val = v && v.target ? v.target.value : v;
    setF((x) => ({ ...x, [k]: val }));
    setErrs((x) => { if (!x[k]) return x; const n = { ...x }; delete n[k]; return n; });
  };
  const forced = typeRequiresProject(meta, f.typeId);
  const linked = projectLinked(f, meta);
  const probEdited = probabilityChanged(f, o);
  const submit = async () => {
    const r = await opps.update(o, f);
    if (r.duplicate) return;
    if (r.ok) { ui.toast(r.unchanged ? { tone: 'info', title: 'Không có thay đổi', message: o.code } : { tone: 'success', title: 'Đã lưu cơ hội', message: o.code }); onDone(r.data, 'edit', r.unchanged); return; }
    setErrs(r.fieldErrors || {}); setError(r.invalid ? null : r.error);
    if (r.stale && onStale) onStale();
  };
  const contactOptions = [{ value: '', label: '— Không chọn —' }]
    .concat(contacts.items.map((c) => ({ value: c.id, label: c.fullName + (c.isPrimary ? ' (chính)' : '') })))
    .concat(o.contact && !contacts.items.some((c) => c.id === o.contact.id) ? [{ value: o.contact.id, label: o.contact.fullName }] : []);
  return (
    <Modal open onClose={busy ? undefined : onClose} size="lg" icon="pencil" title="Sửa cơ hội" description={o.code + ' · ' + (o.customer ? o.customer.name : '')}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Huỷ</Button><Button loading={busy} disabled={!meta} onClick={submit}>Lưu thay đổi</Button></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {error ? <ApiErrorBox error={error.kind === 'conflict' ? { ...error, hint: 'Dữ liệu đã được tải lại. Nội dung bạn nhập vẫn còn — kiểm tra rồi lưu lại nếu vẫn cần.' } : error} /> : null}
        <Input label="Tiêu đề" required maxLength={200} value={f.title} onChange={set('title')} error={errs.title} disabled={busy} />
        {s.meta.status === 'error' ? <ApiErrorBox error={s.meta.error} onRetry={() => opps.loadMeta(true)} />
          : !meta ? <div role="status" style={{ color: 'var(--text-2)', font: 'var(--type-sm)' }}>Đang tải danh mục…</div>
          : <Select label="Loại cơ hội" required options={(meta.types || []).map((x) => ({ value: x.id, label: x.label }))} value={f.typeId} onChange={set('typeId')} error={errs.typeId} hint={TYPE_HINT} disabled={busy} />}
        <div className="sg-field">
          <Checkbox label="Gắn với dự án/công trình" checked={linked} disabled={busy || forced} onChange={(v) => set('isProjectLinked')(v)} />
          {forced ? <span className="sg-hint">Loại có thi công luôn gắn với dự án/công trình.</span> : null}
          {!linked && o.isProjectLinked ? <span className="sg-hint">Bỏ gắn dự án sẽ xoá tên dự án và phạm vi chào đã ghi.</span> : null}
          {errs.isProjectLinked ? <span className="sg-hint sg-hint--error">{errs.isProjectLinked}</span> : null}
        </div>
        {linked ? <>
          <Input label="Tên dự án/công trình" required maxLength={200} value={f.projectName} onChange={set('projectName')} error={errs.projectName} disabled={busy} />
          <Input label="Phạm vi SISCOM đang chào" required multiline rows={2} value={f.offerScope} onChange={set('offerScope')} error={errs.offerScope} disabled={busy} />
        </> : null}
        <Input label="Nhu cầu của khách" multiline rows={3} hint="Bắt buộc trước khi rời giai đoạn Tiếp cận." value={f.needSummary} onChange={set('needSummary')} error={errs.needSummary} disabled={busy} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <Input label="Giá trị dự kiến (VNĐ, chưa VAT)" suffix="đ" inputMode="numeric" hint='Để trống = "Chưa rõ" (không ghi 0).' value={f.expectedAmount} onChange={set('expectedAmount')} error={errs.expectedAmount} disabled={busy} />
          <Input label="Dự kiến chốt" type="date" value={f.expectedCloseDate} onChange={set('expectedCloseDate')} error={errs.expectedCloseDate} disabled={busy} />
        </div>
        {canContact ? <Select label="Người liên hệ" options={contactOptions} value={f.contactId} onChange={set('contactId')} error={errs.contactId} disabled={busy || contacts.status === 'loading'}
          hint={contacts.status === 'loading' ? 'Đang tải…' : contacts.status === 'error' ? 'Chưa tải được danh sách người liên hệ' : undefined} /> : null}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <Input label="Xác suất" suffix="%" inputMode="numeric" value={f.probability} onChange={set('probability')} error={errs.probability} disabled={busy}
            hint={o.probabilityOverridden ? 'Đang là giá trị nhập tay.' : 'Đang theo mặc định của giai đoạn; sửa tay phải ghi lý do.'} />
          {probEdited || errs.probabilityReason ? <Input label="Lý do sửa xác suất" required maxLength={500} value={f.probabilityReason} onChange={set('probabilityReason')} error={errs.probabilityReason} disabled={busy} /> : null}
        </div>
      </div>
    </Modal>
  );
}
