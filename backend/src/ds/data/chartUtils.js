import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export function useWidth(initial) {
  const ref = useRef(null);
  const [w, setW] = useState(initial || 560);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => { const n = Math.max(80, Math.floor(el.getBoundingClientRect().width)); setW((p) => (p === n ? p : n)); };
    read();
    let ro;
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(read); ro.observe(el); }
    window.addEventListener('resize', read);
    return () => { if (ro) ro.disconnect(); window.removeEventListener('resize', read); };
  }, []);
  return [ref, w];
}
export function niceMax(v) {
  if (v <= 0) return 1;
  const m = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / m;
  const s = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return s * m;
}
export function smoothPath(pts) {
  if (!pts.length) return '';
  let d = 'M' + pts[0][0] + ',' + pts[0][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2, t = 0.18;
    d += ' C' + (p1[0] + (p2[0] - p0[0]) * t) + ',' + (p1[1] + (p2[1] - p0[1]) * t) + ' ' + (p2[0] - (p3[0] - p1[0]) * t) + ',' + (p2[1] - (p3[1] - p1[1]) * t) + ' ' + p2[0] + ',' + p2[1];
  }
  return d;
}
export function fmtCompact(v) {
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' tỷ';
  if (a >= 1e6) return (v / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' tr';
  if (a >= 1e3) return (v / 1e3).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + 'K';
  return Number(v).toLocaleString('vi-VN', { maximumFractionDigits: 1 });
}
export const seriesColor = (s, i) => s.color || 'var(--chart-' + ((i % 6) + 1) + ')';
