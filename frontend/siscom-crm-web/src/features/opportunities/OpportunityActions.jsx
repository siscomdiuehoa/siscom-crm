import React from 'react';
import { Button, Input, Modal, Select } from '../../ds/index.js';
import { ApiErrorBox } from '../customers/ApiListStatus.jsx';
import { useCustomerApiState } from '../customers/useCustomerApi.js';
import { opportunityActions, ACTION_LABEL, ACTION_ICON, ACTION_TITLE, ACTION_DONE, ACTION_CANDIDATES, WON_DOC_TYPES, initAction, actionBaseKey, rebaseAction, moneyVN, unplacedErrors } from './opportunitiesModel.js';
import { EditOpportunityDialog } from './OpportunityEdit.jsx';
import { AmountInput } from './AmountInput.jsx';

// Sales S10b: nút thao tác trên một cơ hội + hộp thoại (§8.3 "Các hộp thoại khác"). Nút chỉ là tiện ích giao diện theo quyền máy chủ cấp
// (me.permissions, fail-closed); máy chủ luôn kiểm lại quyền, phiên bản và mọi quy tắc. Sửa trường (PATCH, S10c) dùng hộp thoại riêng ở OpportunityEdit.jsx.
export const scopeOfUi = (ui) => (p) => (ui && ui.me && ui.me.permissions ? ui.me.permissions[p] || null : null);
const meIdOf = (ui) => (ui && ui.me ? ui.me.employeeId : null);
const personLabel = (x) => x.fullName + ' (' + x.code + ')' + (x.departmentCode ? ' · ' + x.departmentCode : '');
const PROBABILITY_OPTIONS = [{ value: 'KEEP', label: 'Giữ xác suất đang nhập tay' }, { value: 'RESET', label: 'Về xác suất mặc định của giai đoạn mới' }];
const INTRO = {
  hold: 'Cơ hội tạm hoãn không tính vào Thua. Hệ thống tự tạo công việc nhắc liên hệ lại vào ngày đã chọn.',
  holdEdit: 'Đổi ngày liên hệ lại hoặc lý do; công việc nhắc được cập nhật theo.',
  resume: 'Cơ hội trở lại Đang mở ở đúng giai đoạn cũ; công việc nhắc đang mở sẽ được đóng.',
  win: 'Cần đủ chứng từ và giá trị chốt. Hệ thống tự tạo công việc "Bàn giao thực hiện" cho người nhận.',
  assign: 'Người phụ trách khách hàng không đổi. Chỉ hiện những người đủ điều kiện nhận.',
  reopen: 'Cơ hội trở lại Đang mở ở giai đoạn trước khi đóng.',
  delete: 'Cơ hội được xoá mềm; Quản trị CRM có thể khôi phục.',
};

