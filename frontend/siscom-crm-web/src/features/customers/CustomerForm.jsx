import React from 'react';
import { Input, Select, Button, IconButton, Icon, Badge } from '../../ds/index.js';
import * as U from '../../data/util.js';
import { APP_DATA } from '../../data/demoData.js';
import { validateCustomer, getCustomerDefaults } from '../../data/customerRules.js';
import { useCustomerApiState } from './useCustomerApi.js';
import { formToCustomerInput, customerDisplayCode, diffAgainstServer, lookupFieldView, lookupFormErrors, ownerFieldView, contactNameError, CONTACT_NAME_MAX } from './customerApiUi.js';
import { ApiErrorBox, ApiConflictPanel } from './ApiListStatus.jsx';

const withNone = (a, label) => [{ value: '', label: typeof label === 'string' ? label : '— Chưa chọn —' }, ...a];
// API mode: tier/status start empty (server defaults apply); demo defaults are labels the server may not have.
const emptyForm = (apiOn) => { const d = getCustomerDefaults(); return { name: '', short: '', taxId: '', industry: '', tier: apiOn ? '' : d.tier, status: apiOn ? '' : d.status, owner: '', ownerId: '', source: '', address: '', city: '', phone: '', email: '', website: '', note: '', cName: '', cTitle: '', cPhone: '', cEmail: '', contactName: '' }; };

function validate(f, isNew, customers, selfId, original) {
  const e = validateCustomer(f, { customers, selfId, original });
  if (isNew && f.cName.trim()) {
    if (!f.cPhone.trim() && !f.cEmail.trim()) e.cPhone = 'Nhập điện thoại hoặc email của người liên hệ';
    if (f.cPhone.trim() && !U.isPhone(f.cPhone)) e.cPhone = 'Số điện thoại chưa hợp lệ';
    if (f.cEmail.trim() && !U.isEmail(f.cEmail)) e.cEmail = 'Email chưa đúng định dạng';
  }
  return e;
}

function Section({ title, icon, children }) {
  return (
    <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <legend style={{ display: 'flex', alignItems: 'center', gap: 8, font: 'var(--type-overline)', letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color: 'var(--text-3)', padding: 0, marginBottom: 14 }}><Icon name={icon} size={14} />{title}</legend>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 14 }}>{children}</div>
    </fieldset>
  );
}

