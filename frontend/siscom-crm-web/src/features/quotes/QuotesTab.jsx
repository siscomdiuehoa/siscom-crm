import React from 'react';
import { Badge, Button, EmptyState, Input, Modal, Select } from '../../ds/index.js';
import { ApiErrorBox } from '../customers/ApiListStatus.jsx';
import { useCustomerApiState } from '../customers/useCustomerApi.js';
import { fmtVnd, STATE_META } from './quotesModel.js';

// Báo giá Q7: tab "Báo giá" ở chi tiết cơ hội (docs/QUOTES_DESIGN.md mục 10). Mỗi báo giá một khối: mã, loại, hạng mục, nhãn "Đang theo đuổi",
// bảng phiên bản; nút thao tác theo phiên bản MỚI NHẤT. Nút chỉ là tiện ích giao diện theo me.permissions + người phụ trách cơ hội (fail-closed);
// máy chủ luôn kiểm lại. Tiền là chuỗi từ máy chủ, chỉ định dạng (fmtVnd) — không tự tính.
const loadingLine = (t) => <div role="status" aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-2)', padding: '12px 0' }}><span className="sg-btn__spin" />{t}</div>;
const dmy = (s) => (s ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : '—');
const todayYmd = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10); // ngày theo giờ Việt Nam
// Quyền ghi của người gọi trên cơ hội: ALL, hoặc OWN và mình phụ trách cơ hội (như máy chủ). Không có phiên => không.
export function quoteCan(ui, o, code) {
  const s = ui && ui.me && ui.me.permissions ? ui.me.permissions[code] || null : null;
  const me = ui && ui.me ? ui.me.employeeId : null;
  const owner = o ? (o.ownerId || (o.owner ? o.owner.id : null)) : null;
  return s === 'ALL' || (s === 'OWN' && !!me && owner === me);
}

function CreateDialog({ ui, o, onClose }) {
  const ctl = ui.customerApi.quotes; const s = useCustomerApiState(ctl); const busy = !!s.busy;
  const [tpl, setTpl] = React.useState({ status: 'loading', items: [], error: null });
  const [f, setF] = React.useState({ templateId: '', itemName: '' });
  const [errs, setErrs] = React.useState({}); const [error, setError] = React.useState(null);
  React.useEffect(() => { let live = true; ctl.templates().then((r) => { if (live) setTpl(r.ok ? { status: 'ready', items: r.data.items || [], error: null } : { status: 'error', items: [], error: r.error }); }); return () => { live = false; }; }, [ctl]);
  const set = (k) => (v) => { setF((x) => ({ ...x, [k]: v && v.target ? v.target.value : v })); setErrs((x) => ({ ...x, [k]: undefined })); };
  const submit = async () => {
    const r = await ctl.create(o.id, f);
    if (r.duplicate) return;
    if (r.ok) { ui.toast({ tone: 'success', title: 'Đã tạo báo giá', message: r.data.code }); onClose(); ui.navigate('/quotes/' + r.data.id); return; }
    setErrs(r.fieldErrors || {}); setError(r.invalid ? null : r.error);
  };
  return (
    <Modal open onClose={busy ? undefined : onClose} size="md" icon="file-plus" title="Thêm báo giá" description={o.code + ' · ' + o.title}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Huỷ</Button><Button loading={busy} onClick={submit}>Tạo báo giá</Button></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ margin: 0, font: 'var(--type-sm)', color: 'var(--text-2)' }}>Khách hàng, người liên hệ, thông tin của bạn và điều khoản của loại báo giá được điền sẵn; bạn sửa được ở màn hình soạn.</p>
        {error ? <ApiErrorBox error={error} /> : null}
        {tpl.status === 'error' ? <ApiErrorBox error={tpl.error} /> : null}
        <Select label="Loại báo giá" required value={f.templateId} onChange={set('templateId')} error={errs.templateId} disabled={busy || tpl.status !== 'ready'}
          hint={tpl.status === 'loading' ? 'Đang tải…' : undefined} options={[{ value: '', label: '— Chọn loại —' }].concat(tpl.items.map((t) => ({ value: t.id, label: t.name })))} />
        <Input label="Hạng mục" required maxLength={120} placeholder="Ví dụ: Ống gió vải tầng 3" value={f.itemName} onChange={set('itemName')} error={errs.itemName} disabled={busy} hint="Dùng trong tên tệp báo giá." />
      </div>
    </Modal>
  );
}