export function ActionDialog({ kind, o, ui, onClose, onDone, onStale, preset = null }) {
  const opps = ui.customerApi.opportunities;
  const s = useCustomerApiState(opps);
  const meta = s.meta.data;
  const [f, setF] = React.useState(() => ({ ...initAction(kind, o), ...(preset || {}) })); // preset: giá trị chọn sẵn (kanban thả thẻ vào cột => stageId)
  const [errs, setErrs] = React.useState({});
  const [error, setError] = React.useState(null);
  // T-10: 409 => nơi gọi đọc lại `o` (version mới, cờ nhập tay có thể khác) nhưng hộp KHÔNG tạo lại (giữ hộp báo lỗi) => đặt lại lựa chọn xác suất.
  const baseKey = actionBaseKey(o);
  const lastBase = React.useRef(baseKey);
  React.useEffect(() => {
    if (lastBase.current === baseKey) return;
    lastBase.current = baseKey;
    setF((x) => rebaseAction(kind, o, x));
    setErrs((x) => { if (!x.probability) return x; const n = { ...x }; delete n.probability; return n; });
  }, [baseKey, kind, o]);
  const wantsPeople = !!ACTION_CANDIDATES[kind];
  const [people, setPeople] = React.useState({ status: wantsPeople ? 'loading' : 'none', items: [], error: null });
  const needsMeta = kind === 'stage' || kind === 'lose';
  React.useEffect(() => { if (needsMeta) opps.loadMeta(); }, [opps, needsMeta]);
  React.useEffect(() => {
    if (!wantsPeople) return undefined;
    let live = true;
    opps.candidates(kind, o.id).then((r) => { if (live) setPeople(r.ok ? { status: 'ready', items: r.items, error: null } : { status: 'error', items: [], error: r.error }); });
    return () => { live = false; };
  }, [opps, kind, o.id, wantsPeople]);
  const busy = !!s.busy;
  const set = (k) => (v) => {
    const val = v && v.target ? v.target.value : v;
    setF((x) => ({ ...x, [k]: val }));
    setErrs((x) => { if (!x[k]) return x; const n = { ...x }; delete n[k]; return n; });
  };
  const submit = async () => {
    const r = await opps.act(kind, o, f);
    if (r.duplicate) return;
    if (r.ok) { ui.toast({ tone: 'success', title: ACTION_DONE[kind], message: o.code }); onDone(r.data, kind); return; }
    setErrs(r.fieldErrors || {}); setError(r.invalid ? null : r.error);
    if (r.stale && onStale) onStale();
  };
  const text = (k, label, opt = {}) => <Input label={label} required={opt.required} multiline={opt.multiline} rows={opt.rows || 3} type={opt.type} placeholder={opt.placeholder} hint={opt.hint} suffix={opt.suffix} value={f[k]} onChange={set(k)} error={errs[k]} disabled={busy} />;
  const choose = (k, label, options, opt = {}) => <Select label={label} required={opt.required !== false} placeholder={opt.placeholder} options={options} value={f[k]} onChange={set(k)} error={errs[k]} disabled={busy || opt.disabled} />;
  const peopleField = (k, label) => (people.status === 'error' ? <ApiErrorBox error={people.error} />
    : people.status === 'loading' ? <div role="status" style={{ color: 'var(--text-2)', font: 'var(--type-sm)' }}>Đang tải danh sách người nhận…</div>
    : people.items.length ? choose(k, label, people.items.map((x) => ({ value: x.id, label: personLabel(x) })), { placeholder: 'Chọn người nhận…' })
    : <div role="status" style={{ color: 'var(--warning-text)', font: 'var(--type-sm)' }}>Không có người nào đủ điều kiện nhận.</div>);
  const metaField = (render) => (s.meta.status === 'error' ? <ApiErrorBox error={s.meta.error} onRetry={() => opps.loadMeta(true)} />
    : !meta ? <div role="status" style={{ color: 'var(--text-2)', font: 'var(--type-sm)' }}>Đang tải danh mục…</div> : render());

  let body = null;
  if (kind === 'stage') body = metaField(() => <>
    {choose('stageId', 'Giai đoạn mới', (meta.stages || []).filter((x) => !o.stage || x.id !== o.stage.id).map((x) => ({ value: x.id, label: x.label + ' · mặc định ' + x.defaultProbability + '%' })), { placeholder: 'Chọn giai đoạn…' })}
    {o.probabilityOverridden ? choose('probability', 'Xác suất đang được nhập tay', PROBABILITY_OPTIONS) : null}
    <p style={{ margin: 0, font: 'var(--type-caption)', color: 'var(--text-3)' }}>Rời Tiếp cận cần có nhu cầu của khách; từ Báo giá trở đi cần có giá trị dự kiến.</p>
  </>);
  else if (kind === 'hold' || kind === 'holdEdit') body = <>{text('holdUntil', 'Ngày liên hệ lại', { required: true, type: 'date' })}{text('holdReason', 'Lý do tạm hoãn', { required: true, multiline: true })}</>;
  else if (kind === 'resume') body = text('reason', 'Lý do (tuỳ chọn)', { multiline: true });
  else if (kind === 'win') body = <>
    <AmountInput label="Giá trị chốt (VNĐ, chưa VAT)" required suffix="đ" hint={o.expectedAmountVnd ? 'Giá trị dự kiến: ' + moneyVN(o.expectedAmountVnd) : undefined} value={f.wonAmount} onChange={set('wonAmount')} error={errs.wonAmount} disabled={busy} />
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
      {choose('wonDocType', 'Loại chứng từ', WON_DOC_TYPES)}
      {text('wonDocNo', 'Số chứng từ', { required: true })}
      {text('wonDocDate', 'Ngày chứng từ', { required: true, type: 'date' })}
    </div>
    {text('wonDocUrl', 'Đường dẫn chứng từ (https)', { required: true, placeholder: 'https://…' })}
    {text('wonDocFileName', 'Tên tệp chứng từ (tuỳ chọn)')}
    {peopleField('handoverToId', 'Người nhận "Bàn giao thực hiện"')}
    {text('handoverDueDate', 'Hạn bàn giao (tuỳ chọn, mặc định 7 ngày)', { type: 'date' })}
  </>;
  else if (kind === 'lose') body = metaField(() => <>
    {choose('lostReasonId', 'Lý do thua', (meta.lostReasons || []).map((x) => ({ value: x.id, label: x.label })), { placeholder: 'Chọn lý do…' })}
    {text('lostNote', 'Ghi chú', { multiline: true, required: (meta.lostReasons || []).some((x) => x.id === f.lostReasonId && x.requiresNote) })}
  </>);
  else if (kind === 'assign') body = <>{peopleField('ownerId', 'Người phụ trách mới')}{text('reason', 'Lý do chuyển', { required: true, multiline: true })}</>;
  else if (kind === 'reopen' || kind === 'delete') body = text('reason', kind === 'delete' ? 'Lý do xoá' : 'Lý do mở lại', { required: true, multiline: true });

  // Máy chủ từ chối (400) vì ô không có trong hộp / lỗi không gắn ô => hiện đúng câu lý do thay cho câu chung "Sửa các trường được đánh dấu".
  const shownError = (e) => {
    if (e.kind === 'conflict') return { ...e, hint: 'Dữ liệu đã được tải lại. Kiểm tra rồi thao tác lại nếu vẫn cần.' };
    if (e.kind !== 'bad_request') return e;
    const u = unplacedErrors(kind, errs, e.extra);
    if (!u.messages.length) return e;
    return { ...e, hint: u.editable ? 'Cần bổ sung trước khi thao tác lại — các mục này sửa bằng nút Sửa trên cơ hội:' : 'Lý do máy chủ từ chối:', extra: u.messages };
  };
  const danger = kind === 'delete' || kind === 'lose';
  return (
    <Modal open onClose={busy ? undefined : onClose} size={kind === 'win' ? 'lg' : 'md'} icon={ACTION_ICON[kind]} tone={danger ? 'error' : kind === 'win' ? 'success' : 'blue'} title={ACTION_TITLE[kind]} description={o.code + ' · ' + o.title}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Huỷ</Button><Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={submit}>{ACTION_LABEL[kind]}</Button></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {INTRO[kind] ? <p style={{ margin: 0, font: 'var(--type-sm)', color: 'var(--text-2)' }}>{INTRO[kind]}</p> : null}
        {error ? <ApiErrorBox error={shownError(error)} /> : null}
        {body}
      </div>
    </Modal>
  );
}

