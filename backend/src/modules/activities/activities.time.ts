// B3 (thiết kế §7): mọi mốc lưu UTC; RANH GIỚI NGÀY tính theo giờ Việt Nam (Asia/Ho_Chi_Minh = UTC+7 cố định, không giờ mùa hè).
// Một helper duy nhất cho mọi bộ lọc theo ngày (A5: from/to của timeline; A6: due=today|week, chuông). Khoảng nửa mở [start, end).
export const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// 'YYYY-MM-DD' (ngày VN) => mốc UTC của 00:00 giờ VN ngày đó. Ngày không tồn tại (2026-02-30) => null.
export function vnDayStart(ymd: string): Date | null {
  const m = YMD_RE.exec(ymd);
  if (!m) return null;
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  const utc = Date.UTC(y, mo - 1, d);
  const chk = new Date(utc);
  if (chk.getUTCFullYear() !== y || chk.getUTCMonth() !== mo - 1 || chk.getUTCDate() !== d) return null;
  return new Date(utc - VN_OFFSET_MS);
}

// Ngày VN chứa thời điểm `at` => [00:00 VN, 00:00 VN hôm sau).
export function vnDayRange(at: Date): { start: Date; end: Date } {
  const local = at.getTime() + VN_OFFSET_MS;
  const startLocal = local - (((local % DAY_MS) + DAY_MS) % DAY_MS);
  const start = new Date(startLocal - VN_OFFSET_MS);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

// Bộ lọc from/to theo NGÀY VN, nửa mở: from => >= 00:00 VN của from; to => < 00:00 VN của NGÀY SAU to (bao trọn ngày to).
export function vnDateFilter(from?: string, to?: string): { gte?: Date; lt?: Date } | null {
  const f: { gte?: Date; lt?: Date } = {};
  if (from !== undefined) { const s = vnDayStart(from); if (!s) return null; f.gte = s; }
  if (to !== undefined) { const s = vnDayStart(to); if (!s) return null; f.lt = new Date(s.getTime() + DAY_MS); }
  return f;
}
