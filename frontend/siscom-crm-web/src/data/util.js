  const ty = (v, d = 1) => (v / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: d, minimumFractionDigits: 0 });
  const money = (v) => (v >= 1e9 ? ty(v, 2) + ' tỷ' : v > 0 ? Math.round(v / 1e6).toLocaleString('vi-VN') + ' triệu' : '—');
  const vnd = (v) => Math.round(v).toLocaleString('vi-VN');
  const norm = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
  const dmy = (iso) => (iso && iso.includes('-') ? iso.split('-').reverse().join('/') : iso || '—');
  // D.0: mốc thời gian API là UTC (ISO "...Z"); hiển thị NGÀY theo giờ Việt Nam (Asia/Ho_Chi_Minh, UTC+7), không phụ thuộc máy người dùng, không cắt chuỗi ISO.
  const VN_DATE = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' });
  const dmyVN = (iso) => { if (!iso) return '—'; const d = new Date(iso); return Number.isNaN(d.getTime()) ? '—' : VN_DATE.format(d); };
  const isTax = (s) => /^\d{10}(-\d{3})?$/.test(String(s).trim());
  const isPhone = (s) => { let p = String(s == null ? '' : s).trim().replace(/[\s.()-]/g, ''); if (/^00[1-9]/.test(p)) p = '+' + p.slice(2); if (p.startsWith('+84')) p = '0' + p.slice(3); if (/^0\d{9,10}$/.test(p)) return true; return /^\+(?!84)[1-9]\d{7,14}$/.test(p); };
  const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s).trim());
  const isUrl = (s) => /^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(\/\S*)?$/i.test(String(s).trim());
  const csvCell = (v) => { const s = String(v == null ? '' : v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const downloadCsv = (filename, header, rows) => {
    const text = '\uFEFF' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const parseCsv = (text) => {
    const rows = []; let row = [], cell = '', q = false;
    text = text.replace(/^\uFEFF/, '');
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',' || ch === ';') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); if (row.some((c) => c.trim())) rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    row.push(cell); if (row.some((c) => c.trim())) rows.push(row);
    return rows;
  };
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const TIER_TONE = { 'Chiến lược': 'blue', VIP: 'cyan', 'Tiềm năng': 'warning', 'Thường': 'neutral' };
  const STATUS_TONE = { 'Đang giao dịch': 'success', 'Tiềm năng': 'blue', 'Tạm ngưng': 'warning', 'Ngừng giao dịch': 'neutral' };
  const Q_TONE = { 'Nháp': 'neutral', 'Chờ duyệt': 'warning', 'Đã gửi': 'blue', 'Thắng': 'success', 'Từ chối': 'error', 'Hết hạn': 'outline' };
  const C_TONE = { 'Đang thực hiện': 'blue', 'Đã nghiệm thu': 'success', 'Sắp hết hạn': 'warning', 'Chờ ký': 'cyan' };
export { ty, money, vnd, norm, dmy, dmyVN, isTax, isPhone, isEmail, isUrl, downloadCsv, parseCsv, today, TIER_TONE, STATUS_TONE, Q_TONE, C_TONE };
