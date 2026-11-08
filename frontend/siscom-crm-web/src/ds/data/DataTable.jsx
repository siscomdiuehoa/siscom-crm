import React, { useMemo, useState } from 'react';
import { Icon } from '../core/Icon.jsx';
import { Checkbox } from '../forms/Checkbox.jsx';
import { Skeleton } from '../feedback/Skeleton.jsx';
import { EmptyState } from '../feedback/EmptyState.jsx';

export const normalizeVi = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

function pages(cur, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out = [1];
  const a = Math.max(2, cur - 1), b = Math.min(total - 1, cur + 1);
  if (a > 2) out.push('…');
  for (let i = a; i <= b; i++) out.push(i);
  if (b < total - 1) out.push('…');
  out.push(total);
  return out;
}

export function DataTable({ columns = [], rows = [], rowKey = 'id', searchable = true, searchPlaceholder = 'Tìm kiếm…', searchKeys, filter, pageSize = 8, selectable = false, onSelectionChange, onFilterChange, toolbar, title, onRowClick, itemLabel = 'bản ghi', loading = false, emptyTitle = 'Chưa có dữ liệu', compact = false, variant = 'solid' }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState(null);
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState([]);
  const [fv, setFv] = useState(null);

  const data = useMemo(() => {
    let r = rows;
    if (fv != null && filter) r = r.filter((x) => x[filter.key] === fv);
    if (q.trim()) {
      const nq = normalizeVi(q.trim());
      const keys = searchKeys || columns.map((c) => c.key);
      r = r.filter((x) => keys.some((k) => normalizeVi(x[k]).includes(nq)));
    }
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      const get = (x) => (col && col.sortValue ? col.sortValue(x) : x[sort.key]);
      r = [...r].sort((a, b) => {
        const va = get(a), vb = get(b);
        const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'vi');
        return sort.dir === 'asc' ? c : -c;
      });
    }
    return r;
  }, [rows, q, sort, fv, filter, columns, searchKeys]);

  const total = Math.max(1, Math.ceil(data.length / pageSize));
  const p = Math.min(page, total);
  const view = data.slice((p - 1) * pageSize, p * pageSize);
  const setSelection = (s) => { setSel(s); onSelectionChange && onSelectionChange(s); };
  const allOn = view.length > 0 && view.every((r) => sel.includes(r[rowKey]));
  const toggleSort = (k) => setSort((s) => (!s || s.key !== k ? { key: k, dir: 'asc' } : s.dir === 'asc' ? { key: k, dir: 'desc' } : null));

  return (
    <div className={'sg-table-wrap ' + (variant === 'glass' ? 'sg-glass' : 'sg-solid')}>
      {searchable || filter || toolbar || title ? (
        <div className="sg-table-tools">
          {title ? <div style={{ font: 'var(--type-h4)', marginRight: 8 }}>{title}</div> : null}
          {searchable ? (
            <div className="sg-control sg-control--sm" style={{ width: 260, maxWidth: '100%' }}>
              <Icon name="search" size={15} />
              <input className="sg-input" style={{ fontSize: 13 }} value={q} placeholder={searchPlaceholder} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label={searchPlaceholder} />
              {q ? <Icon name="x" size={14} style={{ cursor: 'pointer' }} onClick={() => setQ('')} /> : null}
            </div>
          ) : null}
          {filter ? (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button type="button" className="sg-chip" aria-pressed={fv == null} onClick={() => { setFv(null); onFilterChange && onFilterChange(null); setPage(1); }}>Tất cả</button>
              {filter.options.map((o) => <button key={o} type="button" className="sg-chip" aria-pressed={fv === o} onClick={() => { setFv(fv === o ? null : o); onFilterChange && onFilterChange(fv === o ? null : o); setPage(1); }}>{o}</button>)}
            </div>
          ) : null}
          <div style={{ flex: 1 }} />
          {sel.length ? <span style={{ font: 'var(--type-sm)', color: 'var(--primary-text)', fontWeight: 600 }}>Đã chọn {sel.length}</span> : null}
          {toolbar}
        </div>
      ) : null}
      <div className="sg-table-scroll sg-scroll">
        <table className={'sg-table' + (compact ? ' sg-table--compact' : '')}>
          <thead>
            <tr>
              {selectable ? <th style={{ width: 44, paddingRight: 0 }}><Checkbox checked={allOn} onChange={(on) => setSelection(on ? Array.from(new Set([...sel, ...view.map((r) => r[rowKey])])) : sel.filter((k) => !view.some((r) => r[rowKey] === k)))} /></th> : null}
              {columns.map((c) => {
                const s = sort && sort.key === c.key ? sort.dir : null;
                return (
                  <th key={c.key} className={c.align === 'right' ? 'sg-num' : ''} style={{ width: c.width }} data-sortable={!!c.sortable} aria-sort={s ? (s === 'asc' ? 'ascending' : 'descending') : undefined} onClick={c.sortable ? () => toggleSort(c.key) : undefined}>
                    {c.label}
                    {c.sortable ? <Icon name={s === 'asc' ? 'arrow-up' : s === 'desc' ? 'arrow-down' : 'chevrons-up-down'} size={13} /> : null}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: Math.min(pageSize, 5) }).map((_, i) => (
                  <tr key={i}>{selectable ? <td /> : null}{columns.map((c) => <td key={c.key}><Skeleton width={c.align === 'right' ? 60 : '70%'} /></td>)}</tr>
                ))
              : view.map((r) => {
                  const k = r[rowKey];
                  const on = sel.includes(k);
                  return (
                    <tr key={k} aria-selected={on || undefined} onClick={onRowClick ? () => onRowClick(r) : undefined} style={onRowClick ? { cursor: 'pointer' } : undefined}>
                      {selectable ? <td style={{ paddingRight: 0 }} onClick={(e) => e.stopPropagation()}><Checkbox checked={on} onChange={(v) => setSelection(v ? [...sel, k] : sel.filter((x) => x !== k))} /></td> : null}
                      {columns.map((c) => <td key={c.key} className={c.align === 'right' ? 'sg-num' : ''}>{c.render ? c.render(r) : r[c.key]}</td>)}
                    </tr>
                  );
                })}
          </tbody>
        </table>
        {!loading && !view.length ? (
          q || fv ? <EmptyState kind="search" compact title="Không tìm thấy kết quả" description={'Không có ' + itemLabel + ' phù hợp với bộ lọc hiện tại.'} /> : <EmptyState compact title={emptyTitle} />
        ) : null}
      </div>
      <div className="sg-table-foot">
        <span>Hiển thị <b style={{ color: 'var(--text-1)' }}>{data.length ? (p - 1) * pageSize + 1 : 0}–{Math.min(p * pageSize, data.length)}</b> trên <b style={{ color: 'var(--text-1)' }}>{data.length.toLocaleString('vi-VN')}</b> {itemLabel}</span>
        <nav className="sg-pager" aria-label="Phân trang">
          <button type="button" className="sg-pager__btn" disabled={p <= 1} onClick={() => setPage(p - 1)} aria-label="Trang trước"><Icon name="chevron-left" size={16} /></button>
          {pages(p, total).map((n, i) => (n === '…' ? <span key={'e' + i} style={{ padding: '0 4px' }}>…</span> : <button key={n} type="button" className="sg-pager__btn" aria-current={n === p ? 'page' : undefined} onClick={() => setPage(n)}>{n}</button>))}
          <button type="button" className="sg-pager__btn" disabled={p >= total} onClick={() => setPage(p + 1)} aria-label="Trang sau"><Icon name="chevron-right" size={16} /></button>
        </nav>
      </div>
    </div>
  );
}