export function CustomerFormDrawer({ open, initial, onClose, onSaved, ui }) {
  const D = APP_DATA;
  const isNew = !initial;
  // Flag OFF: ui.customerApi is null -> apiOn=false and the original sync localStorage save below is used unchanged.
  const apiCtl = ui.customerApi; const apiS = useCustomerApiState(apiCtl); const apiOn = !!apiCtl;
  const saving = apiOn && (isNew ? apiS.submit.status : apiS.update.status) === 'saving';
  const srvErr = apiOn ? (isNew ? apiS.submit.error : apiS.update.error) : null;
  const start = React.useMemo(() => (initial ? { ...emptyForm(apiOn), ...initial } : emptyForm(apiOn)), [initial, open]);
  React.useEffect(() => { if (apiCtl && open) { apiCtl.loadLookups(); if (typeof apiCtl.loadOwners === 'function') apiCtl.loadOwners(); } }, [apiCtl, open]);
  const lk = apiOn ? apiS.lookups : null;
  // Flag ON: selects show ONLY canonical server choices (GET /lookups). Flag OFF: unchanged demo lists.
  const L = (field, demo, none) => { if (!apiOn) return { options: none ? withNone(demo) : demo }; const v = lookupFieldView(lk, field, f[field]); return { options: withNone(v.options, none ? undefined : '— Mặc định máy chủ —'), disabled: v.disabled, hint: v.hint, error: v.error }; };
  const [f, setF] = React.useState(start);
  const [tried, setTried] = React.useState(false);
  const [baseVersion, setBaseVersion] = React.useState(null); // set only by the explicit "keep my changes" choice after a 409; null = use the loaded version
  // PR 7: owner select = candidates the server allows for this actor (scope ALL/DEPARTMENT/OWN); "— Chưa phân công —" only for ALL.
  const ow = apiOn ? ownerFieldView(apiS.owners, f.ownerId) : null;
  React.useEffect(() => { setF(start); setTried(false); setBaseVersion(null); if (apiCtl && open) apiCtl.clearSubmitError(); }, [start]);
  const known = apiOn ? apiS.list.items.map((c) => ({ ...c, id: c.code || '' })) : ui.db.customers; // API mode: never show the backend uuid
  // B1.4 người liên hệ (API): chỉ khi server cấp contact.create (UI gate; server kiểm lại phạm vi + customer.update). Sửa: chỉ khi đã tải được
  // người liên hệ hiện tại của chính khách này (biết tên hiện tại => không tạo trùng). Không có ô SĐT: dùng SĐT công ty.
  const ctS = apiOn ? apiS.contact : null;
  const showContact = apiOn && typeof ui.can === 'function' && !!ui.can('contact.create') && (isNew || (!!ctS && ctS.status === 'ready' && ctS.id === initial.id));
  const hasContact = !isNew && !!ctS && !!ctS.item;
  // QA M-4: tên người liên hệ mới mang SĐT công ty; SĐT cũ sai định dạng (được giữ nguyên khi sửa) sẽ bị server từ chối SAU khi khách đã lưu => báo ngay tại ô.
  const cName = String(f.contactName || '').trim();
  const cChanged = !!cName && cName !== (hasContact ? String(ctS.item.fullName || '').trim() : '');
  const cErr = !showContact ? '' : contactNameError(f.contactName) || (cChanged && !U.isPhone(f.phone) ? 'Số điện thoại công ty chưa hợp lệ nên chưa lưu được người liên hệ; sửa ô Điện thoại.' : '');
  const errs = { ...validate(f, isNew, known, initial && (apiOn ? initial.code : initial.id), initial), ...(apiOn ? lookupFormErrors(lk, f) : {}), ...(cErr ? { contactName: cErr } : {}) };
  const err = (k) => (tried && errs[k]) || (srvErr && srvErr.fieldErrors[k]) || '';
  const dirty = JSON.stringify(f) !== JSON.stringify(start);
  const denied = !!(srvErr && srvErr.denied); // 401/403: the access-denied notice stays (editing the draft does not dismiss it) and saving is blocked until the form is closed/reopened
  const set = (k) => (v) => { if (srvErr && !srvErr.staleVersion && !srvErr.denied) apiCtl.clearSubmitError(); setF((x) => ({ ...x, [k]: v && v.target ? v.target.value : v })); };
  const close = () => { if (saving) return; if (dirty) ui.confirm({ title: 'Huỷ các thay đổi?', description: 'Thông tin bạn vừa nhập sẽ không được lưu.', icon: 'triangle-alert', tone: 'warning', confirmLabel: 'Huỷ thay đổi', cancelLabel: 'Tiếp tục chỉnh sửa', onConfirm: onClose }); else onClose(); };
  React.useEffect(() => { if (!open) return; const h = (e) => { if (e.key === 'Escape') close(); }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); });
  const save = async () => {
    if (denied) return;
    setTried(true);
    if (Object.keys(errs).length) { ui.toast({ tone: 'error', title: 'Vui lòng kiểm tra lại', message: Object.keys(errs).length + ' trường chưa hợp lệ.' }); return; }
    if (apiOn && !isNew) {
      // Update by backend UUID with the optimistic-lock version of the loaded detail; the UI shows the server's response only.
      const r = await apiCtl.update(initial.id, formToCustomerInput(f, initial), baseVersion || initial.version, showContact ? f.contactName : '');
      if (r.ok && r.contactError) { ui.toast({ tone: 'warning', title: 'Đã lưu khách hàng, chưa lưu người liên hệ', message: r.contactError.message }); onSaved && onSaved(r.customer); }
      else if (r.ok) { ui.toast({ tone: 'success', title: 'Đã lưu thay đổi', message: r.customer.short || r.customer.name }); onSaved && onSaved(r.customer); }
      else if (!r.duplicate) ui.toast({ tone: 'error', title: r.error.title, message: r.error.staleVersion ? 'Khách hàng đã bị người khác cập nhật. Dữ liệu chưa được lưu.' : r.error.message });
      return;
    }
    if (apiOn) {
      // Async save through the API repository: no localStorage write, no fake success, duplicate clicks ignored while saving.
      const r = await apiCtl.submit(formToCustomerInput(f), showContact ? f.contactName : '');
      if (r.ok && r.contactError) { ui.toast({ tone: 'warning', title: 'Đã thêm khách hàng ' + customerDisplayCode(r.customer) + ', chưa lưu người liên hệ', message: r.contactError.message }); onSaved && onSaved(r.customer); }
      else if (r.ok) { ui.toast({ tone: 'success', title: 'Đã thêm khách hàng ' + customerDisplayCode(r.customer), message: r.customer.short || r.customer.name }); onSaved && onSaved(r.customer); }
      else if (!r.duplicate) ui.toast({ tone: 'error', title: r.error.title, message: r.error.message });
      return;
    }
    const { cName, cTitle, cPhone, cEmail, ...rest } = f;
    const c = { ...rest, name: rest.name.trim(), short: rest.short.trim() || rest.name.trim().replace(/^(Công ty|Cty)\s+(CP|TNHH|Cổ phần)\s*/i, ''), taxId: rest.taxId.trim(), id: isNew ? ui.api.nextId() : initial.id, createdAt: isNew ? U.today() : initial.createdAt, revenue: isNew ? 0 : initial.revenue, tags: isNew ? [] : initial.tags };
    if (!ui.api.saveCustomer(c, isNew && cName.trim() ? { name: cName.trim(), title: cTitle.trim(), phone: cPhone.trim(), email: cEmail.trim() } : null).ok) return;
    ui.toast({ tone: 'success', title: isNew ? 'Đã thêm khách hàng ' + c.id : 'Đã lưu thay đổi', message: c.short });
    onSaved && onSaved(c);
  };
  if (!open) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 65, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={close} style={{ position: 'absolute', inset: 0, background: 'var(--overlay)', backdropFilter: 'blur(4px)', animation: 'sg-fade var(--dur-base)' }} />
      <aside role="dialog" aria-modal="true" aria-label={isNew ? 'Thêm khách hàng' : 'Sửa thông tin khách hàng'} className="sg-solid" style={{ position: 'relative', width: 'min(640px,100%)', height: '100%', display: 'flex', flexDirection: 'column', borderRadius: '20px 0 0 20px', boxShadow: 'var(--shadow-lg)', animation: 'sg-toast-in var(--dur-slow) var(--ease-out)' }}>
        <header style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '20px 24px', borderBottom: '1px solid var(--border-subtle)' }}>
          <span className="sg-kpi__icon"><Icon name={isNew ? 'user-plus' : 'pencil'} size={18} /></span>
          <div style={{ flex: 1, minWidth: 0 }}><h2 style={{ margin: 0, font: 'var(--type-h3)' }}>{isNew ? 'Thêm khách hàng' : 'Sửa thông tin khách hàng'}</h2><p style={{ margin: '2px 0 0', font: 'var(--type-sm)', color: 'var(--text-2)' }}>{isNew ? 'Chỉ Tên công ty và Điện thoại là bắt buộc.' : (apiOn ? customerDisplayCode(initial) : initial.id) + ' · ' + initial.short}</p></div>
          <IconButton icon="x" label="Đóng" size="sm" onClick={close} />
        </header>
        <div className="sg-scroll" style={{ flex: 1, overflow: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 28 }}>
          {srvErr && srvErr.staleVersion && !isNew ? <ApiConflictPanel conflict={apiS.update.conflict} diff={apiS.update.conflict && apiS.update.conflict.server ? diffAgainstServer(f, apiS.update.conflict.server) : []} onRefresh={() => apiCtl.refreshConflict(initial.id)} onUseServer={() => apiCtl.acceptServerCopy()} onKeepMine={() => { const sv = apiS.update.conflict.server; setBaseVersion(sv.version); apiCtl.clearSubmitError(); }} /> : srvErr ? <ApiErrorBox error={srvErr} /> : null}
          {apiOn && lk.status === 'error' ? <ApiErrorBox error={lk.error} onRetry={() => apiCtl.loadLookups(true)} retryLabel="Tải lại danh mục" /> : null}
          {apiOn && (lk.status === 'idle' || lk.status === 'loading') ? <span role="status" aria-live="polite" style={{ font: 'var(--type-sm)', color: 'var(--text-2)' }}>Đang tải danh mục lựa chọn từ máy chủ…</span> : null}
          {saving ? <span role="status" className="sr-only">Đang lưu khách hàng…</span> : null}
          <Section title="Thông tin doanh nghiệp" icon="building">
            <div style={{ gridColumn: '1 / -1' }}><Input label="Tên công ty" required placeholder="VD: Công ty CP Đầu tư Xây dựng Phú An" value={f.name} onChange={set('name')} error={err('name')} /></div>
            <Input label="Tên viết tắt" placeholder="Tự động nếu để trống" value={f.short} onChange={set('short')} />
            <Input label="Mã số thuế" placeholder="Để trống nếu chưa có" inputMode="numeric" value={f.taxId} onChange={(e) => set('taxId')(e.target.value.replace(/[^\d-]/g, ''))} error={err('taxId')} />
            <Select label="Ngành nghề" placeholder="Chưa chọn" value={f.industry} onChange={set('industry')} {...L('industry', D.INDUSTRIES, true)} error={err('industry')} />
            <Select label="Nguồn khách hàng" value={f.source} onChange={set('source')} {...L('source', D.SOURCES, true)} error={err('source')} />
          </Section>
          <Section title="Địa chỉ & liên hệ" icon="map-pin">
            <div style={{ gridColumn: '1 / -1' }}><Input label="Địa chỉ" placeholder="Số nhà, đường, phường/xã" value={f.address} onChange={set('address')} error={err('address')} /></div>
            <Select label="Tỉnh / Thành phố" placeholder="Chưa chọn" value={f.city} onChange={set('city')} {...L('city', D.CITIES, true)} error={err('city')} />
            <Input label="Điện thoại" required icon="phone" placeholder="028 3822 1234 hoặc +82 2 1234 5678" inputMode="tel" value={f.phone} onChange={set('phone')} error={err('phone')} />
            <Input label="Email" icon="mail" placeholder="lienhe@congty.vn" type="email" value={f.email} onChange={set('email')} error={err('email')} />
            <Input label="Website" icon="globe" placeholder="congty.vn" value={f.website} onChange={set('website')} error={err('website')} />
          </Section>
          <Section title="Phân loại & phụ trách" icon="tag">
            <Select label="Phân hạng" placeholder={apiOn ? 'Mặc định máy chủ' : undefined} value={f.tier} onChange={set('tier')} {...L('tier', D.TIERS, false)} error={err('tier')} />
            <Select label="Trạng thái" placeholder={apiOn ? 'Mặc định máy chủ' : undefined} value={f.status} onChange={set('status')} {...L('status', D.STATUSES, false)} error={err('status')} />
            {apiOn
              ? <div style={{ gridColumn: '1 / -1' }}><Select label="Nhân viên phụ trách" placeholder={ow.allowNone ? 'Chưa phân công' : 'Chọn nhân viên'} icon="user-round" value={f.ownerId} onChange={set('ownerId')} options={ow.options} disabled={ow.disabled} hint={ow.hint} error={err('ownerId')} /></div>
              : <div style={{ gridColumn: '1 / -1' }}><Select label="Nhân viên kinh doanh phụ trách" placeholder="Chưa chọn" icon="user-round" value={f.owner} onChange={set('owner')} options={withNone(D.OWNERS)} error={err('owner')} /></div>}
            <div style={{ gridColumn: '1 / -1' }}><Input label="Ghi chú nội bộ" multiline rows={3} placeholder="Nhu cầu, lịch sử hợp tác, lưu ý khi làm việc…" value={f.note} onChange={set('note')} hint={f.note.length + '/500 ký tự'} maxLength={500} /></div>
          </Section>
          {showContact ? (
            <Section title="Người liên hệ" icon="contact">
              <div style={{ gridColumn: '1 / -1' }}><Input label="Tên người liên hệ" placeholder="Nguyễn Văn A" value={f.contactName} onChange={set('contactName')} maxLength={CONTACT_NAME_MAX} error={err('contactName')}
                hint={'Mỗi khách hàng một người liên hệ; dùng số điện thoại công ty ở trên.' + (hasContact ? ' Để trống = giữ người liên hệ hiện tại.' : '')} /></div>
            </Section>
          ) : null}
          {isNew && !apiOn ? (
            <Section title="Người liên hệ chính (không bắt buộc)" icon="contact">
              <Input label="Họ và tên" placeholder="Nguyễn Văn A" value={f.cName} onChange={set('cName')} />
              <Input label="Chức vụ" placeholder="Trưởng phòng Mua hàng" value={f.cTitle} onChange={set('cTitle')} />
              <Input label="Điện thoại" placeholder="0903 123 456" value={f.cPhone} onChange={set('cPhone')} error={err('cPhone')} />
              <Input label="Email" placeholder="ten@congty.vn" value={f.cEmail} onChange={set('cEmail')} error={err('cEmail')} />
            </Section>
          ) : null}
        </div>
        <footer style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 24px', borderTop: '1px solid var(--border-subtle)', background: 'var(--surface-sunken)', flexWrap: 'wrap' }}>
          {tried && Object.keys(errs).length ? <span style={{ flex: 1, display: 'inline-flex', alignItems: 'center', gap: 6, font: 'var(--type-sm)', color: 'var(--error-text)' }}><Icon name="circle-alert" size={14} />{Object.keys(errs).length} trường cần sửa</span> : <span style={{ flex: 1 }} />}
          <Button variant="secondary" disabled={saving} onClick={close}>Huỷ</Button>
          <Button icon="check" loading={saving} disabled={denied} onClick={save}>{isNew ? 'Thêm khách hàng' : 'Lưu thay đổi'}</Button>
        </footer>
      </aside>
    </div>
  );
}
