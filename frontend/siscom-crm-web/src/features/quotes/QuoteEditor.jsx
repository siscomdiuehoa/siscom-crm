import React from 'react';
import { Button, IconButton, Input, Select } from '../../ds/index.js';
import { ApiErrorBox } from '../customers/ApiListStatus.jsx';
import { useCustomerApiState } from '../customers/useCustomerApi.js';
import { emptyLine, fmtVnd, fromVersion, moveLine, previewMargin, previewTotals, MAX_LINES } from './quotesModel.js';

// Báo giá Q7: màn hình SOẠN bản nháp (docs/QUOTES_DESIGN.md mục 8 điểm 2, mục 10). Hai khối đầu trang; bảng dòng hàng nhập trực tiếp với các cột
// riêng của loại (dòng hàng / dòng tiêu đề nhóm, đổi thứ tự, xoá; VAT chung hoặc theo từng dòng); các dòng tổng TẠM TÍNH bằng BigInt (số chính thức
// là số máy chủ trả về sau khi lưu); câu chào, điều khoản, thông tin tài khoản. Điện thoại: mỗi dòng một thẻ.
// Giá vốn và lãi gộp chỉ hiện khi máy chủ báo costVisible (người tạo phiên bản / Quản trị CRM — mục 7.3).
const VAT_OPTIONS = [{ value: '8', label: 'VAT 8 %' }, { value: '10', label: 'VAT 10 %' }];
const cellStyle = { padding: '4px', verticalAlign: 'top' };
const thStyle = { padding: '6px 4px', textAlign: 'left', font: 'var(--type-caption)', color: 'var(--text-3)', fontWeight: 600, whiteSpace: 'nowrap' };
const errText = (e) => (e ? <div role="alert" style={{ font: 'var(--type-caption)', color: 'var(--error-text)', marginTop: 2 }}>{e}</div> : null);

