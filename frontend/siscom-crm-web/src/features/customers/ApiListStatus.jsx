import React from 'react';
import { Button, Icon, Input } from '../../ds/index.js';

// Shown only when the customer API flag is ON.
export function ApiModeNote() {
  return (
    <div role="note" style={{ display: 'flex', alignItems: 'center', gap: 8, font: 'var(--type-caption)', color: 'var(--text-2)' }}>
      <Icon name="server" size={14} />Danh sách đang lấy từ máy chủ (API), không phải dữ liệu demo. Để sửa, mở chi tiết khách hàng (bấm vào dòng hoặc biểu tượng bút) rồi chọn "Sửa thông tin"; xoá, nhập, xuất chưa hỗ trợ ở chế độ này. Ô "Tìm trên máy chủ" tìm trên toàn bộ dữ liệu; các bộ lọc ngành/phụ trách/tỉnh/phân hạng chỉ lọc trong trang đang tải.
    </div>
  );
}

// Server-side search box (GET /customers?search=). Fewer than SEARCH_MIN_CHARS characters are never sent; the user is told instead of silently ignored.
export function ApiSearchBar({ value, onSearch, busy, minChars = 2 }) {
  const [text, setText] = React.useState(value || '');
  const t = text.trim(); const short = t.length > 0 && t.length < minChars;
  const submit = (e) => { if (e) e.preventDefault(); if (!short) onSearch(t); };
  return (
    <form onSubmit={submit} role="search" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <div style={{ width: 360, maxWidth: '100%' }}><Input icon="search" placeholder="Tìm trên máy chủ: tên, mã KH, MST, SĐT…" value={text} onChange={(e) => setText(e.target.value)} aria-label="Tìm kiếm khách hàng trên máy chủ" /></div>
      <Button type="submit" size="sm" variant="secondary" disabled={busy || short}>Tìm</Button>
      {value ? <Button size="sm" variant="ghost" icon="x" disabled={busy} onClick={() => { setText(''); onSearch(''); }}>Bỏ tìm kiếm</Button> : null}
      {short ? <span role="status" style={{ font: 'var(--type-caption)', color: 'var(--text-3)' }}>Nhập ít nhất {minChars} ký tự để tìm trên máy chủ.</span> : null}
    </form>
  );
}

// Prev/next over server pages. `paging` = normalizePaging() output. Total is the SERVER total (all pages), not the loaded rows.
export function ApiPager({ paging, busy, onPrev, onNext }) {
  if (!paging) return null;
  return (
    <div role="navigation" aria-label="Phân trang khách hàng" style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap', font: 'var(--type-sm)', color: 'var(--text-2)' }}>
      <span>{paging.search ? 'Kết quả tìm "' + paging.search + '": ' : ''}{paging.total.toLocaleString('vi-VN')} khách hàng · Trang {paging.page}/{paging.totalPages}</span>
      <Button size="sm" variant="secondary" icon="chevron-left" disabled={busy || !paging.hasPrev} onClick={onPrev}>Trước</Button>
      <Button size="sm" variant="secondary" disabled={busy || !paging.hasNext} onClick={onNext}>Sau</Button>
    </div>
  );
}

// Structured error (output of describeRepoError) -> alert box. Used for the list and, via `error`, for the form.
export function ApiErrorBox({ error, onRetry, retryLabel = 'Thử lại' }) {
  return (
    <div role="alert" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px', borderRadius: 12, background: 'var(--error-soft)', border: '1px solid var(--error-border)', color: 'var(--error-text)' }}>
      <Icon name="circle-alert" size={16} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{error.title}{error.status ? ' (' + error.status + ')' : ''}</div>
        <div style={{ font: 'var(--type-sm)' }}>{error.message}</div>
        {error.hint ? <div style={{ font: 'var(--type-sm)', marginTop: 2 }}>{error.hint}</div> : null}
        {error.extra && error.extra.length ? <ul style={{ margin: '4px 0 0', paddingLeft: 18, font: 'var(--type-sm)' }}>{error.extra.map((t, i) => <li key={i}>{t}</li>)}</ul> : null}
      </div>
      {onRetry && error.retryable ? <Button size="sm" variant="secondary" onClick={onRetry}>{retryLabel}</Button> : null}
    </div>
  );
}

