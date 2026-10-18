// Mã danh mục MẶC ĐỊNH khi POST không gửi tier/status. GIÁ TRỊ ĐỀ XUẤT — phải khớp mã sẽ seed ở bước seed danh mục (D3, chưa làm).
// Nếu mã chưa tồn tại trong lookup_item, tạo khách không gửi tier/status trả 400 LOOKUP_INVALID (không tự tạo danh mục).
export const DEFAULT_TIER_CODE = 'POTENTIAL';
export const DEFAULT_STATUS_CODE = 'POTENTIAL';

export const LOOKUP_TYPES = {
  tier: 'customer_tier',
  status: 'customer_status',
  industry: 'industry',
  source: 'source',
  province: 'province',
} as const;
export type LookupKey = keyof typeof LOOKUP_TYPES;

export const SORT_FIELDS = ['code', 'name', 'createdAt', 'updatedAt', 'tier', 'status', 'relevance'] as const;
export const MAX_OFFSET_WINDOW = 100000;
