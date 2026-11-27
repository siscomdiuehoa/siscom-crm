import React from 'react';
import { Badge, Button, Checkbox, EmptyState, IconButton, Input, Select, Tabs } from '../../ds/index.js';
import { ApiErrorBox } from '../customers/ApiListStatus.jsx';
import {
  MAX_TEMPLATE_COLUMNS, TEMPLATE_VAT_MODES, TEMPLATE_VAT_RATES, moveItem, myDefaultsForm, previewHeaders, quotesSubnav, templateForm,
} from './quotesModel.js';

// Báo giá Q8b: "Loại báo giá" (#/quotes/templates — người có quote.template) và "Mặc định của tôi" (#/quotes/my-defaults — người có quote.create).
// Mục 4.1, 9, 10, 23. Dữ liệu CHỈ từ máy chủ; máy chủ kiểm lại mọi thứ. Loại báo giá không chứa giá; sửa loại KHÔNG đổi báo giá đã lập
// (mỗi phiên bản giữ bản chép — mục 4.3). Không lưu gì vào bộ nhớ trình duyệt.
const card = (ui) => ({ padding: ui.mobile ? 14 : 20, display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 });
const note = { font: 'var(--type-caption)', color: 'var(--text-3)' };
const errText = { font: 'var(--type-caption)', color: 'var(--error-text)' };

// Thanh trang con của mục "Báo giá": chỉ hiện khi người dùng có thêm ít nhất một trang ngoài danh sách.
export function QuotesSubnav({ ui, current }) {
  const tabs = quotesSubnav(ui.can);
  if (!tabs.length) return null;
  return <Tabs variant="line" items={tabs} value={current} onChange={(id) => { const t = tabs.find((x) => x.id === id); if (t && id !== current) ui.navigate(t.path); }} />;
}

function NoAccess({ ui, title, description }) {
  return <div className="sg-card sg-solid"><EmptyState icon="lock" title={title} description={description} action={<Button onClick={() => ui.navigate('/quotes')}>Về danh sách báo giá</Button>} /></div>;
}

const summary = (t) => {
  const n = Array.isArray(t.columns) ? t.columns.length : 0;
  return (n ? n + ' cột riêng' : 'Không có cột riêng') + ' · VAT ' + t.defaultVat + ' % ' + (t.vatMode === 'LINE' ? 'theo từng dòng' : 'cho cả báo giá') + ' · Hiệu lực ' + t.defaultValidDays + ' ngày';
};

