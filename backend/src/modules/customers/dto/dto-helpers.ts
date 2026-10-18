import { Transform, TransformFnParams } from 'class-transformer';
import { ValidateIf } from 'class-validator';

export const CODE_RE = /^[A-Z0-9][A-Z0-9_]*$/;
export const CODE_MESSAGE = 'Mã danh mục không hợp lệ (chữ HOA, số, gạch dưới).';

export const Trim = () => Transform(({ value }: TransformFnParams) => (typeof value === 'string' ? value.trim() : value));
export const TrimEach = () => Transform(({ value }: TransformFnParams) => (Array.isArray(value) ? value.map((v: unknown) => (typeof v === 'string' ? v.trim() : v)) : value));
// Bỏ qua các kiểm tra còn lại khi giá trị là undefined/null/'' (trường tuỳ chọn; rỗng = không có).
export const SkipIfBlank = () => ValidateIf((_o: unknown, v: unknown) => v !== undefined && v !== null && v !== '');
// Chỉ bỏ qua khi KHÔNG gửi; null/'' vẫn bị các kiểm tra sau từ chối (trường không được xoá).
export const SkipIfUndefined = () => ValidateIf((_o: unknown, v: unknown) => v !== undefined);