// List body while not ready: loading (incl. idle, the load starts on mount) or error. Never renders demo data.
export function ApiListStatus({ s, onRetry }) {
  if (s.status === 'error') return <ApiErrorBox error={s.error} onRetry={onRetry} />;
  return <div className="sg-card sg-solid" role="status" aria-live="polite" style={{ padding: 24, display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-2)' }}><span className="sg-btn__spin" />Đang tải danh sách khách hàng…</div>;
}

// Edit conflict (HTTP 409 CUSTOMER_VERSION_CONFLICT): someone else changed the record. Never overwrites silently: the user first loads the server copy,
// sees which fields differ from their unsaved draft, then explicitly chooses to use the server copy (drops own edits) or keep own edits (saved on top of the server version).
export function ApiConflictPanel({ conflict, diff, onRefresh, onUseServer, onKeepMine }) {
  const box = { display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 14px', borderRadius: 12, background: 'var(--warning-soft)', border: '1px solid var(--warning-border)', color: 'var(--text-1)' };
  const head = <div style={{ fontWeight: 600 }}>Khách hàng đã được người khác cập nhật</div>;
  if (!conflict || conflict.status === 'idle') {
    return <div role="alert" style={box}>{head}<div style={{ font: 'var(--type-sm)' }}>Thay đổi của bạn chưa được lưu và vẫn được giữ trên biểu mẫu. Tải bản mới nhất từ máy chủ để xem khác biệt rồi quyết định.</div><div><Button size="sm" variant="secondary" icon="refresh-cw" onClick={onRefresh}>Tải bản mới nhất từ máy chủ</Button></div></div>;
  }
  if (conflict.status === 'loading') return <div role="status" aria-live="polite" style={box}>{head}<div style={{ display: 'flex', alignItems: 'center', gap: 8, font: 'var(--type-sm)' }}><span className="sg-btn__spin" />Đang tải bản mới nhất từ máy chủ…</div></div>;
  if (conflict.status === 'error') return <div style={box}>{head}<ApiErrorBox error={conflict.error} onRetry={onRefresh} /><div style={{ font: 'var(--type-sm)' }}>Thay đổi của bạn vẫn được giữ trên biểu mẫu.</div>{conflict.error.retryable ? null : <div><Button size="sm" variant="secondary" icon="refresh-cw" onClick={onRefresh} disabled={conflict.error.denied}>Thử tải lại</Button></div>}</div>;
  return (
    <div role="alert" style={box}>
      {head}
      {diff.length ? (
        <table style={{ borderCollapse: 'collapse', font: 'var(--type-sm)', width: '100%' }}>
          <thead><tr style={{ textAlign: 'left', color: 'var(--text-3)' }}><th>Trường</th><th>Của bạn (chưa lưu)</th><th>Trên máy chủ</th></tr></thead>
          <tbody>{diff.map((d) => <tr key={d.field}><td>{d.label}</td><td>{d.mine || '—'}</td><td>{d.server || '—'}</td></tr>)}</tbody>
        </table>
      ) : <div style={{ font: 'var(--type-sm)' }}>Nội dung bạn nhập đã trùng với bản trên máy chủ.</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button size="sm" variant="secondary" onClick={onUseServer}>Dùng bản máy chủ (bỏ thay đổi của tôi)</Button>
        <Button size="sm" onClick={onKeepMine}>Giữ thay đổi của tôi (lưu đè lên bản mới nhất)</Button>
      </div>
      <div style={{ font: 'var(--type-caption)', color: 'var(--text-2)' }}>Chọn "Giữ thay đổi của tôi" chỉ cập nhật phiên bản đang dùng; bạn vẫn phải bấm "Lưu thay đổi" để ghi lên máy chủ.</div>
    </div>
  );
}