function SendDialog({ ui, q, v, onClose, onDone }) {
  const ctl = ui.customerApi.quotes; const s = useCustomerApiState(ctl); const busy = !!s.busy;
  const [f, setF] = React.useState({ quoteDate: v.quoteDate || todayYmd(), validUntil: v.validUntil || '' });
  const [errs, setErrs] = React.useState({}); const [error, setError] = React.useState(null);
  const set = (k) => (e) => { setF((x) => ({ ...x, [k]: e.target.value })); setErrs((x) => ({ ...x, [k]: undefined })); };
  const submit = async () => {
    const r = await ctl.send(q, v.versionNo, f);
    if (r.duplicate) return;
    if (r.ok) { ui.toast({ tone: 'success', title: 'Đã đánh dấu đã gửi', message: q.code + ' v' + v.versionNo }); onDone(); return; }
    setErrs(r.fieldErrors || {}); setError(r.invalid ? null : r.error);
  };
  return (
    <Modal open onClose={busy ? undefined : onClose} size="sm" icon="send" title="Đánh dấu đã gửi" description={q.code + ' v' + v.versionNo + ' · ' + q.itemName}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Huỷ</Button><Button loading={busy} onClick={submit}>Đánh dấu đã gửi</Button></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ margin: 0, font: 'var(--type-sm)', color: 'var(--text-2)' }}>Sau khi đánh dấu, phiên bản này bị khoá: không sửa được, tải lại luôn ra đúng nội dung lúc gửi. Cần đổi giá thì tạo bản mới.</p>
        {error ? <ApiErrorBox error={error} /> : null}
        <Input label="Ngày báo giá" required type="date" value={f.quoteDate} onChange={set('quoteDate')} error={errs.quoteDate} disabled={busy} />
        <Input label="Hạn hiệu lực" required type="date" value={f.validUntil} onChange={set('validUntil')} error={errs.validUntil} disabled={busy} />
      </div>
    </Modal>
  );
}

function DecideDialog({ ui, q, v, onClose, onDone }) {
  const ctl = ui.customerApi.quotes; const s = useCustomerApiState(ctl); const busy = !!s.busy;
  const [reason, setReason] = React.useState(''); const [errs, setErrs] = React.useState({}); const [error, setError] = React.useState(null);
  const done = (r, title) => {
    if (r.duplicate) return;
    if (r.ok) {
      const expired = (r.data.warnings || []).includes('EXPIRED');
      ui.toast({ tone: expired ? 'warning' : 'success', title, message: expired ? 'Báo giá đã quá hạn hiệu lực khi được chấp nhận.' : q.code + ' v' + v.versionNo });
      onDone(); return;
    }
    setErrs(r.fieldErrors || {}); setError(r.invalid ? null : r.error);
  };
  return (
    <Modal open onClose={busy ? undefined : onClose} size="sm" icon="flag" title="Ghi kết quả báo giá" description={q.code + ' v' + v.versionNo + ' · ' + q.itemName}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Huỷ</Button><Button variant="danger" loading={busy} onClick={async () => done(await ctl.reject(q, v.versionNo, reason), 'Đã ghi bị từ chối')}>Bị từ chối</Button><Button loading={busy} onClick={async () => done(await ctl.accept(q, v.versionNo), 'Đã ghi được chấp nhận')}>Được chấp nhận</Button></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ margin: 0, font: 'var(--type-sm)', color: 'var(--text-2)' }}>Chỉ báo giá đang theo đuổi mới được chấp nhận; sau đó báo giá này cố định. Được chấp nhận không tự chốt Thắng cơ hội.</p>
        {v.state === 'EXPIRED' ? <div role="note" style={{ font: 'var(--type-sm)', color: 'var(--warning-text)' }}>Báo giá đã hết hiệu lực — vẫn ghi được kết quả.</div> : null}
        {error ? <ApiErrorBox error={error} /> : null}
        <Input label="Lý do từ chối" multiline rows={3} maxLength={500} value={reason} onChange={(e) => { setReason(e.target.value); setErrs({}); }} error={errs.reason} disabled={busy} hint="Chỉ cần khi ghi Bị từ chối." />
      </div>
    </Modal>
  );
}

function ConfirmDialog({ ui, title, description, needReason, okLabel, run, onClose, onDone }) {
  const ctl = ui.customerApi.quotes; const s = useCustomerApiState(ctl); const busy = !!s.busy;
  const [reason, setReason] = React.useState(''); const [errs, setErrs] = React.useState({}); const [error, setError] = React.useState(null);
  const submit = async () => {
    const r = await run(reason);
    if (r.duplicate) return;
    if (r.ok) { onDone(r); return; }
    setErrs(r.fieldErrors || {}); setError(r.invalid ? null : r.error);
  };
  return (
    <Modal open onClose={busy ? undefined : onClose} size="sm" icon="trash-2" tone="error" title={title} description={description}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Huỷ</Button><Button variant="danger" loading={busy} onClick={submit}>{okLabel}</Button></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {error ? <ApiErrorBox error={error} /> : null}
        {needReason ? <Input label="Lý do" required multiline rows={3} maxLength={500} value={reason} onChange={(e) => { setReason(e.target.value); setErrs({}); }} error={errs.reason} disabled={busy} /> : <p style={{ margin: 0, font: 'var(--type-sm)', color: 'var(--text-2)' }}>Bản nháp và các dòng của nó bị xoá hẳn.</p>}
      </div>
    </Modal>
  );
}