// ───── Biểu mẫu thêm / sửa một loại báo giá ─────
function TemplateForm({ ui, t, onDone, onReload }) {
  const ctl = ui.customerApi.quotes;
  const [f, setF] = React.useState(() => templateForm(t));
  const [errors, setErrors] = React.useState({});
  const [error, setError] = React.useState(null);
  const [stale, setStale] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const setText = (k) => (e) => set(k)(e.target.value);
  const setCols = (fn) => setF((x) => ({ ...x, columns: fn(x.columns) }));
  const setCol = (i, k) => (e) => { const v = e.target.value; setCols((cs) => cs.map((c, j) => (j === i ? { ...c, [k]: v } : c))); };
  const full = f.columns.length >= MAX_TEMPLATE_COLUMNS;
  const save = async () => {
    if (saving) return;
    setSaving(true); setError(null); setStale(false);
    const r = await ctl.saveTemplate(t, f);
    setSaving(false);
    if (r.ok) { ui.toast({ tone: 'success', title: t ? 'Đã lưu loại báo giá' : 'Đã thêm loại báo giá', message: f.name.trim() }); onDone(); return; }
    if (r.duplicate) return;
    setErrors(r.fieldErrors || {});
    if (!r.invalid) { setError(r.error); setStale(!!r.stale); }
  };
  const heads = previewHeaders(f);
  return (
    <section className="sg-card sg-solid" style={card(ui)}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, font: 'var(--type-h3)', flex: 1, minWidth: 0 }}>{t ? 'Sửa loại báo giá' : 'Thêm loại báo giá'}</h2>
        <Button variant="ghost" size="sm" icon="x" disabled={saving} onClick={onDone}>Đóng</Button>
      </div>
      <div role="note" style={note}>Sửa loại chỉ áp dụng cho báo giá lập sau này. Báo giá đã lập giữ nguyên nội dung và các cột của nó.</div>
      {t
        ? <div style={{ font: 'var(--type-sm)', color: 'var(--text-2)' }}>Mã: <span style={{ font: 'var(--type-mono)', fontWeight: 600 }}>{t.code}</span> (đặt một lần, không đổi được)</div>
        : <Input label="Mã loại" required maxLength={30} placeholder="ví dụ: ong-gio" hint="Chữ thường không dấu, số, gạch nối. Đặt một lần, sau này không đổi được." value={f.code} onChange={setText('code')} error={errors.code} disabled={saving} />}
      <Input label="Tên loại báo giá" required maxLength={120} placeholder="ví dụ: Ống gió vải" value={f.name} onChange={setText('name')} error={errors.name} disabled={saving} />
      <Input label="Dòng tiêu đề in" required maxLength={200} placeholder="ví dụ: BẢNG BÁO GIÁ ỐNG GIÓ VẢI" value={f.title} onChange={setText('title')} error={errors.title} disabled={saving} />
      <Input label="Câu chào" multiline rows={2} maxLength={300} value={f.intro} onChange={setText('intro')} error={errors.intro} disabled={saving} />
      <Input label="Điều khoản mặc định" multiline rows={5} maxLength={4000} hint="Được chép vào báo giá mới; người soạn vẫn sửa được trên từng báo giá." value={f.defaultTerms} onChange={setText('defaultTerms')} error={errors.defaultTerms} disabled={saving} />
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 150px', minWidth: 0 }}><Input label="Số ngày hiệu lực" required inputMode="numeric" maxLength={3} suffix="ngày" value={f.defaultValidDays} onChange={setText('defaultValidDays')} error={errors.defaultValidDays} disabled={saving} /></div>
        <div style={{ flex: '1 1 150px', minWidth: 0 }}><Select label="VAT mặc định" ariaLabel="VAT mặc định" value={f.defaultVat} onChange={set('defaultVat')} options={TEMPLATE_VAT_RATES} error={errors.defaultVat} disabled={saving} /></div>
        <div style={{ flex: '1 1 220px', minWidth: 0 }}><Select label="Cách tính VAT" ariaLabel="Cách tính VAT" value={f.vatMode} onChange={set('vatMode')} options={TEMPLATE_VAT_MODES} error={errors.vatMode} disabled={saving} /></div>
      </div>
      <Checkbox label="Đang dùng (hiện trong danh sách chọn khi lập báo giá mới)" checked={f.isActive} onChange={set('isActive')} disabled={saving} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0, font: 'var(--type-h4)', flex: 1, minWidth: 0 }}>{'Cột riêng (' + f.columns.length + ' / ' + MAX_TEMPLATE_COLUMNS + ')'}</h3>
          <Button size="sm" variant="secondary" icon="plus" disabled={saving || full} onClick={() => setCols((cs) => cs.concat([{ key: '', label: '', unit: '' }]))}>Thêm cột</Button>
        </div>
        <div style={note}>Cột riêng nằm giữa "Nội dung công việc" và "ĐVT", chỉ chứa chữ để hiển thị, không tham gia tính tiền.</div>
        {errors.columns ? <div role="alert" style={errText}>{errors.columns}</div> : null}
        {f.columns.length ? (
          <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {f.columns.map((c, i) => {
              const n = i + 1; const eLabel = errors['columns[' + i + '].label'] || errors['columns[' + i + '].key']; const eUnit = errors['columns[' + i + '].unit'];
              return (
                <li key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <span style={{ flex: '0 0 22px', paddingTop: 9, color: 'var(--text-3)', font: 'var(--type-sm)', textAlign: 'right' }}>{n + '.'}</span>
                  <div style={{ flex: '2 1 180px', minWidth: 0 }}><Input size="sm" aria-label={'Tên cột ' + n} placeholder="Tên cột (ví dụ: Đường kính)" maxLength={40} value={c.label} onChange={setCol(i, 'label')} error={eLabel} disabled={saving} /></div>
                  <div style={{ flex: '1 1 100px', minWidth: 0 }}><Input size="sm" aria-label={'Đơn vị cột ' + n} placeholder="Đơn vị (mm, m…)" maxLength={20} value={c.unit} onChange={setCol(i, 'unit')} error={eUnit} disabled={saving} /></div>
                  <div style={{ display: 'flex', gap: 2 }}>
                    <IconButton icon="arrow-up" size="sm" label={'Đưa cột ' + n + ' lên'} disabled={saving || i === 0} onClick={() => setCols((cs) => moveItem(cs, i, -1))} />
                    <IconButton icon="arrow-down" size="sm" label={'Đưa cột ' + n + ' xuống'} disabled={saving || i === f.columns.length - 1} onClick={() => setCols((cs) => moveItem(cs, i, 1))} />
                    <IconButton icon="trash-2" size="sm" label={'Xoá cột ' + n} disabled={saving} onClick={() => setCols((cs) => cs.filter((_, j) => j !== i))} />
                  </div>
                </li>
              );
            })}
          </ol>
        ) : <div style={{ color: 'var(--text-3)', font: 'var(--type-sm)' }}>Chưa có cột riêng — bảng hàng chỉ gồm các cột chung.</div>}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h3 style={{ margin: 0, font: 'var(--type-h4)' }}>Xem trước bố cục bảng hàng</h3>
        <div style={{ overflowX: 'auto' }}>
          <table data-preview="true" style={{ borderCollapse: 'collapse', font: 'var(--type-caption)', minWidth: '100%' }}>
            <thead><tr>{heads.map((h, i) => <th key={i} scope="col" style={{ border: '1px solid var(--border-subtle)', padding: '6px 8px', whiteSpace: 'nowrap', fontWeight: 600 }}>{h}</th>)}</tr></thead>
            <tbody><tr>{heads.map((h, i) => <td key={i} style={{ border: '1px solid var(--border-subtle)', padding: '6px 8px', color: 'var(--text-3)', textAlign: 'center' }}>…</td>)}</tr></tbody>
          </table>
        </div>
        {f.columns.length > 3 ? <div style={note}>Loại có hơn 3 cột riêng sẽ in khổ A4 ngang.</div> : null}
      </div>

      {error ? <ApiErrorBox error={error} /> : null}
      {stale ? (
        <div role="alert" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', font: 'var(--type-sm)' }}>
          <span style={{ flex: 1, minWidth: 0 }}>Loại báo giá này có người khác vừa sửa. Nội dung anh/chị đang gõ chưa được lưu; hãy tải lại để xem bản mới nhất rồi sửa lại.</span>
          <Button size="sm" variant="secondary" icon="refresh-cw" onClick={onReload}>Tải lại danh sách</Button>
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Button icon="save" loading={saving} onClick={save}>Lưu loại báo giá</Button>
        <Button variant="ghost" disabled={saving} onClick={onDone}>Huỷ</Button>
      </div>
    </section>
  );
}

