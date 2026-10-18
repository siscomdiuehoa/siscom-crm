import React from 'react';
import { Modal, Button, FileUpload, Checkbox, Radio, Badge, Icon } from '../../ds/index.js';
import * as U from '../../data/util.js';
import { APP_DATA } from '../../data/demoData.js';
import { validateCustomer, normalizeCustomer } from '../../data/customerRules.js';

const COLS = [
  ['id', 'Mã KH'], ['name', 'Tên công ty'], ['taxId', 'Mã số thuế'], ['industry', 'Ngành nghề'], ['tier', 'Phân hạng'], ['status', 'Trạng thái'],
  ['owner', 'Phụ trách'], ['address', 'Địa chỉ'], ['city', 'Tỉnh/Thành phố'], ['phone', 'Điện thoại'], ['email', 'Email'], ['website', 'Website'], ['revenue', 'Doanh thu luỹ kế (VNĐ)'], ['createdAt', 'Ngày tạo'],
];
const TEMPLATE = ['Tên công ty', 'Mã số thuế', 'Ngành nghề', 'Tỉnh/Thành phố', 'Địa chỉ', 'Điện thoại', 'Email', 'Phân hạng'];

function ExportModal({ open, onClose, rows, selected, ui }) {
  const [scope, setScope] = React.useState('filtered');
  const [fmt, setFmt] = React.useState('csv');
  const [cols, setCols] = React.useState(COLS.slice(0, 11).map((c) => c[0]));
  const list = scope === 'selected' ? rows.filter((r) => selected.includes(r.id)) : scope === 'all' ? ui.db.customers : rows;
  const go = () => {
    const cs = COLS.filter((c) => cols.includes(c[0]));
    U.downloadCsv('KhachHang_' + U.today() + '.csv', cs.map((c) => c[1]), list.map((r) => cs.map((c) => (c[0] === 'createdAt' ? U.dmy(r.createdAt) : r[c[0]]))));
    onClose();
    ui.toast({ tone: 'success', title: 'Đã xuất ' + list.length + ' khách hàng', message: 'File CSV (UTF-8) mở được bằng Excel.' });
  };
  return (
    <Modal open={open} onClose={onClose} icon="download" title="Xuất danh sách khách hàng" description="Chọn phạm vi dữ liệu và các cột cần xuất." size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Huỷ</Button><Button icon="download" disabled={!list.length || !cols.length} onClick={go}>Xuất {list.length} khách hàng</Button></>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span className="sg-label">Phạm vi</span>
          <Radio name="ex-scope" value="filtered" checked={scope === 'filtered'} onChange={setScope} label={'Theo bộ lọc hiện tại (' + rows.length + ')'} />
          <Radio name="ex-scope" value="selected" checked={scope === 'selected'} onChange={setScope} disabled={!selected.length} label={'Dòng đã chọn (' + selected.length + ')'} />
          <Radio name="ex-scope" value="all" checked={scope === 'all'} onChange={setScope} label={'Toàn bộ (' + ui.db.customers.length + ')'} />
          <span className="sg-label" style={{ marginTop: 10 }}>Định dạng</span>
          <Radio name="ex-fmt" value="csv" checked={fmt === 'csv'} onChange={setFmt} label="CSV (UTF-8, mở bằng Excel)" />
          <Radio name="ex-fmt" value="xlsx" checked={fmt === 'xlsx'} onChange={setFmt} label="Excel .xlsx" />
          {fmt === 'xlsx' ? <span className="sg-hint"><Icon name="info" size={13} />File .xlsx gốc cần máy chủ; bản demo sẽ xuất CSV tương thích Excel.</span> : null}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center' }}><span className="sg-label" style={{ flex: 1 }}>Cột dữ liệu ({cols.length})</span><Button size="sm" variant="ghost" onClick={() => setCols(cols.length === COLS.length ? [] : COLS.map((c) => c[0]))}>{cols.length === COLS.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}</Button></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 8 }}>
            {COLS.map(([k, l]) => <Checkbox key={k} label={l} checked={cols.includes(k)} onChange={(on) => setCols(on ? [...cols, k] : cols.filter((x) => x !== k))} />)}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function ImportModal({ open, onClose, ui }) {
  const D = APP_DATA;
  const [rows, setRows] = React.useState(null);
  const [file, setFile] = React.useState(null);
  const [simulated, setSimulated] = React.useState(false);
  const reset = () => { setRows(null); setFile(null); setSimulated(false); };
  const close = () => { reset(); onClose(); };
  const check = (r, all) => {
    const e = Object.values(validateCustomer(normalizeCustomer(r), { customers: ui.db.customers }));
    const tax = (r.taxId || '').trim();
    if (tax && !e.some((m) => m.startsWith('MST đã tồn tại')) && all.filter((x) => (x.taxId || '').trim() === tax).length > 1) e.push('MST trùng trong file');
    return e;
  };
  const take = (files) => {
    const fl = files[0]; if (!fl) return;
    setFile({ name: fl.name, size: (fl.size / 1024).toLocaleString('vi-VN', { maximumFractionDigits: 0 }) + ' KB' });
    if (/\.csv$/i.test(fl.name)) {
      fl.text().then((t) => {
        const data = U.parseCsv(t); const head = (data[0] || []).map((h) => U.norm(h.trim()));
        const col = (label) => head.indexOf(U.norm(label));
        const map = { name: col('Tên công ty'), taxId: col('Mã số thuế'), industry: col('Ngành nghề'), city: col('Tỉnh/Thành phố'), address: col('Địa chỉ'), phone: col('Điện thoại'), email: col('Email'), tier: col('Phân hạng') };
        const out = data.slice(1).map((r) => Object.fromEntries(Object.entries(map).map(([k, i]) => [k, i >= 0 ? (r[i] || '').trim() : ''])));
        setRows(out.filter((r) => Object.values(r).some(Boolean)).slice(0, 500)); setSimulated(false);
      });
    } else {
      setSimulated(true);
      setRows([
        { name: 'Công ty CP Cơ điện Thành Nam', taxId: '0315550012', industry: 'Tổng thầu xây dựng', city: 'TP. Hồ Chí Minh', address: '22 Nguyễn Trãi, P. Bến Thành', phone: '028 3925 1100', email: 'info@thanhnam-demo.vn', tier: 'Tiềm năng' },
        { name: 'Công ty TNHH Cơ khí Bình Minh', taxId: '', industry: 'Nhà máy – KCN', city: 'Bình Dương', address: '', phone: '+82 2 1234 5678', email: '', tier: '' },
        { name: 'Công ty TNHH Thiết bị Lạnh An Phát', taxId: '0318881234', industry: 'Nhà máy – KCN', city: 'Đồng Nai', address: '', phone: '', email: '', tier: '' },
        { name: 'Bệnh viện Đa khoa Phúc Lâm', taxId: '0109981234', industry: 'Y tế', city: 'Hà Nội', address: '15 Trần Duy Hưng', phone: '024 3556 7788', email: 'kythuat@phuclam-demo.vn', tier: 'Thường' },
        { name: 'Công ty TNHH Nhựa Hải Long', taxId: '12345', industry: 'Nhà máy – KCN', city: 'Hải Phòng', address: 'KCN Đình Vũ', phone: '0225 3799 001', email: 'mua-hang@hailong', tier: 'Thường' },
        { name: 'Công ty CP Tập đoàn Xây dựng Hưng Phát', taxId: ui.db.customers[0] ? ui.db.customers[0].taxId : '0301234567', industry: 'Tổng thầu xây dựng', city: 'TP. Hồ Chí Minh', address: '235 Võ Văn Kiệt', phone: '028 3821 4455', email: '', tier: 'Chiến lược' },
      ]);
    }
  };
  const checked = rows ? rows.map((r) => ({ r, e: check(r, rows) })) : [];
  const ok = checked.filter((x) => !x.e.length);
  const doImport = () => {
    let n = ui.api.maxCustomerNo();
    const list = ok.map(({ r }) => ({ id: 'KH-' + String(++n).padStart(5, '0'), ...normalizeCustomer({ ...r, industry: D.INDUSTRIES.includes(r.industry) ? r.industry : '', tier: D.TIERS.includes(r.tier) ? r.tier : '', owner: '', source: '', website: '', note: 'Nhập từ file ' + file.name }), revenue: 0, createdAt: U.today(), tags: [] }));
    if (!ui.api.importCustomers(list).ok) return;
    ui.toast({ tone: 'success', title: 'Đã nhập ' + list.length + ' khách hàng', message: checked.length - ok.length ? (checked.length - ok.length) + ' dòng lỗi đã bị bỏ qua.' : undefined });
    close();
  };
  return (
    <Modal open={open} onClose={close} icon="upload" title="Nhập khách hàng từ file" description="Hỗ trợ CSV (UTF-8) theo file mẫu. Bắt buộc có Tên công ty và Điện thoại; MST có thể để trống, nếu có sẽ được kiểm tra định dạng và trùng lặp." size="lg"
      footer={rows ? <><Button variant="ghost" icon="rotate-ccw" onClick={reset}>Chọn file khác</Button><span style={{ flex: 1 }} /><Button variant="secondary" onClick={close}>Huỷ</Button><Button icon="check" disabled={!ok.length} onClick={doImport}>Nhập {ok.length} khách hàng hợp lệ</Button></> : <Button variant="secondary" onClick={close}>Đóng</Button>}>
      {!rows ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <FileUpload multiple={false} accept=".csv,.xlsx,.xls" title="Kéo thả file vào đây hoặc bấm để chọn" hint="CSV hoặc Excel · tối đa 500 dòng" onFiles={take} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, background: 'var(--surface-sunken)', flexWrap: 'wrap' }}>
            <Icon name="file-spreadsheet" size={20} color="var(--success)" />
            <div style={{ flex: 1, minWidth: 200, font: 'var(--type-sm)', color: 'var(--text-2)' }}>Dùng file mẫu để đúng tên cột: {TEMPLATE.join(', ')}.</div>
            <Button size="sm" variant="secondary" icon="download" onClick={() => U.downloadCsv('Mau_NhapKhachHang.csv', TEMPLATE, [['Công ty CP Ví dụ Minh Hoạ', '0312345678', 'Bất động sản', 'TP. Hồ Chí Minh', '1 Lê Lợi, P. Bến Nghé', '028 3800 0000', 'lienhe@vidu-demo.vn', 'Tiềm năng']])}>Tải file mẫu</Button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Icon name="file-spreadsheet" size={18} color="var(--success)" /><b style={{ fontWeight: 500 }}>{file.name}</b><span style={{ color: 'var(--text-3)', font: 'var(--type-caption)' }}>{file.size}</span>
            <span style={{ flex: 1 }} /><Badge tone="success" dot>{ok.length} hợp lệ</Badge>{checked.length - ok.length ? <Badge tone="error" dot>{checked.length - ok.length} lỗi</Badge> : null}
          </div>
          {simulated ? <div className="sg-hint" style={{ padding: '8px 12px', borderRadius: 10, background: 'var(--warning-soft)', color: 'var(--warning-text)' }}><Icon name="info" size={13} />Đọc file Excel cần máy chủ — bản demo đang hiển thị dữ liệu mô phỏng để minh hoạ bước kiểm tra.</div> : null}
          <div className="sg-solid sg-table-scroll sg-scroll" style={{ borderRadius: 12, maxHeight: 300 }}>
            <table className="sg-table sg-table--compact">
              <thead><tr><th>#</th><th>Tên công ty</th><th>MST</th><th>Điện thoại</th><th>Kiểm tra</th></tr></thead>
              <tbody>{checked.map(({ r, e }, i) => (
                <tr key={i}><td>{i + 2}</td><td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name || <span style={{ color: 'var(--text-3)' }}>—</span>}</td><td style={{ font: 'var(--type-mono)' }}>{r.taxId}</td><td>{r.phone}</td>
                  <td>{e.length ? <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{e.map((x) => <Badge key={x} size="sm" tone="error">{x}</Badge>)}</span> : <Badge size="sm" tone="success" icon="check">Hợp lệ</Badge>}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}
export { ExportModal as CustomerExportModal, ImportModal as CustomerImportModal };