// Dãy nút thao tác theo quyền. onChanged(data, kind): nơi gọi đọc lại chi tiết / chuyển trang. onStale: máy chủ báo 409 => nơi gọi đọc lại.
export function OpportunityActions({ ui, o, onChanged, onStale }) {
  const [dlg, setDlg] = React.useState(null);
  const acts = opportunityActions(o, { scopeOf: scopeOfUi(ui), meId: meIdOf(ui) });
  if (!acts.length) return null;
  return (
    <>
      <div role="group" aria-label="Thao tác trên cơ hội" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {acts.map((k) => <Button key={k} size="sm" variant={k === 'win' ? 'primary' : k === 'delete' ? 'danger' : 'secondary'} icon={ACTION_ICON[k]} onClick={() => setDlg(k)}>{ACTION_LABEL[k]}</Button>)}
      </div>
      {dlg === 'edit' ? <EditOpportunityDialog o={o} ui={ui} onClose={() => setDlg(null)} onStale={onStale} onDone={(data, kind, unchanged) => { setDlg(null); if (onChanged && !unchanged) onChanged(data, kind); }} />
        : dlg ? <ActionDialog key={dlg} kind={dlg} o={o} ui={ui} onClose={() => setDlg(null)} onStale={onStale} onDone={(data, kind) => { setDlg(null); if (onChanged) onChanged(data, kind); }} /> : null}
    </>
  );
}

// S11: mở hộp "Chuyển giai đoạn" cho một dòng của danh sách / thẻ kanban (stageId = giai đoạn chọn sẵn khi thả thẻ vào cột).
// Dòng danh sách không có cờ "xác suất đang nhập tay" và có thể đã cũ => đọc chi tiết từ máy chủ trước khi mở hộp. Người dùng luôn xác nhận trong hộp thoại.
export function useStageMove(ui, onDone) {
  const opps = ui.customerApi.opportunities;
  const [st, setSt] = React.useState(null); // { o, stageId, detail }
  const start = async (o, stageId) => {
    setSt({ o, stageId: stageId || '', detail: null });
    const r = await opps.get(o.id);
    if (!r.ok) { setSt(null); ui.toast({ tone: 'error', title: r.error.title || 'Không mở được cơ hội', message: r.error.message || o.code }); return; }
    setSt((x) => (x && x.o.id === o.id ? { ...x, detail: r.data } : x));
  };
  const close = () => setSt(null);
  const element = st && st.detail ? (
    <ActionDialog key={st.detail.id + ':' + st.stageId + ':' + st.detail.version} kind="stage" o={st.detail} ui={ui} preset={st.stageId ? { stageId: st.stageId } : null}
      onClose={close} onStale={() => start(st.o, st.stageId)} onDone={(data) => { close(); if (onDone) onDone(data); }} />
  ) : null;
  return { start, element, pendingId: st && !st.detail ? st.o.id : null };
}
