import React from 'react';
import logo from '../../../assets/logo-siscom.png';
import { fmtQty, fmtVnd } from '../quotesModel.js';

// Bố cục in mã `siscom-v1` (docs/QUOTES_DESIGN.md mục 4.2). SAU KHI PHÁT HÀNH KHÔNG SỬA tệp này: đổi logo / mẫu = thêm bố cục mới với mã mới
// (mục 4.3) — bài kiểm chốt mã băm của tệp. Mọi chữ lấy từ CHÍNH phiên bản; React tự thoát ký tự nên nội dung người dùng nhập luôn là văn bản thuần.
// Màu cố định trắng / đen: không dùng biến màu của giao diện (nền tối vẫn in nền trắng). Giá vốn và ghi chú nội bộ không có ở đây.
const dmy = (s) => (s ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : '');
const B = '1px solid #000';
const th = { border: B, padding: '4px 5px', fontWeight: 700, textAlign: 'center', verticalAlign: 'middle', background: '#f0f0f0' };
const td = { border: B, padding: '4px 5px', verticalAlign: 'top', overflowWrap: 'anywhere' };
const num = { ...td, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };

export const SISCOM_V1_CSS = `
.qp-sheet { font-family: Arial, 'Helvetica Neue', Helvetica, sans-serif; font-size: 11px; line-height: 1.35; }
.qp-sheet table { width: 100%; border-collapse: collapse; }
.qp-sheet thead { display: table-header-group; }
.qp-sheet tr, .qp-keep { break-inside: avoid; page-break-inside: avoid; }
.qp-watermark { position: absolute; top: 38%; left: 0; right: 0; text-align: center; font-size: 84px; font-weight: 700; letter-spacing: 6px; color: rgba(0, 0, 0, 0.09); transform: rotate(-28deg); pointer-events: none; user-select: none; }
@media print { .qp-watermark { position: fixed; } }
`;

function Info({ rows }) {
  return (
    <div style={{ flex: '1 1 0', minWidth: 0 }}>
      {rows.map(([k, val]) => <div key={k} style={{ display: 'flex', gap: 6 }}><span style={{ flex: '0 0 46%', fontWeight: 700 }}>{k + ':'}</span><span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{val || ''}</span></div>)}
    </div>
  );
}

export function SiscomV1Sheet({ v, layout }) {
  const c = v.client || {}; const q = v.quoter || {};
  const cols = layout.columns;
  const span = 6 + cols.length + (layout.vatColumn ? 1 : 0);
  const totalRow = (label, value, strong) => (
    <tr key={label} className="qp-keep">
      <td style={{ ...td, textAlign: 'right', fontWeight: strong ? 700 : 400 }} colSpan={span - 1}>{label}</td>
      <td style={{ ...num, fontWeight: strong ? 700 : 400 }} colSpan={2}>{fmtVnd(value)}</td>
    </tr>
  );
  return (
    <>
      {layout.draft ? <div className="qp-watermark" aria-hidden="true">BẢN NHÁP</div> : null}
      <div style={{ marginBottom: 10 }}><img src={logo} alt="SISCOM" style={{ height: 44, width: 'auto' }} /></div>
      <div style={{ display: 'flex', gap: 24, marginBottom: 12 }}>
        <Info rows={[['Khách hàng / Client', c.name], ['Dự án / Project', v.projectName], ['Điện thoại / Mobile', c.phone], ['Email', c.email], ['Công ty / Company', c.company], ['Địa chỉ / Address', c.address]]} />
        <Info rows={[['Báo giá bởi / Quotation by', q.name], ['Chức vụ / Position', q.title], ['Điện thoại / Mobile', q.phone], ['Email', q.email], ['Ngày báo giá / Date', dmy(v.quoteDate)], ['Mã báo giá / Seri no.', layout.codeLabel]]} />
      </div>
      <div style={{ textAlign: 'center', fontSize: 15, fontWeight: 700, margin: '6px 0 8px', overflowWrap: 'anywhere' }}>{v.title}</div>
      {v.intro ? <div style={{ whiteSpace: 'pre-line', marginBottom: 8, overflowWrap: 'anywhere' }}>{v.intro}</div> : null}
      <table>
        <thead>
          <tr>
            <th style={{ ...th, width: 28 }}>TT</th><th style={th}>Nội dung công việc</th>
            {cols.map((x) => <th key={x.key} style={th}>{x.label + (x.unit ? ' (' + x.unit + ')' : '')}</th>)}
            <th style={th}>ĐVT</th><th style={th}>SL</th><th style={th}>Đơn giá</th>{layout.vatColumn ? <th style={th}>VAT %</th> : null}<th style={th}>Thành tiền</th><th style={th}>Ghi chú</th>
          </tr>
        </thead>
        <tbody>
          {layout.rows.map(({ line: l, no }) => (l.kind !== 'ITEM'
            ? <tr key={l.lineNo}><td style={td} /><td style={{ ...td, fontWeight: 700 }} colSpan={span}>{l.description}</td></tr>
            : <tr key={l.lineNo}>
              <td style={{ ...td, textAlign: 'center' }}>{no}</td><td style={td}>{l.description}</td>
              {cols.map((x) => <td key={x.key} style={td}>{(l.extra || {})[x.key] || ''}</td>)}
              <td style={{ ...td, textAlign: 'center' }}>{l.unit}</td><td style={num}>{fmtQty(l.quantity)}</td><td style={num}>{fmtVnd(l.unitPriceVnd)}</td>
              {layout.vatColumn ? <td style={{ ...td, textAlign: 'center' }}>{l.vatPercent}</td> : null}
              <td style={num}>{fmtVnd(l.amountVnd)}</td><td style={td}>{l.note || ''}</td>
            </tr>))}
          {totalRow('Tổng giá trị trước VAT', v.subtotalVnd)}
          {layout.vatRows.map((r) => totalRow('VAT ' + r.percent + ' %', r.value))}
          {totalRow('Tổng giá trị sau VAT', v.totalVnd, true)}
        </tbody>
      </table>
      <div className="qp-keep" style={{ display: 'flex', gap: 24, marginTop: 10 }}>
        <div style={{ flex: 1, minWidth: 0, whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}><b>Ghi chú: </b>{v.terms || ''}</div>
        <div style={{ flex: '0 0 auto', whiteSpace: 'nowrap' }}><b>Hiệu lực đến: </b>{dmy(v.validUntil)}</div>
      </div>
      {v.paymentInfo ? <div className="qp-keep" style={{ marginTop: 8, whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}><b>Thông tin tài khoản: </b>{v.paymentInfo}</div> : null}
      <div className="qp-keep" style={{ display: 'flex', justifyContent: 'space-around', gap: 24, marginTop: 22, textAlign: 'center', fontWeight: 700 }}>
        <div style={{ minHeight: 90 }}>XÁC NHẬN ĐẶT HÀNG</div>
        <div style={{ minHeight: 90 }}>XÁC NHẬN CÔNG TY</div>
      </div>
    </>
  );
}