function QuoteBlock({ ui, o, q, onDialog, busy }) {
  const vs = q.versions || [];
  const latest = vs[vs.length - 1] || null;
  const accepted = vs.some((v) => v.status === 'ACCEPTED');
  const can = (c) => quoteCan(ui, o, c);
  const actions = [];
  if (latest && latest.status === 'DRAFT') {
    if (can('quote.update')) actions.push(<Button key="edit" size="sm" icon="pencil" onClick={() => ui.navigate('/quotes/' + q.id)}>Soạn</Button>);
    if (can('quote.send')) actions.push(<Button key="send" size="sm" variant="secondary" icon="send" disabled={busy} onClick={() => onDialog({ kind: 'send', q, v: latest })}>Đánh dấu đã gửi</Button>);
    if (can('quote.delete')) actions.push(<Button key="del" size="sm" variant="ghost" icon="trash-2" disabled={busy} onClick={() => onDialog({ kind: vs.length > 1 ? 'delVersion' : 'delQuote', q, v: latest })}>{vs.length > 1 ? 'Xoá bản nháp' : 'Xoá báo giá'}</Button>);
  } else if (latest) {
    if (latest.status === 'SENT' && can('quote.decide')) actions.push(<Button key="decide" size="sm" icon="flag" disabled={busy} onClick={() => onDialog({ kind: 'decide', q, v: latest })}>Ghi kết quả</Button>);
    if (!accepted && can('quote.update')) actions.push(<Button key="nv" size="sm" variant="secondary" icon="copy-plus" disabled={busy} onClick={() => onDialog({ kind: 'newVersion', q })}>Tạo bản mới</Button>);
    if (!q.isPrimary && !accepted && can('quote.send')) actions.push(<Button key="pri" size="sm" variant="ghost" icon="star" disabled={busy} onClick={() => onDialog({ kind: 'primary', q })}>Chọn đang theo đuổi</Button>);
    actions.push(<Button key="open" size="sm" variant="ghost" icon="eye" onClick={() => ui.navigate('/quotes/' + q.id)}>Xem</Button>);
  }
  return (
    <section aria-label={'Báo giá ' + q.code} className="sg-card" style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8, border: '1px solid var(--border-subtle)', borderRadius: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <a href={'#/quotes/' + q.id} onClick={(e) => { e.preventDefault(); ui.navigate('/quotes/' + q.id); }} style={{ font: 'var(--type-mono)', fontWeight: 600 }}>{q.code}</a>
        {q.template ? <Badge size="sm">{q.template.name}</Badge> : null}
        {q.isPrimary ? <Badge size="sm" tone="blue" icon="star">Đang theo đuổi</Badge> : null}
      </div>
      <div style={{ fontWeight: 500, overflowWrap: 'anywhere' }}>{q.itemName}</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', font: 'var(--type-sm)' }}>
          <thead><tr style={{ color: 'var(--text-3)', textAlign: 'left' }}><th style={{ padding: '4px 8px 4px 0' }}>Bản</th><th style={{ padding: 4 }}>Trạng thái</th><th style={{ padding: 4, textAlign: 'right' }}>Trước VAT</th><th style={{ padding: 4 }}>Ngày</th><th style={{ padding: 4 }}>Hạn</th></tr></thead>
          <tbody>
            {vs.map((v) => (
              <tr key={v.versionNo} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <td style={{ padding: '6px 8px 6px 0' }}>{'v' + v.versionNo}</td>
                <td style={{ padding: 4 }}><Badge size="sm" tone={(STATE_META[v.state] || STATE_META.DRAFT).tone}>{(STATE_META[v.state] || { label: v.state }).label}</Badge></td>
                <td style={{ padding: 4, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtVnd(v.subtotalVnd)}</td>
                <td style={{ padding: 4 }}>{dmy(v.quoteDate)}</td>
                <td style={{ padding: 4 }}>{dmy(v.validUntil)}{v.state === 'SENT' && v.daysLeft !== null && v.daysLeft <= 7 ? <span style={{ color: 'var(--warning-text)' }}>{' · còn ' + v.daysLeft + ' ngày'}</span> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {actions.length ? <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{actions}</div> : null}
    </section>
  );
}

export function QuotesTab({ ui, o, onReload }) {
  const ctl = ui.customerApi.quotes;
  const s = useCustomerApiState(ctl);
  const [d, setD] = React.useState({ status: 'loading', items: [], amountSource: null, error: null });
  const [dlg, setDlg] = React.useState(null);
  const seq = React.useRef(0);
  const load = React.useCallback(() => {
    const my = ++seq.current;
    ctl.byOpportunity(o.id).then((r) => { if (my === seq.current) setD(r.ok ? { status: 'ready', items: r.data.items || [], amountSource: r.data.amountSource || null, error: null } : { status: 'error', items: [], amountSource: null, error: r.error }); });
  }, [ctl, o.id]);
  React.useEffect(() => { load(); }, [load, s.tick]);
  const done = () => { setDlg(null); if (typeof onReload === 'function') onReload(); };
  const quick = async (fn, title, q) => {
    const r = await fn();
    if (r.duplicate) return;
    if (r.ok) { ui.toast({ tone: 'success', title, message: q.code }); if (typeof onReload === 'function') onReload(); }
    else ui.toast({ tone: 'error', title: r.error.title, message: r.error.message });
  };
  const onDialog = (x) => {
    if (x.kind === 'newVersion') { quick(() => ctl.newVersion(x.q), 'Đã tạo bản mới', x.q).then(() => ui.navigate('/quotes/' + x.q.id)); return; }
    if (x.kind === 'primary') { quick(() => ctl.setPrimary(x.q), 'Đã chọn báo giá đang theo đuổi', x.q); return; }
    setDlg(x);
  };
  const canCreate = quoteCan(ui, o, 'quote.create') && o.status === 'OPEN';
  const a = d.amountSource;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ flex: 1, minWidth: 0, font: 'var(--type-caption)', color: 'var(--text-3)' }}>
          {a ? (a.matchesOpportunity ? 'Giá trị cơ hội đang theo báo giá ' + a.code + ' v' + a.versionNo + ' (' + fmtVnd(a.subtotalVnd) + ' đ, chưa VAT).' : 'Giá trị cơ hội đã sửa tay, khác báo giá ' + a.code + ' v' + a.versionNo + ' (' + fmtVnd(a.subtotalVnd) + ' đ). Lần gửi kế tiếp sẽ cập nhật lại.') : 'Giá trị cơ hội tự đi theo báo giá đang theo đuổi khi báo giá được gửi.'}
        </span>
        {canCreate ? <Button size="sm" icon="plus" onClick={() => setDlg({ kind: 'create' })}>Thêm báo giá</Button> : null}
      </div>
      {d.status === 'loading' ? loadingLine('Đang tải báo giá…') : null}
      {d.status === 'error' ? <ApiErrorBox error={d.error} onRetry={load} /> : null}
      {d.status === 'ready' && !d.items.length ? <EmptyState compact icon="file-text" title="Chưa có báo giá nào" description={canCreate ? 'Bấm "Thêm báo giá" để lập báo giá ngay trên CRM.' : undefined} /> : null}
      {d.status === 'ready' ? d.items.map((q) => <QuoteBlock key={q.id} ui={ui} o={o} q={q} busy={!!s.busy} onDialog={onDialog} />) : null}
      {dlg && dlg.kind === 'create' ? <CreateDialog ui={ui} o={o} onClose={() => setDlg(null)} /> : null}
      {dlg && dlg.kind === 'send' ? <SendDialog ui={ui} q={dlg.q} v={dlg.v} onClose={() => setDlg(null)} onDone={done} /> : null}
      {dlg && dlg.kind === 'decide' ? <DecideDialog ui={ui} q={dlg.q} v={dlg.v} onClose={() => setDlg(null)} onDone={done} /> : null}
      {dlg && dlg.kind === 'delVersion' ? <ConfirmDialog ui={ui} title="Xoá bản nháp" description={dlg.q.code + ' v' + dlg.v.versionNo} okLabel="Xoá bản nháp" run={() => ctl.deleteVersion(dlg.q, dlg.v.versionNo)} onClose={() => setDlg(null)} onDone={() => { ui.toast({ tone: 'success', title: 'Đã xoá bản nháp', message: dlg.q.code }); done(); }} /> : null}
      {dlg && dlg.kind === 'delQuote' ? <ConfirmDialog ui={ui} title="Xoá báo giá" description={dlg.q.code + ' · ' + dlg.q.itemName} needReason okLabel="Xoá báo giá" run={(reason) => ctl.deleteQuote(dlg.q, reason)} onClose={() => setDlg(null)} onDone={() => { ui.toast({ tone: 'success', title: 'Đã xoá báo giá', message: dlg.q.code }); done(); }} /> : null}
    </div>
  );
}
