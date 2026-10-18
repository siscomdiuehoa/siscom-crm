export interface LinksCheckResult {
  verified: boolean;
  unchecked: string[];
}

// Kiểm tra liên kết nghiệp vụ trước khi xoá (hợp đồng, báo giá, dự án, cơ hội).
export interface ActiveLinksChecker {
  check(customerId: string): Promise<LinksCheckResult>;
}
export const ACTIVE_LINKS_CHECKER = Symbol('ACTIVE_LINKS_CHECKER');

// Các bảng liên kết CHƯA tồn tại nên KHÔNG kiểm được. Triển khai này KHÔNG BAO GIỜ trả kết quả "đã xác minh",
// và không có cấu hình nào đổi điều đó: DELETE luôn bị khoá (409 DELETE_LINKS_UNVERIFIED) cho tới khi có checker thật.
export class UnverifiedLinksChecker implements ActiveLinksChecker {
  async check(): Promise<LinksCheckResult> {
    return { verified: false, unchecked: ['contract', 'quote', 'project', 'opportunity'] };
  }
}