// ───── Trang "Loại báo giá" ─────
export function QuoteTemplatesPage({ ui }) {
  const ctl = ui.customerApi.quotes;
  const [l, setL] = React.useState({ status: 'loading', items: [], error: null });
  const [edit, setEdit] = React.useState(null); // null = danh sách; { t } = đang sửa (t null = thêm mới)
  const [rowError, setRowError] = React.useState(null);
  const [busyId, setBusyId] = React.useState(null);
  const seq = React.useRef(0);
  const load = React.useCallback(() => {
    const my = ++seq.current;
    setL((x) => ({ ...x, status: 'loading', error: null }));
    ctl.templatesAll().then((r) => { if (my === seq.current) setL(r.ok ? { status: 'ready', items: r.data.items || [], error: null } : { status: 'error', items: [], error: r.error }); });
  }, [ctl]);
  React.useEffect(() => { load(); }, [load]);
  const back = () => { setEdit(null); setRowError(null); load(); };
  const toggle = async (t) => {
    if (busyId) return;
    setBusyId(t.id); setRowError(null);
    const r = await ctl.setTemplateActive(t, !t.isActive);
    setBusyId(null);
    if (r.ok) { ui.toast({ tone: 'success', title: t.isActive ? 'Đã ngừng dùng loại báo giá' : 'Đã dùng lại loại báo giá', message: t.name }); load(); } else if (!r.duplicate) setRowError(r.error);
  };
  if (edit) return <TemplateForm ui={ui} t={edit.t} onDone={back} onReload={back} />;
  return (
    <section className="sg-card sg-solid" style={card(ui)}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, font: 'var(--type-h3)', flex: 1, minWidth: 0 }}>Loại báo giá</h2>
        <Button size="sm" icon="plus" disabled={l.status !== 'ready'} onClick={() => { setRowError(null); setEdit({ t: null }); }}>Thêm loại báo giá</Button>
      </div>
      <div role="note" style={note}>Mỗi loại quyết định tiêu đề in, điều khoản mặc định, VAT và các cột riêng của bảng hàng. Loại ngừng dùng không còn hiện khi lập báo giá mới; báo giá đã lập không bị ảnh hưởng.</div>
      {l.status === 'loading' ? <div role="status" style={{ color: 'var(--text-2)', padding: '12px 0' }}>Đang tải loại báo giá…</div> : null}
      {l.status === 'error' ? <ApiErrorBox error={l.error} onRetry={load} /> : null}
      {rowError ? <ApiErrorBox error={rowError} /> : null}
      {l.status === 'ready' && !l.items.length ? <EmptyState compact icon="file-text" title="Chưa có loại báo giá nào" description="Thêm loại đầu tiên để nhân viên lập được báo giá." /> : null}
      {l.status === 'ready' && l.items.length ? (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
          {l.items.map((t) => (
            <li key={t.id} style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: '12px 0', borderTop: '1px solid var(--border-subtle)', minWidth: 0 }}>
              <div style={{ flex: '1 1 260px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{t.name}</span>
                  <span style={{ font: 'var(--type-mono)', color: 'var(--text-3)' }}>{t.code}</span>
                  <Badge size="sm" dot tone={t.isActive ? 'success' : 'neutral'}>{t.isActive ? 'Đang dùng' : 'Ngừng dùng'}</Badge>
                </div>
                <div style={{ font: 'var(--type-sm)', color: 'var(--text-2)', overflowWrap: 'anywhere' }}>{summary(t)}</div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Button size="sm" variant="secondary" icon="pencil" aria-label={'Sửa loại ' + t.name} disabled={!!busyId} onClick={() => { setRowError(null); setEdit({ t }); }}>Sửa</Button>
                <Button size="sm" variant="ghost" icon={t.isActive ? 'pause' : 'play'} aria-label={(t.isActive ? 'Ngừng dùng loại ' : 'Dùng lại loại ') + t.name} loading={busyId === t.id} disabled={!!busyId && busyId !== t.id} onClick={() => toggle(t)}>{t.isActive ? 'Ngừng dùng' : 'Dùng lại'}</Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

// ───── Trang "Mặc định của tôi" ─────
export function MyQuoteDefaultsPage({ ui }) {
  const ctl = ui.customerApi.quotes;
  const [st, setSt] = React.useState({ status: 'loading', saved: false, error: null });
  const [f, setF] = React.useState(() => myDefaultsForm(null));
  const [errors, setErrors] = React.useState({});
  const [error, setError] = React.useState(null);
  const [saving, setSaving] = React.useState(false);
  const seq = React.useRef(0);
  const load = React.useCallback(() => {
    const my = ++seq.current;
    setSt({ status: 'loading', saved: false, error: null });
    ctl.myDefaults().then((r) => {
      if (my !== seq.current) return;
      if (r.ok) { setF(myDefaultsForm(r.data)); setSt({ status: 'ready', saved: !!r.data.saved, error: null }); } else setSt({ status: 'error', saved: false, error: r.error });
    });
  }, [ctl]);
  React.useEffect(() => { load(); return () => { seq.current++; }; }, [load]);
  const setText = (k) => (e) => { const v = e.target.value; setF((x) => ({ ...x, [k]: v })); };
  const save = async () => {
    if (saving) return;
    setSaving(true); setError(null);
    const r = await ctl.saveMyDefaults(f);
    setSaving(false);
    if (r.ok) { setErrors({}); setF(myDefaultsForm(r.data)); setSt({ status: 'ready', saved: true, error: null }); ui.toast({ tone: 'success', title: 'Đã lưu mặc định của tôi' }); return; }
    if (r.duplicate) return;
    setErrors(r.fieldErrors || {});
    if (!r.invalid) setError(r.error);
  };
  return (
    <section className="sg-card sg-solid" style={{ ...card(ui), maxWidth: 720 }}>
      <h2 style={{ margin: 0, font: 'var(--type-h3)' }}>Mặc định của tôi</h2>
      <div role="note" style={note}>Các thông tin này được điền sẵn vào khối "Báo giá bởi" và "Thông tin tài khoản" khi anh/chị lập báo giá mới, và vẫn sửa được trên từng báo giá. Báo giá đã lập không thay đổi. Chỉ mình anh/chị xem và sửa được.</div>
      {st.status === 'loading' ? <div role="status" style={{ color: 'var(--text-2)', padding: '12px 0' }}>Đang tải…</div> : null}
      {st.status === 'error' ? <ApiErrorBox error={st.error} onRetry={load} /> : null}
      {st.status === 'ready' ? (
        <>
          {!st.saved ? <div role="status" style={{ font: 'var(--type-sm)', color: 'var(--text-2)' }}>Anh/chị chưa lưu mặc định nào.</div> : null}
          <Input label="Chức vụ" maxLength={120} placeholder="ví dụ: Kỹ sư bán hàng" value={f.quoterTitle} onChange={setText('quoterTitle')} error={errors.quoterTitle} disabled={saving} />
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ flex: '1 1 200px', minWidth: 0 }}><Input label="Điện thoại" type="tel" maxLength={30} value={f.quoterPhone} onChange={setText('quoterPhone')} error={errors.quoterPhone} disabled={saving} /></div>
            <div style={{ flex: '1 1 240px', minWidth: 0 }}><Input label="Email" maxLength={254} inputMode="email" value={f.quoterEmail} onChange={setText('quoterEmail')} error={errors.quoterEmail} disabled={saving} /></div>
          </div>
          <Input label="Thông tin tài khoản" multiline rows={4} maxLength={2000} hint="Số tài khoản, ngân hàng, chủ tài khoản — in ở cuối báo giá." value={f.paymentInfo} onChange={setText('paymentInfo')} error={errors.paymentInfo} disabled={saving} />
          {error ? <ApiErrorBox error={error} /> : null}
          <div><Button icon="save" loading={saving} onClick={save}>Lưu mặc định</Button></div>
        </>
      ) : null}
    </section>
  );
}

// Cổng của hai route: không có quyền => trang "không có quyền", KHÔNG gọi máy chủ (ca C4). Có quyền => thanh trang con + trang.
export function QuoteTemplatesRoute({ ui, allowed }) {
  if (!allowed) return <NoAccess ui={ui} title="Không có quyền quản lý loại báo giá" description="Chỉ Quản trị CRM được thêm và sửa loại báo giá." />;
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}><QuotesSubnav ui={ui} current="templates" /><QuoteTemplatesPage ui={ui} /></div>;
}
export function MyQuoteDefaultsRoute({ ui, allowed }) {
  if (!allowed) return <NoAccess ui={ui} title="Không có quyền dùng mặc định báo giá" description="Tài khoản của bạn không được lập báo giá nên không có mặc định cá nhân." />;
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}><QuotesSubnav ui={ui} current="my-defaults" /><MyQuoteDefaultsPage ui={ui} /></div>;
}
