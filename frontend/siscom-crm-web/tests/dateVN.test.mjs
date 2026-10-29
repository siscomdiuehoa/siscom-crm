// Run: node --test tests/dateVN.test.mjs   (Node >= 18, không dependency). D.0: API trả mốc thời gian UTC (ISO "...Z");
// giao diện hiển thị ngày theo giờ Việt Nam (Asia/Ho_Chi_Minh, UTC+7), không phụ thuộc múi giờ máy người dùng, không cắt chuỗi ISO.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dmyVN } from '../src/data/util.js';

test('dmyVN: thời điểm UTC sau 17:00 thuộc NGÀY HÔM SAU theo giờ Việt Nam', () => {
  assert.equal(dmyVN('2026-10-29T17:30:00.000Z'), '30/10/2026'); // 00:30 ngày 30/10 giờ VN
  assert.equal(dmyVN('2026-12-31T17:00:00Z'), '01/01/2027');
});

test('dmyVN: trước 17:00 UTC vẫn cùng ngày; đầu ngày UTC', () => {
  assert.equal(dmyVN('2026-10-29T16:59:59.999Z'), '29/10/2026');
  assert.equal(dmyVN('2026-10-29T00:00:00Z'), '29/10/2026');
});

test('dmyVN: chuỗi có múi giờ khác vẫn quy đúng về giờ Việt Nam', () => {
  assert.equal(dmyVN('2026-10-29T23:30:00-05:00'), '30/10/2026'); // = 04:30Z 30/10 = 11:30 giờ VN
});

test('dmyVN: rỗng / null / không hợp lệ => "—"', () => {
  assert.equal(dmyVN(''), '—');
  assert.equal(dmyVN(null), '—');
  assert.equal(dmyVN(undefined), '—');
  assert.equal(dmyVN('khong-phai-ngay'), '—');
});
