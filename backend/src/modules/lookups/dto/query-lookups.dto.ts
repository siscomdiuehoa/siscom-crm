import { Matches, MaxLength } from 'class-validator';

// `type` bắt buộc, danh sách phân cách dấu phẩy. Không có includeInactive (gửi => 400 do whitelist).
export class QueryLookupsDto {
  @Matches(/^[a-z][a-z0-9_]*(,[a-z][a-z0-9_]*)*$/, { message: 'type phải là danh sách loại danh mục phân cách bằng dấu phẩy.' }) @MaxLength(200)
  type!: string;
}
