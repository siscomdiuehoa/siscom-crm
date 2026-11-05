import { vnDateFilter, vnDayRange, vnDayStart } from './activities.time';

// Thiết kế §7: test biên 23:59, 00:00, 06:59 giờ VN (06:59 VN = 23:59 UTC hôm trước).
describe('giờ Việt Nam (UTC+7) cho ranh giới ngày', () => {
  it('vnDayStart: 00:00 VN = 17:00 UTC hôm trước', () => {
    expect(vnDayStart('2026-11-05')?.toISOString()).toBe('2026-11-04T17:00:00.000Z');
  });
  it('vnDayStart: ngày không tồn tại / sai định dạng => null', () => {
    for (const v of ['2026-02-30', '2026-13-01', '2026-1-5', '05/11/2026', '']) expect(vnDayStart(v)).toBeNull();
    expect(vnDayStart('2028-02-29')).not.toBeNull(); // năm nhuận
  });
  it('vnDayRange: 23:59 VN, 00:00 VN, 06:59 VN thuộc đúng ngày VN', () => {
    // 23:59 VN ngày 05/11 = 16:59 UTC 05/11
    expect(vnDayRange(new Date('2026-11-05T16:59:00Z'))).toEqual({ start: new Date('2026-11-04T17:00:00Z'), end: new Date('2026-11-05T17:00:00Z') });
    // 00:00 VN ngày 06/11 = 17:00 UTC 05/11 => thuộc ngày 06/11
    expect(vnDayRange(new Date('2026-11-05T17:00:00Z')).start).toEqual(new Date('2026-11-05T17:00:00Z'));
    // 06:59 VN ngày 06/11 = 23:59 UTC 05/11 => vẫn ngày 06/11 (ngày UTC là 05/11)
    expect(vnDayRange(new Date('2026-11-05T23:59:00Z')).start).toEqual(new Date('2026-11-05T17:00:00Z'));
  });
  it('vnDateFilter: from/to bao trọn ngày VN, nửa mở; sai ngày => null', () => {
    expect(vnDateFilter('2026-11-01', '2026-11-05')).toEqual({ gte: new Date('2026-10-31T17:00:00Z'), lt: new Date('2026-11-05T17:00:00Z') });
    expect(vnDateFilter(undefined, undefined)).toEqual({});
    expect(vnDateFilter('2026-02-30')).toBeNull();
  });
});
