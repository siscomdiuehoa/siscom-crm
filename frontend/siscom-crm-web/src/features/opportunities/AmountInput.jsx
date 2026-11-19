import React from 'react';
import { Input } from '../../ds/index.js';
import { amountTyping } from './opportunitiesModel.js';

// Ô nhập số tiền VNĐ: tự chèn dấu chấm ngăn nhóm hàng nghìn khi gõ (cách ghi số của văn bản hành chính / kế toán Việt Nam: 120.000.000),
// giữ đúng vị trí con trỏ. onChange nhận CHUỖI đã định dạng; giá trị gửi máy chủ vẫn lấy qua parseAmountInput (chuỗi chữ số, không đổi).
// Nội dung không phải số nguyên được giữ nguyên để kiểm tra báo lỗi (không tự đoán).
export function AmountInput({ value, onChange, ...rest }) {
  const el = React.useRef(null);
  const want = React.useRef(null);
  React.useLayoutEffect(() => {
    const e = el.current; const p = want.current; want.current = null;
    if (!e || p === null || typeof e.setSelectionRange !== 'function') return;
    if (typeof document !== 'undefined' && document.activeElement !== e) return;
    try { e.setSelectionRange(p, p); } catch (err) { /* trình duyệt không cho đặt con trỏ: bỏ qua */ }
  });
  const handle = (ev) => {
    const t = ev.target; el.current = t;
    const native = ev.nativeEvent || null;
    const r = amountTyping(value, t.value, typeof t.selectionStart === 'number' ? t.selectionStart : null, native && native.inputType);
    want.current = r.caret;
    onChange(r.text);
  };
  return <Input inputMode="numeric" autoComplete="off" value={value} onChange={handle} {...rest} />;
}
