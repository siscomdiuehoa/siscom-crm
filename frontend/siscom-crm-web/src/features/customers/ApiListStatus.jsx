import React from 'react';
import { Button, Icon } from '../../ds/index.js';

// Shown only when the customer API flag is ON.
export function ApiModeNote() {
  return (
    <div role="note" style={{ display: 'flex', alignItems: 'center', gap: 8, font: 'var(--type-caption)', color: 'var(--text-2)' }}>
      <Icon name="server" size={14} />Danh sách đang lấy từ máy chủ (API), không phải dữ liệu demo. Xem chi tiết và sửa thông tin được hỗ trợ; xoá, nhập, xuất chưa hỗ trợ ở chế độ này. Tìm kiếm chỉ áp dụng trên danh sách đã tải.
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
