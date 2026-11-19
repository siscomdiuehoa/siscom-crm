import { IsIn, IsNotEmpty, IsString, IsUrl, Matches, MaxLength } from 'class-validator';
import { Trim } from '../../customers/dto/dto-helpers';

export const DOCUMENT_KINDS = ['TECHNICAL', 'COMMERCIAL'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

// POST /opportunities/:id/documents (docs/SALES_DESIGN.md §6.14). Chỉ lưu đường dẫn + tên tệp; không tải tệp lên CRM.
export class AddOpportunityDocumentDto {
  @IsIn(DOCUMENT_KINDS, { message: 'kind phải là TECHNICAL hoặc COMMERCIAL' })
  kind!: DocumentKind;

  @Trim() @IsString() @IsNotEmpty({ message: 'Vui lòng nhập tên tệp' }) @MaxLength(255, { message: 'Tên tệp tối đa 255 ký tự' })
  fileName!: string;

  // Chỉ https, không khoảng trắng (cùng điều kiện với CHECK ck_od_url ở DB).
  @IsString() @MaxLength(1000) @Matches(/^\S+$/, { message: 'Đường dẫn không được chứa khoảng trắng' })
  @IsUrl({ protocols: ['https'], require_protocol: true }, { message: 'Đường dẫn phải là địa chỉ https hợp lệ' })
  url!: string;
}

// DELETE /opportunities/:id/documents/:docId — xoá mềm, lý do bắt buộc (ở body, không qua URL).
export class DeleteOpportunityDocumentDto {
  @Trim() @IsString() @IsNotEmpty({ message: 'Xoá tài liệu phải ghi lý do' }) @MaxLength(500, { message: 'Lý do tối đa 500 ký tự' })
  reason!: string;
}
