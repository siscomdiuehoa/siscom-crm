import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { UpdateActivityDto } from '../../activities/dto/task-actions.dto';
import { UpdateContactDto } from './update-contact.dto';
import { UpdateCustomerDto } from './update-customer.dto';

// Rà soát 10/11/2026 (B2): @IsOptional() bỏ qua cả null => null lọt tới Prisma trên cột NOT NULL => 500 thay vì 400.
// Yêu cầu: null bị từ chối ở tầng DTO (400); không gửi (undefined) vẫn hợp lệ; giá trị đúng vẫn hợp lệ.
async function errs<T extends object>(cls: new () => T, plain: object): Promise<ValidationError[]> {
  return validate(plainToInstance(cls, plain) as object, { whitelist: true, forbidNonWhitelisted: true });
}
const props = (e: ValidationError[]) => e.map((x) => x.property);

describe('null trên trường không được xoá => lỗi kiểm tra đầu vào', () => {
  it('UpdateActivityDto.content: null bị từ chối; không gửi và chuỗi hợp lệ thì qua', async () => {
    expect(props(await errs(UpdateActivityDto, { version: 1, content: null }))).toContain('content');
    expect(props(await errs(UpdateActivityDto, { version: 1 }))).not.toContain('content');
    expect(props(await errs(UpdateActivityDto, { version: 1, content: 'Đã gọi lại khách' }))).not.toContain('content');
  });
  it('UpdateCustomerDto.tags: null bị từ chối; không gửi, mảng rỗng và mảng hợp lệ thì qua', async () => {
    expect(props(await errs(UpdateCustomerDto, { version: 1, tags: null }))).toContain('tags');
    expect(props(await errs(UpdateCustomerDto, { version: 1 }))).not.toContain('tags');
    expect(props(await errs(UpdateCustomerDto, { version: 1, tags: [] }))).not.toContain('tags');
    expect(props(await errs(UpdateCustomerDto, { version: 1, tags: ['vip'] }))).not.toContain('tags');
  });
  it('UpdateContactDto.isPrimary: null bị từ chối; không gửi và true/false thì qua', async () => {
    expect(props(await errs(UpdateContactDto, { version: 1, isPrimary: null }))).toContain('isPrimary');
    expect(props(await errs(UpdateContactDto, { version: 1 }))).not.toContain('isPrimary');
    expect(props(await errs(UpdateContactDto, { version: 1, isPrimary: false }))).not.toContain('isPrimary');
  });
});
