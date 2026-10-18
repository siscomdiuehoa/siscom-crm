import React, { useState } from 'react';
import { fmtCompact, seriesColor } from './chartUtils.js';

export function DonutChart({ data = [], size = 168, thickness = 18, centerLabel, centerValue, format = fmtCompact, legend = 'right' }) {
  const [hi, setHi] = useState(null);
  const total = data.reduce((a, d) => a + d.value, 0) || 1;
  const r = (size - thickness) / 2, C = 2 * Math.PI * r, gap = data.length > 1 ? 3 : 0;
  let acc = 0;
  const cur = hi != null ? data[hi] : null;
  return (
    <div style={{ display: 'flex', flexDirection: legend === 'bottom' ? 'column' : 'row', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
      <div style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={size / 2} cy={size / 2} r={r} style={{ fill: 'none', stroke: 'var(--surface-sunken)', strokeWidth: thickness }} />
          {data.map((d, i) => {
            const len = Math.max(0, (d.value / total) * C - gap);
            const el = <circle key={i} cx={size / 2} cy={size / 2} r={r} onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)} style={{ fill: 'none', stroke: seriesColor(d, i), strokeWidth: hi === i ? thickness + 4 : thickness, strokeDasharray: len + ' ' + (C - len), strokeDashoffset: -acc, strokeLinecap: 'butt', transition: 'stroke-width var(--dur-fast) var(--ease-out)', cursor: 'pointer' }} />;
            acc += (d.value / total) * C;
            return el;
          })}
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', pointerEvents: 'none' }}>
          <span style={{ font: 'var(--type-caption)', color: 'var(--text-3)' }}>{cur ? cur.name : centerLabel}</span>
          <span className="sg-num" style={{ font: 'var(--fw-semibold) 20px/28px var(--font-sans)', letterSpacing: '-.02em', color: 'var(--text-1)' }}>{cur ? Math.round((cur.value / total) * 100) + '%' : centerValue}</span>
        </div>
      </div>
      {legend ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minWidth: 160 }}>
          {data.map((d, i) => (
            <div key={i} onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)} style={{ display: 'flex', alignItems: 'center', gap: 10, font: 'var(--type-sm)', opacity: hi == null || hi === i ? 1 : 0.5, transition: 'opacity var(--dur-fast)' }}>
              <span className="sg-legend__sw" style={{ background: seriesColor(d, i), margin: 0, width: 10, height: 10, borderRadius: 3 }} />
              <span style={{ flex: 1, color: 'var(--text-2)' }}>{d.name}</span>
              <b className="sg-num" style={{ fontWeight: 600 }}>{format(d.value)}</b>
              <span className="sg-num" style={{ color: 'var(--text-3)', width: 38, textAlign: 'right' }}>{Math.round((d.value / total) * 100)}%</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
