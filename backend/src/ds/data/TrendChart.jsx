import React, { useId, useState } from 'react';
import { useWidth, niceMax, smoothPath, fmtCompact, seriesColor } from './chartUtils.js';

export function TrendChart({ labels = [], series = [], height = 240, area = true, yTicks = 4, format = fmtCompact, axisFormat, legend = true }) {
  const [ref, w] = useWidth();
  const [hi, setHi] = useState(null);
  const uid = useId().replace(/:/g, '');
  const pad = { l: 44, r: 10, t: 10, b: 26 };
  const iw = Math.max(10, w - pad.l - pad.r), ih = height - pad.t - pad.b, n = labels.length;
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.data)));
  const x = (i) => pad.l + (n <= 1 ? iw / 2 : (i * iw) / (n - 1));
  const y = (v) => pad.t + ih - (v / max) * ih;
  const ticks = Array.from({ length: yTicks + 1 }, (_, i) => (max * i) / yTicks);
  const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(iw / 52))));
  const af = axisFormat || format;
  const move = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round((e.clientX - r.left - pad.l) / (iw / Math.max(1, n - 1)));
    setHi(Math.max(0, Math.min(n - 1, i)));
  };
  return (
    <div ref={ref} style={{ width: '100%' }}>
      {legend && series.length > 1 ? (
        <div className="sg-legend" style={{ marginBottom: 12 }}>
          {series.map((s, i) => <span key={s.name}><span className="sg-legend__sw" style={{ background: seriesColor(s, i) }} />{s.name}</span>)}
        </div>
      ) : null}
      <div className="sg-chart">
        <svg width={w} height={height} onMouseMove={move} onMouseLeave={() => setHi(null)} role="img" aria-label={series.map((s) => s.name).join(', ')}>
          <defs>
            {series.map((s, i) => (
              <linearGradient key={i} id={uid + 'g' + i} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" style={{ stopColor: seriesColor(s, i), stopOpacity: 0.22 }} />
                <stop offset="100%" style={{ stopColor: seriesColor(s, i), stopOpacity: 0 }} />
              </linearGradient>
            ))}
          </defs>
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} style={{ stroke: 'var(--chart-grid)' }} />
              <text x={pad.l - 10} y={y(t)} dy="0.32em" textAnchor="end" style={{ fill: 'var(--chart-axis)', font: '500 11px var(--font-sans)' }}>{af(t)}</text>
            </g>
          ))}
          {labels.map((l, i) => (i % every === 0 ? <text key={i} x={x(i)} y={height - 6} textAnchor="middle" style={{ fill: 'var(--chart-axis)', font: '500 11px var(--font-sans)' }}>{l}</text> : null))}
          {series.map((s, si) => {
            const pts = s.data.map((v, i) => [x(i), y(v)]);
            const d = smoothPath(pts);
            const c = seriesColor(s, si);
            return (
              <g key={si}>
                {area && !s.dashed ? <path d={d + ' L' + x(n - 1) + ',' + (pad.t + ih) + ' L' + x(0) + ',' + (pad.t + ih) + ' Z'} style={{ fill: 'url(#' + uid + 'g' + si + ')' }} /> : null}
                <path d={d} style={{ fill: 'none', stroke: c, strokeWidth: 2.25, strokeLinecap: 'round', strokeDasharray: s.dashed ? '5 5' : undefined }} />
              </g>
            );
          })}
          {hi != null ? (
            <g>
              <line x1={x(hi)} x2={x(hi)} y1={pad.t} y2={pad.t + ih} style={{ stroke: 'var(--border-strong)', strokeDasharray: '3 3' }} />
              {series.map((s, si) => <circle key={si} cx={x(hi)} cy={y(s.data[hi])} r="4.5" style={{ fill: 'var(--surface-solid)', stroke: seriesColor(s, si), strokeWidth: 2.5 }} />)}
            </g>
          ) : null}
        </svg>
        {hi != null ? (
          <div className="sg-chart__tip sg-glass-strong" style={{ left: Math.min(Math.max(x(hi), 70), w - 70), top: Math.min(...series.map((s) => y(s.data[hi]))) - 14 }}>
            <div style={{ fontWeight: 600, color: 'var(--text-1)', marginBottom: 4 }}>{labels[hi]}</div>
            {series.map((s, si) => (
              <div key={si} style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-2)' }}>
                <span className="sg-legend__sw" style={{ background: seriesColor(s, si), margin: 0 }} />
                <span style={{ flex: 1 }}>{s.name}</span>
                <b className="sg-num" style={{ color: 'var(--text-1)' }}>{format(s.data[hi])}</b>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
