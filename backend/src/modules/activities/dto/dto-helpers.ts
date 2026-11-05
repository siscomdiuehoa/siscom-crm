import { Transform, TransformFnParams } from 'class-transformer';
import { ValidateIf } from 'class-validator';

// Bản cục bộ (không import nội bộ module customers — quy tắc Modular Monolith, AGENTS.md §3).
export const Trim = () => Transform(({ value }: TransformFnParams) => (typeof value === 'string' ? value.trim() : value));
// Bỏ qua các kiểm tra còn lại khi giá trị là undefined/null/'' (trường tuỳ chọn; rỗng = không có).
export const SkipIfBlank = () => ValidateIf((_o: unknown, v: unknown) => v !== undefined && v !== null && v !== '');
