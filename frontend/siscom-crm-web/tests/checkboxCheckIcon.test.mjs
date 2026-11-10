// Lỗi hiển thị: Checkbox (ds/forms/Checkbox.jsx) LUÔN vẽ biểu tượng dấu tích bên trong .sg-check__box.
// Trước khi sửa, .sg-check__box đặt color:#fff cho cả ô CHƯA tích: ở giao diện sáng nền ô trắng nên không thấy,
// nhưng giao diện tối nền ô #0D1729 => ô chưa tích trông như đã tích (ô "Liên hệ chính", ô chọn dòng DataTable...).
// Test đọc CSS nguồn: màu biểu tượng của ô chưa tích phải trong suốt, chỉ ô đã tích mới có màu trắng.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const STYLES = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'styles');
const cssFiles = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? cssFiles(p) : (n.endsWith('.css') ? [p] : []);
});
// Bỏ chú thích; tách các luật phẳng "selector{khai báo}" (bỏ qua bọc @media: phần bên trong vẫn được quét).
const rules = cssFiles(STYLES).flatMap((f) => {
  const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  return [...src.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map((m) => ({ file: f, selectors: m[1].split(',').map((s) => s.trim().replace(/\s+/g, ' ')), body: m[2] }));
});
const colorOf = (body) => { const m = /(?:^|;)\s*color\s*:\s*([^;]+)/.exec(body); return m ? m[1].trim() : null; };
const colorsFor = (sel) => rules.filter((r) => r.selectors.includes(sel)).map((r) => colorOf(r.body)).filter(Boolean);

const UNCHECKED = '.sg-check__box';
const CHECKED = '.sg-check input:checked + .sg-check__box';

test('checkbox: ô CHƯA tích không hiện dấu tích (màu biểu tượng trong suốt)', () => {
  const colors = colorsFor(UNCHECKED);
  assert.ok(colors.length > 0, 'phải có luật đặt màu cho ' + UNCHECKED);
  assert.deepEqual([...new Set(colors)], ['transparent'], 'màu biểu tượng ô chưa tích: ' + colors.join(', '));
});

test('checkbox: ô ĐÃ tích hiện dấu tích trắng trên nền màu chính', () => {
  const colors = colorsFor(CHECKED);
  assert.deepEqual(colors, ['#fff'], 'màu biểu tượng ô đã tích: ' + colors.join(', '));
});

test('checkbox: không luật nào khác (vd. theo giao diện tối) tô màu biểu tượng ô ngoài trạng thái :checked', () => {
  const offenders = rules.flatMap((r) => r.selectors
    .filter((s) => s.endsWith('.sg-check__box') && !s.includes(':checked') && s !== UNCHECKED && colorOf(r.body))
    .map((s) => s + ' { color: ' + colorOf(r.body) + ' }'));
  assert.deepEqual(offenders, []);
});
