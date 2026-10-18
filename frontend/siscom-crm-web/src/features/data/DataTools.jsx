import React from 'react';
import { buildBackupFile } from '../../data/repository/index.js';

const link = { border: 0, background: 'transparent', color: 'inherit', font: 'var(--fw-semibold) var(--fs-caption)/16px var(--font-sans)', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3, padding: 0 };
export default function DataTools({ ui, getDb, onRestoreText, onReset }) {
  const fileRef = React.useRef(null);
  const Btn = ({ action, onClick, children }) => { const ok = ui.can(action); return <button type="button" disabled={!ok} title={ok ? undefined : 'Vai trò hiện tại không có quyền này'} onClick={onClick} style={{ ...link, opacity: ok ? 1 : 0.5, cursor: ok ? 'pointer' : 'not-allowed' }}>{children}</button>; };
  const exportFile = () => {
    const blob = new Blob([buildBackupFile(getDb())], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'siscom-crm-sao-luu-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    ui.toast({ tone: 'success', title: 'Đã xuất file sao lưu' });
  };
  const pick = (e) => {
    const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => ui.confirm({ title: 'Khôi phục từ file "' + f.name + '"?', icon: 'rotate-ccw', tone: 'warning', confirmLabel: 'Khôi phục', description: 'Dữ liệu hiện tại được sao lưu tự động trước, sau đó được thay bằng nội dung file.', onConfirm: () => { try { onRestoreText(String(rd.result)); ui.toast({ tone: 'success', title: 'Đã khôi phục dữ liệu từ file sao lưu' }); } catch (err) { ui.toast({ tone: 'error', title: 'Không khôi phục được', message: err.message }); } } });
    rd.readAsText(f);
  };
  const reset = () => ui.confirm({ title: 'Khôi phục dữ liệu mẫu?', description: 'Dữ liệu hiện tại được sao lưu tự động trước. Sau đó khách hàng, liên hệ, tương tác và các bản ghi khác trở về bộ dữ liệu mẫu ban đầu.', icon: 'rotate-ccw', tone: 'warning', confirmLabel: 'Khôi phục', onConfirm: () => { onReset(); ui.toast({ tone: 'success', title: 'Đã khôi phục dữ liệu mẫu', message: 'Bản sao lưu trước đó được giữ trong trình duyệt.' }); } });
  return (
    <span style={{ display: 'inline-flex', gap: 14, flexWrap: 'wrap' }}>
      <Btn action="data.backup" onClick={exportFile}>Xuất sao lưu</Btn>
      <Btn action="data.restore" onClick={() => fileRef.current && fileRef.current.click()}>Nhập sao lưu</Btn>
      <Btn action="data.restore" onClick={reset}>Khôi phục dữ liệu mẫu</Btn>
      <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={pick} />
    </span>
  );
}
