import React, { useState } from 'react';
import { useWidth, niceMax, fmtCompact, seriesColor } from './chartUtils.js';

export function BarChart({ labels = [], series = [], height = 240, yTicks = 4, format = fmtCompact, stacked = false, legend = true, barRadius = 5 }) {
  const [ref, w] = useWidth();
  const [hi, setHi] = useState(null);
  const pad = { l: 44, r: 6, t: 10, b: 26 };
  const iw = Math.max(10, w - pad.l - pad.r), ih = height - pad.t - pad.b, n = labels.length;
  const totals = labels.map((_, i) => series.reduce((a, s) => a + (s.data[i] || 0), 0));
  const max = niceMax(Math.max(1, ...(stacked ? totals : series.flatMap((s) => s.data))));
  const gw = iw / Math.max(1, n);
  const inner = Math.min(gw * 0.64, stacked ? 36 : 22 * series.length + 4 * (series.length - 1));
  const bw = stacked ? inner : (inner - 4 * (series.length - 1)) / series.length;
  const y = (v) => pad.t + ih - (v / max) * ih;
  const ticks = Array.from({ length: yTicks + 1 }, (_, i) => (max * i) / yTicks);
  return (
    <div ref={ref} style={{ width: '100%' }}>
      {legend && series.length > 1 ? (
        <div className="sg-legend" style={{ marginBottom: 12 }}>
          {series.map((s, i) => <span key={s.name}><span className="sg-legend__sw" style={{ background: seriesColor(s, i) }} />{s.name}</span>)}
        </div>
      ) : null}
      <div className="sg-chart">
        <svg width={w} height={height} onMouseLeave={() => setHi(null)}>
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} style={{ stroke: 'var(--chart-grid)' }} />
              <text x={pad.l - 10} y={y(t)} dy="0.32em" textAnchor="end" style={{ fill: 'var(--chart-axis)', font: '500 11px var(--font-sans)' }}>{format(t)}</text>
            </g>
          ))}
          {labels.map((l, i) => {
            const gx = pad.l + i * gw + (gw - inner) / 2;
            let acc = 0;
            return (
              <g key={i} onMouseEnter={() => setHi(i)} style={{ cursor: 'default' }}>
                <rect x={pad.l + i * gw} y={pad.t} width={gw} height={ih} style={{ fill: hi === i ? 'var(--surface-hover)' : 'transparent' }} rx="8" />
                {series.map((s, si) => {
                  const v = s.data[i] || 0;
                  const h = (v / max) * ih;
                  const bx = stacked ? gx : gx + si * (bw + 4);
                  const by = stacked ? pad.t + ih - acc - h : pad.t + ih - h;
                  acc += stacked ? h : 0;
                  return <rect key={si} x={bx} y={by} width={bw} height={Math.max(0, h)} rx={stacked && si < series.length - 1 ? 0 : barRadius} style={{ fill: seriesColor(s, si), opacity: hi == null || hi === i ? 1 : 0.55, transition: 'opacity var(--dur-fast)' }} />;
                })}
                <text x={pad.l + i * gw + gw / 2} y={height - 6} textAnchor="middle" style={{ fill: 'var(--chart-axis)', font: '500 11px var(--font-sans)' }}>{l}</text>
              </g>
            );
          })}
        </svg>
        {hi != null ? (
          <div className="sg-chart__tip sg-glass-strong" style={{ left: Math.min(Math.max(pad.l + hi * gw + gw / 2, 70), w - 70), top: y(stacked ? totals[hi] : Math.max(...series.map((s) => s.data[hi] || 0))) - 10 }}>
            <div style={{ fontWeight: 600, color: 'var(--text-1)', marginBottom: 4 }}>{labels[hi]}</div>
            {series.map((s, si) => (
              <div key={si} style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-2)' }}>
                <span className="sg-legend__sw" style={{ background: seriesColor(s, si), margin: 0 }} /><span style={{ flex: 1 }}>{s.name}</span><b className="sg-num" style={{ color: 'var(--text-1)' }}>{format(s.data[hi] || 0)}</b>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
