import React from 'react';
import { Badge, Button, EmptyState } from '../../ds/index.js';
import { ApiErrorBox } from '../customers/ApiListStatus.jsx';
import { STATE_META, printLayout } from './quotesModel.js';
import { QuoteNoAccess } from './QuotesPage.jsx';
import { SISCOM_V1_CSS, SiscomV1Sheet } from './print/siscom-v1.jsx';

// Báo giá Q8a: xem bản in (#/quotes/:id/print/:no) — mục 4.2, 4.4. Trang xem trước trong CRM; bấm "In / Lưu PDF" để in bằng trình duyệt
// (nút tải PDF / Excel do máy chủ dựng là Q9 / Q10). Mọi thứ trên tờ in đọc từ CHÍNH phiên bản (mục 4.3); giá vốn không bao giờ có ở đây.
// Mỗi mã bố cục đã dùng được giữ nguyên: phiên bản ghi mã nào thì in bằng bố cục đó; mã chưa biết => dùng bố cục hiện hành.
const LAYOUTS = { 'siscom-v1': { Sheet: SiscomV1Sheet, css: SISCOM_V1_CSS } };
const CURRENT_LAYOUT = 'siscom-v1';

// Khi in: chỉ còn tờ in. Mọi phần tử KHÔNG chứa tờ in bị ẩn; các khung bọc ngoài bỏ cuộn / chiều cao cố định / hiệu ứng kính để nội dung dài tự sang trang.
const printCss = (landscape) => `
@page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 12mm; }
@media print {
  body *:not(:has(.qp-sheet)):not(.qp-sheet):not(.qp-sheet *) { display: none !important; }
  html, body, body *:has(.qp-sheet) { display: block !important; position: static !important; overflow: visible !important; height: auto !important; max-height: none !important; min-height: 0 !important; width: auto !important; max-width: none !important; margin: 0 !important; padding: 0 !important; border: 0 !important; background: #fff !important; box-shadow: none !important; transform: none !important; filter: none !important; backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }
  .qp-sheet { width: auto !important; max-width: none !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important; border: 0 !important; box-shadow: none !important; }
}
`;

export function QuotePrint({ ui, id, no = 'latest' }) {
  const ctl = ui.customerApi.quotes;
  const [st, setSt] = React.useState({ status: 'loading', q: null, error: null });
  const load = React.useCallback(() => { setSt({ status: 'loading', q: null, error: null }); ctl.detail(id).then((r) => setSt(r.ok ? { status: 'ready', q: r.data, error: null } : { status: 'error', q: null, error: r.error })); }, [ctl, id]);
  React.useEffect(() => { load(); }, [load]);
  const q = st.q; const vs = q ? q.versions || [] : [];
  const v = no === 'latest' ? vs[vs.length - 1] : vs.find((x) => String(x.versionNo) === no);
  // Tên tệp gợi ý của máy chủ (mục 4.4; nháp có _NHAP) làm tiêu đề trang: trình duyệt dùng nó làm tên khi "Lưu thành PDF". Rời trang => trả lại tiêu đề cũ.
  const fileName = v ? v.suggestedFileName : null;
  React.useEffect(() => {
    if (!fileName || typeof document === 'undefined') return undefined;
    const prev = document.title; document.title = fileName;
    return () => { document.title = prev; };
  }, [fileName]);
  const back = <Button variant="ghost" size="sm" icon="arrow-left" onClick={() => ui.navigate('/quotes/' + id)}>Quay lại báo giá</Button>;
  if (st.status === 'loading') return <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}><div>{back}</div><div role="status" className="sg-card sg-solid" style={{ padding: 20 }}>Đang tải báo giá…</div></div>;
  if (st.status === 'error') return <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}><div>{back}</div><ApiErrorBox error={st.error} onRetry={load} /></div>;
  if (!v) return <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}><div>{back}</div><div className="sg-card sg-solid"><EmptyState kind="search" title={no === 'latest' ? 'Báo giá chưa có phiên bản' : 'Không có phiên bản ' + no} description={q.code + ' · ' + q.itemName} /></div></div>;
  const layout = printLayout(v, q.code);
  const L = LAYOUTS[v.printTemplate] || LAYOUTS[CURRENT_LAYOUT];
  const meta = STATE_META[v.state] || { label: v.state, tone: 'neutral' };
  const doPrint = () => { if (typeof window !== 'undefined' && typeof window.print === 'function') window.print(); };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <style>{printCss(layout.landscape) + L.css}</style>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {back}
        <span style={{ font: 'var(--type-mono)', color: 'var(--text-3)' }}>{q.code + ' v' + v.versionNo}</span>
        <Badge size="sm" tone={meta.tone}>{meta.label}</Badge>
        <span style={{ flex: 1 }} />
        <Button size="sm" icon="printer" onClick={doPrint}>In / Lưu PDF</Button>
      </div>
      <div role="note" style={{ font: 'var(--type-caption)', color: 'var(--text-3)' }}>
        {'Khổ A4 ' + (layout.landscape ? 'ngang' : 'dọc') + '. Trong hộp thoại in, chọn "Lưu dưới dạng PDF" để có tệp ' + fileName + '.pdf' + (layout.draft ? ' — đây là BẢN NHÁP, chưa gửi khách.' : '.')}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <div className="qp-sheet" style={{ background: '#fff', color: '#000', position: 'relative', boxSizing: 'border-box', width: layout.landscape ? '297mm' : '210mm', maxWidth: 'none', minHeight: layout.landscape ? '210mm' : '297mm', padding: '12mm', margin: '0 auto', border: '1px solid #c8c8c8', boxShadow: '0 2px 12px rgba(0,0,0,0.12)' }}>
          <L.Sheet v={v} layout={layout} />
        </div>
      </div>
    </div>
  );
}

// Cổng của route bản in: không có quote.read => trang "không có quyền", KHÔNG gọi máy chủ (ca C4).
export function QuotePrintRoute({ ui, id, no, allowed }) {
  return allowed ? <QuotePrint ui={ui} id={id} no={no} /> : <QuoteNoAccess ui={ui} />;
}
