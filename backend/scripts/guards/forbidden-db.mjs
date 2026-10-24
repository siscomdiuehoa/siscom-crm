// Nguồn sự thật DUY NHẤT cho danh sách database cấm tuyệt đối (G-04). Dùng bởi pg-dryrun-guard.mjs và identity-verifier.mjs.
// Helper THUẦN: không import gì (tránh vòng import), không đọc process.env/.env, không I/O, không DB.
// test-db-guard.ts KHÔNG import file này (giữ guard TS không import gì và chạy được dưới ts-jest CommonJS); bản sao trong đó được khóa đồng bộ bằng forbidden-db.test.mjs.
// Mọi phần tử phải ở dạng đã chuẩn hóa (chữ thường, không khoảng trắng/ngoặc kép).

/** Dev, baseline đã khóa (docs/PROGRESS_B1.2.3-B2.md), DB/role dùng chung, DB hệ thống, tên production thường gặp. */
export const FORBIDDEN_DB_NAMES = Object.freeze([
  'siscom_crm_dev',
  'siscom_crm_restore_20261014_214105',
  'siscom_crm_restore_20261015_214948',
  'siscom_app',
  'postgres',
  'template0',
  'template1',
  'siscom_crm',
  'siscom_crm_prod',
  'siscom_crm_production',
]);

const FORBIDDEN_SET = new Set(FORBIDDEN_DB_NAMES);

/**
 * Chuẩn hóa tên DB để so khớp danh sách cấm: NFKC, giải mã %xx (tối đa 3 lớp), bỏ ký tự điều khiển/độ rộng bằng không, trim, bỏ ngoặc kép bao ngoài, chữ thường.
 * @returns {string|null} null khi không phải chuỗi hoặc giải mã % lỗi.
 */
export function normalizeDbName(value) {
  if (typeof value !== 'string') return null;
  let s = value;
  try {
    for (let i = 0; i < 3 && s.includes('%'); i++) s = decodeURIComponent(s);
  } catch { return null; }
  s = s.normalize('NFKC').replace(/[\u0000-\u001f\u007f​-‏⁠﻿]/g, '').trim();
  while (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1).trim();
  return s.toLowerCase();
}

/** true nếu tên (kể cả alias/hoa-thường/khoảng trắng/%-mã hóa) là DB cấm. Mặc định từ chối: không phải chuỗi hoặc không chuẩn hóa được → true. */
export function isForbiddenDbName(value) {
  const n = normalizeDbName(value);
  return n === null || FORBIDDEN_SET.has(n);
}
