import React, { useId } from 'react';
import { Icon } from '../core/Icon.jsx';
import { Skeleton } from '../feedback/Skeleton.jsx';

const TONES = {
  blue: ['var(--primary-soft)', 'var(--primary)'], cyan: ['var(--accent-soft)', 'var(--accent)'], success: ['var(--success-soft)', 'var(--success)'],
  warning: ['var(--warning-soft)', 'var(--warning)'], error: ['var(--error-soft)', 'var(--error)'], navy: ['var(--surface-inverse)', 'var(--text-inverse)'],
};

function Spark({ data, color }) {
  const uid = useId().replace(/:/g, '');
  if (!data || data.length < 2) return null;
  const mx = Math.max(...data), mn = Math.min(...data), rg = mx - mn || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * 100, 34 - ((v - mn) / rg) * 30]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0] + ',' + p[1]).join(' ');
  return (
    <svg viewBox="0 0 100 36" preserveAspectRatio="none" style={{ width: '100%', height: 36, display: 'block' }} aria-hidden="true">
      <defs><linearGradient id={uid} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" style={{ stopColor: color, stopOpacity: 0.25 }} /><stop offset="100%" style={{ stopColor: color, stopOpacity: 0 }} /></linearGradient></defs>
      <path d={d + ' L100,36 L0,36 Z'} style={{ fill: 'url(#' + uid + ')' }} />
      <path d={d} vectorEffect="non-scaling-stroke" style={{ fill: 'none', stroke: color, strokeWidth: 2, strokeLinejoin: 'round' }} />
    </svg>
  );
}

export function KpiCard({ label, value, unit, delta, deltaLabel = 'so với tháng trước', icon, tone = 'blue', spark, invertDelta = false, variant = 'glass', loading = false, onClick }) {
  const t = TONES[tone] || TONES.blue;
  const surf = variant === 'solid' ? 'sg-solid' : 'sg-glass';
  if (loading) {
    return (
      <div className={'sg-card sg-kpi ' + surf}>
        <div className="sg-kpi__top"><Skeleton width={110} /><Skeleton circle height={36} /></div>
        <Skeleton width="60%" height={30} />
        <Skeleton width="80%" height={12} />
      </div>
    );
  }
  const dir = delta == null ? null : delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  const good = dir === 'flat' ? 'flat' : (dir === 'up') !== invertDelta ? 'up' : 'down';
  return (
    <div className={'sg-card sg-kpi ' + surf + (onClick ? ' sg-card--interactive' : '')} onClick={onClick}>
      <div className="sg-kpi__top">
        <span className="sg-kpi__label">{label}</span>
        {icon ? <span className="sg-kpi__icon" style={{ background: t[0], color: t[1] }}><Icon name={icon} size={18} /></span> : null}
      </div>
      <div className="sg-kpi__value">{value}{unit ? <span className="sg-kpi__unit">{unit}</span> : null}</div>
      {spark ? <Spark data={spark} color={t[1] === 'var(--text-inverse)' ? 'var(--primary)' : t[1]} /> : null}
      {dir ? (
        <div className="sg-kpi__foot">
          <span className={'sg-delta sg-delta--' + good}>
            <Icon name={dir === 'up' ? 'arrow-up-right' : dir === 'down' ? 'arrow-down-right' : 'minus'} size={12} />
            {(delta > 0 ? '+' : '') + Number(delta).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + '%'}
          </span>
          <span>{deltaLabel}</span>
        </div>
      ) : null}
    </div>
  );
}
