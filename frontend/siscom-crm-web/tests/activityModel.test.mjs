// Run: node --test tests/activityModel.test.mjs   (Node >= 18, không dependency). B3 A7: hàm thuần cho tab Hoạt động
// (giờ Việt Nam, loại theo quyền, kiểm tra biểu mẫu, thân POST). Không mạng, không DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dtVN } from '../src/data/util.js';
import { allowedTypes, activityVisual, vnLocalToIso, isoToVnLocal, validateDraft, buildCreateBody, detailsToFieldErrors, TYPE_META, editDraftOf, buildPatchBody } from '../src/features/activities/activityModel.js';

const can = (...keys) => (a) => keys.includes(a);

test('dtVN: "HH:mm dd/mm/yyyy" theo giờ Việt Nam, không phụ thuộc máy', () => {
  assert.equal(dtVN('2026-11-05T02:30:00.000Z'), '09:30 05/11/2026');
  assert.equal(dtVN('2026-12-31T17:05:00Z'), '00:05 01/01/2027'); // qua ngày + qua năm theo giờ VN
  assert.equal(dtVN('2026-11-05T09:30:00+07:00'), '09:30 05/11/2026');
});

test('dtVN: rỗng / không hợp lệ => "—"', () => {
  for (const v of ['', null, undefined, 'abc']) assert.equal(dtVN(v), '—');
});

test('allowedTypes: activity.create => 6 loại; chỉ create_tech => 3 loại kỹ thuật; không quyền => rỗng; can thiếu => rỗng', () => {
  assert.deepEqual(allowedTypes(can('activity.create')), ['CALL', 'EMAIL', 'MEETING', 'SITE_SURVEY', 'NOTE', 'TASK']);
  assert.deepEqual(allowedTypes(can('activity.create_tech')), ['SITE_SURVEY', 'NOTE', 'TASK']);
  assert.deepEqual(allowedTypes(can('activity.read')), []);
  assert.deepEqual(allowedTypes(undefined), []);
});

test('activityVisual: biểu tượng/tone theo thiết kế §8; TASK quá hạn => error', () => {
  const now = Date.parse('2026-11-05T03:00:00Z');
  assert.deepEqual(activityVisual({ type: 'CALL', status: 'DONE' }, now), { icon: 'phone', tone: 'blue' });
  assert.deepEqual(activityVisual({ type: 'EMAIL', status: 'DONE' }, now), { icon: 'mail', tone: 'neutral' });
  assert.deepEqual(activityVisual({ type: 'MEETING', status: 'DONE' }, now), { icon: 'users', tone: 'success' });
  assert.deepEqual(activityVisual({ type: 'SITE_SURVEY', status: 'DONE' }, now), { icon: 'hard-hat', tone: 'warning' });
  assert.deepEqual(activityVisual({ type: 'NOTE', status: 'DONE' }, now), { icon: 'sticky-note', tone: 'neutral' });
  assert.deepEqual(activityVisual({ type: 'TASK', status: 'OPEN', dueAt: '2026-11-06T00:00:00Z' }, now), { icon: 'square-check', tone: 'blue' });
  assert.deepEqual(activityVisual({ type: 'TASK', status: 'OPEN', dueAt: '2026-11-05T02:59:00Z' }, now), { icon: 'square-check', tone: 'error' });
  assert.deepEqual(activityVisual({ type: 'TASK', status: 'DONE', dueAt: '2026-11-01T00:00:00Z' }, now), { icon: 'square-check', tone: 'success' });
  assert.deepEqual(activityVisual({ type: 'TASK', status: 'CANCELLED', dueAt: '2026-11-01T00:00:00Z' }, now), { icon: 'square-check', tone: 'neutral' });
  assert.equal(Object.keys(TYPE_META).length, 6);
});

test('vnLocalToIso / isoToVnLocal: giờ nhập là giờ Việt Nam, gửi kèm +07:00', () => {
  assert.equal(vnLocalToIso('2026-11-05T09:30'), '2026-11-05T09:30:00+07:00');
  assert.equal(vnLocalToIso(''), null);
  assert.equal(vnLocalToIso('2026-13-05T09:30'), null);
  assert.equal(vnLocalToIso('05/11/2026 09:30'), null);
  assert.equal(isoToVnLocal('2026-11-05T02:30:00.000Z'), '2026-11-05T09:30');
  assert.equal(isoToVnLocal('2026-12-31T17:05:00Z'), '2027-01-01T00:05');
});

test('validateDraft: nội dung bắt buộc; TASK cần hạn; nhắc không sau hạn; độ dài tối đa như máy chủ', () => {
  assert.deepEqual(validateDraft({ type: 'CALL', content: '  ' }), { content: 'Vui lòng nhập nội dung' });
  assert.deepEqual(validateDraft({ type: 'TASK', content: 'x' }), { dueAt: 'Công việc phải có hạn' });
  assert.deepEqual(validateDraft({ type: 'TASK', content: 'x', dueAt: '2026-11-06T09:00', remindAt: '2026-11-06T10:00' }), { remindAt: 'Thời điểm nhắc phải không sau hạn' });
  assert.deepEqual(validateDraft({ type: 'TASK', content: 'x', dueAt: '2026-11-06T09:00', remindAt: '2026-11-06T08:00' }), {});
  assert.ok(validateDraft({ type: 'NOTE', content: 'a'.repeat(4001) }).content);
  assert.ok(validateDraft({ type: 'MEETING', content: 'x', title: 'a'.repeat(201) }).title);
  assert.ok(validateDraft({ type: 'CALL', content: 'x', outcome: 'a'.repeat(2001) }).outcome);
  assert.deepEqual(validateDraft({ type: 'CALL', content: 'Gọi chào giá' }), {});
});

