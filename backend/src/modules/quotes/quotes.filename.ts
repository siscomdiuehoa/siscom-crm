// Báo giá Q4 — tên tệp gợi ý [QB2, QB8, QB9] (docs/QUOTES_DESIGN.md mục 4.4):
//   <YYYYMMDD của quote_date>_<mã>[_v<n>]_<TenKhach>_<HangMuc>[_NHAP]      (phần mở rộng .pdf / .xlsx do nơi tải thêm vào)
// Chỉ gồm A–Z a–z 0–9 _ -; mỗi phần tên tối đa 40 ký tự, cả tên tối đa 120; phần rỗng sau chuẩn hoá => KhongTen. Hàm THUẦN.
const PART_MAX = 40;
const NAME_MAX = 120;
const EMPTY = 'KhongTen';

// Bỏ dấu tiếng Việt (kể cả ký tự gộp) + đ/Đ, viết liền kiểu PascalCase: chữ đầu mỗi từ viết hoa, phần còn lại của từ giữ nguyên (TNHH vẫn là TNHH).
export function fileNamePart(raw: string | null | undefined): string {
  const ascii = (raw ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
  const words = ascii.split(/[^A-Za-z0-9]+/).filter((w) => w.length > 0);
  const joined = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('').slice(0, PART_MAX);
  return joined.length > 0 ? joined : EMPTY;
}

export interface FileNameInput { quoteDate: string; code: string; versionNo: number; clientName: string | null; itemName: string | null; draft: boolean }
// quoteDate: 'YYYY-MM-DD' (ngày báo giá; bản nháp chưa có ngày thì nơi gọi truyền ngày hôm nay theo giờ Việt Nam).
export function suggestedFileName(i: FileNameInput): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(i.quoteDate) ? i.quoteDate.replace(/-/g, '') : '00000000';
  const code = i.code.replace(/[^A-Za-z0-9-]/g, '').slice(0, 20) || EMPTY;
  const head = date + '_' + code + (i.versionNo > 1 ? '_v' + i.versionNo : '');
  const tail = i.draft ? '_NHAP' : '';
  const client = fileNamePart(i.clientName);
  // Cả tên tối đa 120: nếu vượt thì cắt phần hạng mục (phần cuối), tối thiểu còn 1 ký tự.
  const room = NAME_MAX - (head.length + 1 + client.length + 1 + tail.length);
  const item = fileNamePart(i.itemName).slice(0, Math.max(1, room));
  return (head + '_' + client + '_' + item + tail).slice(0, NAME_MAX);
}