export function QuoteEditor({ ui, q, v, onSaved, defaultVat = 10 }) {
  const ctl = ui.customerApi.quotes;
  const s = useCustomerApiState(ctl);
  const busy = !!s.busy;
  const [f, setF] = React.useState(() => fromVersion(v, defaultVat));
  const [errs, setErrs] = React.useState({});
  const [error, setError] = React.useState(null);
  const [savedAt, setSavedAt] = React.useState(null);
  // Sau khi lưu, trang đưa vào phiên bản máy chủ vừa trả về => biểu mẫu lấy đúng số / dòng của máy chủ (lần đầu đã dựng ở useState).
  const first = React.useRef(true);
  React.useEffect(() => { if (first.current) { first.current = false; return; } setF(fromVersion(v, defaultVat)); setErrs({}); }, [v]);
  const cols =Array.isArray(v.columns) ? v.columns : [];
  const lineMode = f.vatMode === 'LINE';
  const setHead = (k) => (e) => { const val = e && e.target ? e.target.value : e; setF((x) => ({ ...x, [k]: val })); setErrs((x) => ({ ...x, [k]: undefined })); setSavedAt(null); };
  const setLine = (i, k) => (e) => {
    const val = e && e.target ? e.target.value : e;
    setF((x) => ({ ...x, lines: x.lines.map((l, j) => (j === i ? (k.startsWith('extra.') ? { ...l, extra: { ...l.extra, [k.slice(6)]: val } } : { ...l, [k]: val }) : l)) }));
    setErrs((x) => ({ ...x, ['lines[' + i + '].' + k]: undefined })); setSavedAt(null);
  };
  const add = (kind) => { setF((x) => (x.lines.length >= MAX_LINES ? x : { ...x, lines: x.lines.concat([emptyLine(kind)]) })); setSavedAt(null); };
  const remove = (i) => { setF((x) => ({ ...x, lines: x.lines.filter((_, j) => j !== i) })); setErrs({}); setSavedAt(null); };
  const move = (i, d) => { setF((x) => ({ ...x, lines: moveLine(x.lines, i, d) })); setErrs({}); setSavedAt(null); };
  const t = previewTotals(f.lines, f.vatMode, f.vatPercent);
  const mg = f.costVisible ? previewMargin(f.lines, t.amounts) : null;
  const save = async () => {
    const r = await ctl.save(q, v.versionNo, f);
    if (r.duplicate) return;
    if (r.ok) { setErrs({}); setError(null); setSavedAt(new Date()); ui.toast({ tone: 'success', title: 'Đã lưu nháp', message: q.code + ' v' + v.versionNo }); onSaved(r.data); return; }
    setErrs(r.fieldErrors || {});
    setError(r.invalid ? (Object.keys(r.fieldErrors || {}).some((k) => k.startsWith('lines')) ? { title: 'Còn dòng chưa hợp lệ', message: 'Sửa các ô được đánh dấu rồi lưu lại.' } : null) : r.error);
  };

  const inp = (i, k, label, extra = {}) => (
    <><Input size="sm" aria-label={'Dòng ' + (i + 1) + ': ' + label} value={k.startsWith('extra.') ? f.lines[i].extra[k.slice(6)] || '' : f.lines[i][k] || ''} onChange={setLine(i, k)} disabled={busy} error={undefined} {...extra} />{errText(errs['lines[' + i + '].' + k.replace(/^extra\..*/, 'extra')])}</>
  );
  const vatSel = (i) => <Select size="sm" aria-label={'Dòng ' + (i + 1) + ': VAT'} value={f.lines[i].vatPercent == null ? '' : String(f.lines[i].vatPercent)} onChange={(val) => setLine(i, 'vatPercent')(val === '' ? null : val === '8' ? 8 : 10)} options={[{ value: '', label: '—' }].concat(VAT_OPTIONS)} disabled={busy} />;
  const tools = (i) => (
    <div style={{ display: 'flex', gap: 2 }}>
      <IconButton icon="arrow-up" size="sm" label={'Đưa dòng ' + (i + 1) + ' lên'} disabled={busy || i === 0} onClick={() => move(i, -1)} />
      <IconButton icon="arrow-down" size="sm" label={'Đưa dòng ' + (i + 1) + ' xuống'} disabled={busy || i === f.lines.length - 1} onClick={() => move(i, 1)} />
      <IconButton icon="trash-2" size="sm" label={'Xoá dòng ' + (i + 1)} disabled={busy} onClick={() => remove(i)} />
    </div>
  );
  const amountOf = (i) => (f.lines[i].kind === 'ITEM' ? (t.amounts[i] === null ? '—' : fmtVnd(t.amounts[i])) : '');
  const nItemCols = 6 + cols.length + (lineMode ? 1 : 0) + (f.costVisible ? 1 : 0);

  const table = (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 + cols.length * 110 }}>
        <thead><tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <th style={thStyle}>TT</th><th style={{ ...thStyle, minWidth: 220 }}>Nội dung công việc</th>
          {cols.map((c) => <th key={c.key} style={thStyle}>{c.label + (c.unit ? ' (' + c.unit + ')' : '')}</th>)}
          <th style={thStyle}>ĐVT</th><th style={thStyle}>SL</th><th style={thStyle}>Đơn giá</th>{lineMode ? <th style={thStyle}>VAT</th> : null}
          <th style={{ ...thStyle, textAlign: 'right' }}>Thành tiền</th>{f.costVisible ? <th style={thStyle}>Giá vốn / đv</th> : null}<th style={thStyle}>Ghi chú</th><th style={thStyle} aria-label="Thao tác" />
        </tr></thead>
        <tbody>
          {f.lines.map((l, i) => (l.kind === 'SECTION' ? (
            <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--surface-sunken)' }}>
              <td style={cellStyle} />
              <td style={cellStyle} colSpan={nItemCols - 1}>{inp(i, 'description', 'Nội dung', { placeholder: 'TIÊU ĐỀ NHÓM' })}</td>
              <td style={cellStyle}>{tools(i)}</td>
            </tr>
          ) : (
            <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <td style={{ ...cellStyle, paddingTop: 10, color: 'var(--text-3)' }}>{f.lines.slice(0, i + 1).filter((x) => x.kind === 'ITEM').length}</td>
              <td style={cellStyle}>{inp(i, 'description', 'Nội dung')}</td>
              {cols.map((c) => <td key={c.key} style={cellStyle}>{inp(i, 'extra.' + c.key, c.label)}</td>)}
              <td style={{ ...cellStyle, width: 70 }}>{inp(i, 'unit', 'ĐVT')}</td>
              <td style={{ ...cellStyle, width: 90 }}>{inp(i, 'quantity', 'Số lượng', { inputMode: 'decimal' })}</td>
              <td style={{ ...cellStyle, width: 130 }}>{inp(i, 'unitPriceVnd', 'Đơn giá', { inputMode: 'numeric' })}</td>
              {lineMode ? <td style={{ ...cellStyle, width: 100 }}>{vatSel(i)}{errText(errs['lines[' + i + '].vatPercent'])}</td> : null}
              <td style={{ ...cellStyle, paddingTop: 10, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{amountOf(i)}</td>
              {f.costVisible ? <td style={{ ...cellStyle, width: 130 }}>{inp(i, 'costPriceVnd', 'Giá vốn', { inputMode: 'numeric' })}</td> : null}
              <td style={cellStyle}>{inp(i, 'note', 'Ghi chú')}</td>
              <td style={cellStyle}>{tools(i)}</td>
            </tr>
          )))}
        </tbody>
      </table>
    </div>
  );
  const cards = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {f.lines.map((l, i) => (
        <div key={i} data-line-card="1" className="sg-card sg-solid" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8, background: l.kind === 'SECTION' ? 'var(--surface-sunken)' : undefined }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', font: 'var(--type-caption)', color: 'var(--text-3)' }}><span>{(l.kind === 'SECTION' ? 'Dòng nhóm ' : 'Dòng ') + (i + 1)}</span>{tools(i)}</div>
          {inp(i, 'description', 'Nội dung', l.kind === 'SECTION' ? { placeholder: 'TIÊU ĐỀ NHÓM' } : {})}
          {l.kind === 'ITEM' ? (
            <>
              {cols.map((c) => <div key={c.key}><div style={{ font: 'var(--type-caption)', color: 'var(--text-3)' }}>{c.label}</div>{inp(i, 'extra.' + c.key, c.label)}</div>)}
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 8 }}>
                <div><div style={{ font: 'var(--type-caption)', color: 'var(--text-3)' }}>Số lượng</div>{inp(i, 'quantity', 'Số lượng', { inputMode: 'decimal' })}</div>
                <div><div style={{ font: 'var(--type-caption)', color: 'var(--text-3)' }}>ĐVT</div>{inp(i, 'unit', 'ĐVT')}</div>
                <div><div style={{ font: 'var(--type-caption)', color: 'var(--text-3)' }}>Đơn giá</div>{inp(i, 'unitPriceVnd', 'Đơn giá', { inputMode: 'numeric' })}</div>
                {lineMode ? <div><div style={{ font: 'var(--type-caption)', color: 'var(--text-3)' }}>VAT</div>{vatSel(i)}</div> : null}
                {f.costVisible ? <div><div style={{ font: 'var(--type-caption)', color: 'var(--text-3)' }}>Giá vốn / đv</div>{inp(i, 'costPriceVnd', 'Giá vốn', { inputMode: 'numeric' })}</div> : null}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', font: 'var(--type-sm)' }}><span style={{ color: 'var(--text-3)' }}>Thành tiền</span><b style={{ fontVariantNumeric: 'tabular-nums' }}>{amountOf(i)}</b></div>
            </>
          ) : null}
        </div>
      ))}
    </div>
  );
  const totalRow = (label, val, strong) => <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, font: strong ? 'var(--type-body)' : 'var(--type-sm)', fontWeight: strong ? 700 : 400 }}><span>{label}</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtVnd(val)}</span></div>;
  const usesVat8 = t.base8 !== '0' || (!lineMode && f.vatPercent === 8);
  const usesVat10 = t.base10 !== '0' || (!lineMode && f.vatPercent === 10);
  const grid = { display: 'grid', gridTemplateColumns: ui.mobile ? '1fr' : 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {error ? <ApiErrorBox error={error} /> : null}
      <section className="sg-card sg-solid" style={{ padding: ui.mobile ? 14 : 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h3 style={{ margin: 0, font: 'var(--type-h4, var(--type-body))', fontWeight: 600 }}>Khách hàng</h3>
        <div style={grid}>
          <Input label="Khách hàng / Client" maxLength={200} value={f.clientName} onChange={setHead('clientName')} disabled={busy} />
          <Input label="Công ty / Company" maxLength={200} value={f.clientCompany} onChange={setHead('clientCompany')} disabled={busy} />
          <Input label="Dự án / Project" maxLength={200} value={f.projectName} onChange={setHead('projectName')} disabled={busy} />
          <Input label="Điện thoại khách" maxLength={30} value={f.clientPhone} onChange={setHead('clientPhone')} disabled={busy} />
          <Input label="Email khách" maxLength={254} value={f.clientEmail} onChange={setHead('clientEmail')} disabled={busy} />
          <Input label="Địa chỉ / Address" maxLength={500} value={f.clientAddress} onChange={setHead('clientAddress')} disabled={busy} />
        </div>
        <h3 style={{ margin: '4px 0 0', font: 'var(--type-h4, var(--type-body))', fontWeight: 600 }}>Người báo giá</h3>
        <div style={grid}>
          <Input label="Báo giá bởi" required maxLength={200} value={f.quoterName} onChange={setHead('quoterName')} error={errs.quoterName} disabled={busy} />
          <Input label="Chức vụ" maxLength={120} value={f.quoterTitle} onChange={setHead('quoterTitle')} disabled={busy} />
          <Input label="Điện thoại người báo giá" maxLength={30} value={f.quoterPhone} onChange={setHead('quoterPhone')} disabled={busy} />
          <Input label="Email người báo giá" maxLength={254} value={f.quoterEmail} onChange={setHead('quoterEmail')} disabled={busy} />
          <Input label="Ngày báo giá" type="date" value={f.quoteDate} onChange={setHead('quoteDate')} error={errs.quoteDate} disabled={busy} />
          <Input label="Hiệu lực đến" type="date" value={f.validUntil} onChange={setHead('validUntil')} error={errs.validUntil} disabled={busy} />
        </div>
      </section>

      <section className="sg-card sg-solid" style={{ padding: ui.mobile ? 14 : 20, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <h3 style={{ margin: 0, flex: 1, font: 'var(--type-h4, var(--type-body))', fontWeight: 600 }}>{'Dòng hàng (' + f.lines.length + ' / ' + MAX_LINES + ')'}</h3>
          {!lineMode ? <div style={{ minWidth: 160 }}><Select label="VAT cho cả báo giá" size="sm" value={f.vatPercent == null ? '' : String(f.vatPercent)} onChange={(val) => setHead('vatPercent')(val === '8' ? 8 : val === '10' ? 10 : null)} options={VAT_OPTIONS} error={errs.vatPercent} disabled={busy} /></div> : <span style={{ font: 'var(--type-caption)', color: 'var(--text-3)' }}>Loại này tính VAT theo từng dòng.</span>}
        </div>
        {cols.length ? <div style={{ font: 'var(--type-caption)', color: 'var(--text-3)' }}>{'Cột riêng của loại báo giá này: ' + cols.map((c) => c.label + (c.unit ? ' (' + c.unit + ')' : '')).join(', ') + '.'}</div> : null}
        {errs.lines ? errText(errs.lines) : null}
        {f.lines.length ? (ui.mobile ? cards : table) : <div style={{ font: 'var(--type-sm)', color: 'var(--text-3)' }}>Chưa có dòng nào.</div>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button size="sm" variant="secondary" icon="plus" disabled={busy || f.lines.length >= MAX_LINES} onClick={() => add('ITEM')}>Thêm dòng hàng</Button>
          <Button size="sm" variant="ghost" icon="heading" disabled={busy || f.lines.length >= MAX_LINES} onClick={() => add('SECTION')}>Thêm dòng nhóm</Button>
        </div>
        <div aria-label="Tổng tạm tính" style={{ alignSelf: ui.mobile ? 'stretch' : 'flex-end', minWidth: ui.mobile ? 0 : 320, display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 8, borderTop: '1px solid var(--border-subtle)' }}>
          {totalRow('Tổng giá trị trước VAT', t.subtotal)}
          {usesVat8 ? totalRow('VAT 8 %', t.vat8) : null}
          {usesVat10 ? totalRow('VAT 10 %', t.vat10) : null}
          {totalRow('Tổng giá trị sau VAT', t.total, true)}
          <div style={{ font: 'var(--type-caption)', color: 'var(--text-3)' }}>{t.ok ? 'Tạm tính — máy chủ tính lại khi lưu.' : 'Tạm tính chưa đủ: còn dòng chưa nhập đúng số lượng / đơn giá / VAT.'}</div>
          {mg ? <div style={{ marginTop: 6, padding: '8px 10px', borderRadius: 10, background: 'var(--surface-sunken)', font: 'var(--type-sm)' }}>
            <div style={{ fontWeight: 600 }}>Lãi gộp tạm tính (chỉ bạn và Quản trị CRM thấy)</div>
            <div>{mg.costedLines === 0 ? 'Chưa nhập giá vốn dòng nào — nhập ô "Giá vốn / đv" để xem lãi gộp.' : fmtVnd(mg.grossProfitVnd) + ' đ trên ' + mg.costedLines + ' / ' + mg.itemLines + ' dòng đã nhập giá vốn (doanh thu ' + fmtVnd(mg.costedAmountVnd) + ', giá vốn ' + fmtVnd(mg.costVnd) + ')'}</div>
          </div> : null}
        </div>
      </section>

      <section className="sg-card sg-solid" style={{ padding: ui.mobile ? 14 : 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Input label="Câu chào" multiline rows={2} maxLength={300} value={f.intro} onChange={setHead('intro')} disabled={busy} />
        <Input label="Điều khoản / Ghi chú in trên báo giá" multiline rows={5} maxLength={4000} value={f.terms} onChange={setHead('terms')} disabled={busy} />
        <Input label="Thông tin tài khoản" multiline rows={3} maxLength={2000} value={f.paymentInfo} onChange={setHead('paymentInfo')} disabled={busy} />
        <Input label="Ghi chú nội bộ (không in)" multiline rows={2} maxLength={2000} value={f.note} onChange={setHead('note')} disabled={busy} />
      </section>

      {/* Thanh lưu dính đáy: nền ĐẶC + viền trên để không đè lên nội dung bên dưới khi cuộn. Lỗi gần nút bấm (hộp lỗi đầy đủ ở đầu trang). */}
      <div className="sg-card sg-solid" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', position: 'sticky', bottom: 8, padding: '10px 14px', boxShadow: 'var(--shadow-md, 0 4px 16px rgba(0,0,0,.18))', zIndex: 2 }}>
        <Button icon="save" loading={busy} onClick={save}>Lưu nháp</Button>
        {error ? <span role="alert" style={{ font: 'var(--type-sm)', color: 'var(--error-text)' }}>{error.title + (error.message ? ' — ' + error.message : '')}</span>
          : savedAt ? <span role="status" style={{ font: 'var(--type-sm)', color: 'var(--success-text, var(--text-2))' }}>{'Đã lưu lúc ' + savedAt.toTimeString().slice(0, 5)}</span>
          : <span style={{ font: 'var(--type-caption)', color: 'var(--text-3)' }}>Chưa lưu thay đổi.</span>}
        <span style={{ marginLeft: 'auto', font: 'var(--type-sm)', color: 'var(--text-2)' }}>{'Tạm tính sau VAT: '}<b style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtVnd(t.total)}</b></span>
      </div>
    </div>
  );
}
