import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { CODE_MESSAGE, CODE_RE, Trim } from '../dto/dto-helpers';

// FV-4A §2: chỉ các trường này; trường lạ (scope, deleted, page, pageSize, columns, format…) => 400 (forbidNonWhitelisted toàn cục).
export class ExportCustomersDto {
  @IsIn(['filtered', 'selected'], { message: 'mode phải là filtered hoặc selected' })
  mode!: 'filtered' | 'selected';

  @IsOptional() @Trim() @IsString() @MinLength(2, { message: 'search phải có ít nhất 2 ký tự' }) @MaxLength(100)
  search?: string;

  @IsOptional() @Matches(CODE_RE, { message: CODE_MESSAGE }) @MaxLength(60)
  status?: string;
  @IsOptional() @Matches(CODE_RE, { message: CODE_MESSAGE }) @MaxLength(60)
  tier?: string;
  @IsOptional() @Matches(CODE_RE, { message: CODE_MESSAGE }) @MaxLength(60)
  industry?: string;
  @IsOptional() @Matches(CODE_RE, { message: CODE_MESSAGE }) @MaxLength(60)
  source?: string;
  @IsOptional() @Matches(CODE_RE, { message: CODE_MESSAGE }) @MaxLength(60)
  province?: string;

  @IsOptional() @IsUUID('all', { message: 'ownerId không hợp lệ' })
  ownerId?: string;

  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ArrayUnique() @IsUUID('all', { each: true, message: 'ids phải là uuid' })
  ids?: string[];
}
