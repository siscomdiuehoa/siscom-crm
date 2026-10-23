import React from 'react';
import { Button, Icon } from '../../ds/index.js';

// Shown only when the customer API flag is ON.
export function ApiModeNote() {
  return (
    <div role="note" style={{ display: 'flex', alignItems: 'center', gap: 8, font: 'var(--type-caption)', color: 'var(--text-2)' }}>
      <Icon name="server" size={14} />Danh sách đang lấy từ máy chủ (API), không phải dữ liệu demo. Xem chi tiết và sửa thông tin được hỗ trợ; xoá, nhập, xuất chưa hỗ trợ ở chế độ này. Ô "Tìm trên máy chủ" tìm trên toàn bộ dữ liệu; các bộ lọc ngành/phụ trách/tỉnh/phân hạng chỉ lọc trong trang đang tải.
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