test('buildCreateBody: chỉ gửi trường đúng loại; TASK không gửi occurredAt; giờ kèm +07:00; trường trống bị bỏ', () => {
  assert.deepEqual(buildCreateBody({ type: 'CALL', content: ' Gọi chào giá ', title: 'bị bỏ', outcome: ' Hẹn tuần sau ', occurredAt: '2026-11-05T09:30', dueAt: '2026-11-06T09:00', contactId: '', performedById: '' }),
    { type: 'CALL', content: 'Gọi chào giá', outcome: 'Hẹn tuần sau', occurredAt: '2026-11-05T09:30:00+07:00' });
  assert.deepEqual(buildCreateBody({ type: 'TASK', content: 'Gửi báo giá', title: ' Báo giá ', occurredAt: '2026-11-05T09:30', dueAt: '2026-11-06T17:00', remindAt: '2026-11-06T08:00', outcome: 'bị bỏ', performedById: 'e2' }),
    { type: 'TASK', content: 'Gửi báo giá', title: 'Báo giá', dueAt: '2026-11-06T17:00:00+07:00', remindAt: '2026-11-06T08:00:00+07:00', performedById: 'e2' });
  assert.deepEqual(buildCreateBody({ type: 'NOTE', content: 'Ghi chú', contactId: 'c1' }), { type: 'NOTE', content: 'Ghi chú', contactId: 'c1' });
});

test('detailsToFieldErrors: chi tiết lỗi 400 của máy chủ gắn đúng ô; phần còn lại đưa vào extra', () => {
  const r = detailsToFieldErrors(['content must be shorter', 'Công việc (TASK) phải có hạn (dueAt).', 'Thời điểm diễn ra không được quá 1 ngày sau hiện tại (trừ lịch hẹn MEETING).', 'lạ']);
  assert.equal(r.fieldErrors.content, 'content must be shorter');
  assert.equal(r.fieldErrors.dueAt, 'Công việc (TASK) phải có hạn (dueAt).');
  assert.match(r.fieldErrors.occurredAt, /1 ngày/);
  assert.deepEqual(r.extra, ['lạ']);
});

test('editDraftOf: điền sẵn theo giờ VN; trường trống thành chuỗi rỗng', () => {
  const a = { type: 'TASK', title: 'Gửi báo giá', content: 'VRV', outcome: null, occurredAt: '2026-11-05T01:00:00.000Z', dueAt: '2026-11-06T10:00:00.000Z', remindAt: null, contact: null, version: 3 };
  assert.deepEqual(editDraftOf(a), { type: 'TASK', title: 'Gửi báo giá', content: 'VRV', outcome: '', occurredAt: '2026-11-05T08:00', dueAt: '2026-11-06T17:00', remindAt: '' });
});

test('buildPatchBody: chỉ gửi trường đã đổi; không đổi gì => {}; giờ kèm +07:00', () => {
  const a = { type: 'TASK', title: 'Gửi báo giá', content: 'VRV', outcome: null, occurredAt: '2026-11-05T01:00:00.000Z', dueAt: '2026-11-06T10:00:00.000Z', remindAt: null, version: 3 };
  const d = editDraftOf(a);
  assert.deepEqual(buildPatchBody(a, d), {});
  assert.deepEqual(buildPatchBody(a, { ...d, dueAt: '2026-11-07T09:00' }), { dueAt: '2026-11-07T09:00:00+07:00' });
  assert.deepEqual(buildPatchBody(a, { ...d, content: '  VRV mới ', remindAt: '2026-11-06T08:00' }), { content: 'VRV mới', remindAt: '2026-11-06T08:00:00+07:00' });
  assert.deepEqual(buildPatchBody(a, { ...d, title: '  ' }), { title: null });
  assert.deepEqual(buildPatchBody(a, { ...d, occurredAt: '2026-11-01T08:00' }), {}); // TASK không sửa thời điểm diễn ra
});

test('buildPatchBody: MEETING bỏ hạn/nhắc => null; CALL đổi thời điểm + xoá kết quả => null', () => {
  const m = { type: 'MEETING', title: 'Họp', content: 'x', outcome: 'ok', occurredAt: '2026-11-05T01:00:00.000Z', dueAt: '2026-11-06T10:00:00.000Z', remindAt: '2026-11-06T09:00:00.000Z', version: 1 };
  assert.deepEqual(buildPatchBody(m, { ...editDraftOf(m), dueAt: '', remindAt: '' }), { dueAt: null, remindAt: null });
  const c = { type: 'CALL', title: null, content: 'Gọi', outcome: 'Hẹn', occurredAt: '2026-11-05T01:00:00.000Z', dueAt: null, remindAt: null, version: 2 };
  assert.deepEqual(buildPatchBody(c, { ...editDraftOf(c), occurredAt: '2026-11-05T09:30', outcome: '' }), { outcome: null, occurredAt: '2026-11-05T09:30:00+07:00' });
  assert.deepEqual(buildPatchBody(c, { ...editDraftOf(c), title: 'bị bỏ', dueAt: '2026-11-06T09:00' }), {}); // CALL không có tiêu đề/hạn
});
