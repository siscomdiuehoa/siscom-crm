import React, { useRef, useState } from 'react';
import { Icon } from '../core/Icon.jsx';
import { IconButton } from '../core/IconButton.jsx';

const TYPES = {
  pdf: { icon: 'file-text', bg: 'var(--error-soft)', fg: 'var(--error-text)' },
  xlsx: { icon: 'file-spreadsheet', bg: 'var(--success-soft)', fg: 'var(--success-text)' },
  docx: { icon: 'file-text', bg: 'var(--primary-soft)', fg: 'var(--primary-text)' },
  dwg: { icon: 'layers', bg: 'var(--accent-soft)', fg: 'var(--accent-text)' },
  img: { icon: 'file-image', bg: 'var(--warning-soft)', fg: 'var(--warning-text)' },
  other: { icon: 'file', bg: 'var(--neutral-soft)', fg: 'var(--neutral-text)' },
};
function typeOf(name = '') {
  const ext = name.split('.').pop().toLowerCase();
  if (ext === 'pdf') return 'pdf';
  if (ext === 'xls' || ext === 'xlsx' || ext === 'csv') return 'xlsx';
  if (ext === 'doc' || ext === 'docx') return 'docx';
  if (ext === 'dwg' || ext === 'dxf' || ext === 'rvt') return 'dwg';
  if (['png', 'jpg', 'jpeg', 'webp'].indexOf(ext) >= 0) return 'img';
  return 'other';
}

export function FileItem({ name, size, meta, progress, status, onRemove, actions }) {
  const t = TYPES[typeOf(name)];
  return (
    <div className="sg-file">
      <span className="sg-file__ic" style={{ background: t.bg, color: t.fg }}><Icon name={t.icon} size={18} /></span>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div className="sg-file__name">{name}</div>
        {progress != null && progress < 100 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div className="sg-progress" style={{ flex: 1 }}><div className="sg-progress__bar" style={{ width: progress + '%' }} /></div>
            <span className="sg-file__meta sg-num">{progress}%</span>
          </div>
        ) : (
          <div className="sg-file__meta">{[size, meta].filter(Boolean).join(' · ')}{status === 'error' ? <span style={{ color: 'var(--error-text)' }}> · Tải lên thất bại</span> : null}</div>
        )}
      </div>
      {status === 'done' ? <Icon name="circle-check" size={18} color="var(--success)" /> : null}
      {actions}
      {onRemove ? <IconButton icon="x" label="Xoá tệp" size="sm" onClick={onRemove} /> : null}
    </div>
  );
}

export function FileUpload({ title = 'Kéo thả tệp vào đây hoặc bấm để chọn', hint = 'PDF, DOCX, XLSX, DWG · tối đa 50 MB mỗi tệp', accept, multiple = true, onFiles, files = [], compact = false }) {
  const [drag, setDrag] = useState(false);
  const input = useRef(null);
  const take = (list) => onFiles && onFiles(Array.from(list || []));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div
        className="sg-drop"
        data-drag={drag}
        role="button"
        tabIndex={0}
        style={compact ? { flexDirection: 'row', padding: '14px 16px', textAlign: 'left' } : undefined}
        onClick={() => input.current && input.current.click()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') input.current && input.current.click(); }}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); take(e.dataTransfer.files); }}
      >
        <span className="sg-drop__icon"><Icon name="cloud-upload" size={22} /></span>
        <div>
          <div style={{ font: 'var(--fw-semibold) var(--fs-sm)/20px var(--font-sans)', color: 'var(--text-1)' }}>{title}</div>
          <div style={{ font: 'var(--type-caption)', color: 'var(--text-3)', marginTop: 2 }}>{hint}</div>
        </div>
        <input ref={input} type="file" hidden accept={accept} multiple={multiple} onChange={(e) => take(e.target.files)} />
      </div>
      {files.map((f, i) => <FileItem key={f.name + i} {...f} />)}
    </div>
  );
}
