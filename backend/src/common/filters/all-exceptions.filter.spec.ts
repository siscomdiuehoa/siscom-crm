import { ArgumentsHost, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { DomainException } from '../errors/domain.exception';
import { AllExceptionsFilter } from './all-exceptions.filter';

function run(exception: unknown, url = '/api/v1/x?secret=1') {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const req = { originalUrl: url, method: 'GET', requestId: 'rid-1' };
  const host = { switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }) } as unknown as ArgumentsHost;
  new AllExceptionsFilter().catch(exception, host);
  return { status: res.status.mock.calls[0][0] as number, body: res.json.mock.calls[0][0] as Record<string, any> };
}

describe('AllExceptionsFilter (B1.2.3, cộng thêm vào B1.1)', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('giữ nguyên các trường B1.1 và thêm error.code', () => {
    const { status, body } = run(new NotFoundException());
    expect(status).toBe(404);
    expect(body.statusCode).toBe(404);
    expect(body.message).toBe('Không tìm thấy đường dẫn yêu cầu.');
    expect(body.path).toBe('/api/v1/x');
    expect(body.requestId).toBe('rid-1');
    expect(typeof body.timestamp).toBe('string');
    expect(body.error).toEqual({ code: 'NOT_FOUND', message: 'Không tìm thấy đường dẫn yêu cầu.' });
  });
  it('400 từ ValidationPipe: details là mảng ở cả hai nơi', () => {
    const { body } = run(new BadRequestException(['tên quá ngắn', 'thiếu điện thoại']));
    expect(body.details).toEqual(['tên quá ngắn', 'thiếu điện thoại']);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details).toEqual(['tên quá ngắn', 'thiếu điện thoại']);
  });
  it('DomainException: mã và thông điệp riêng; details đối tượng chỉ nằm trong error', () => {
    const { status, body } = run(new DomainException(409, 'CUSTOMER_DUPLICATE_TAX_ID', 'Trùng MST.', { visibleConflict: null }));
    expect(status).toBe(409);
    expect(body.message).toBe('Trùng MST.');
    expect(body.error).toEqual({ code: 'CUSTOMER_DUPLICATE_TAX_ID', message: 'Trùng MST.', details: { visibleConflict: null } });
    expect(body.details).toBeUndefined();
  });
  it('lỗi lạ -> 500 thông điệp chung, không lộ nội dung', () => {
    const { status, body } = run(new Error('postgresql://u:pw@127.0.0.1/db password=hunter2'));
    expect(status).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(body)).not.toMatch(/postgres|hunter2|password|stack/i);
  });
  it('lỗi Prisma nhận diện được -> lỗi nghiệp vụ, không lộ tên constraint', () => {
    const { status, body } = run({ code: 'P2002', message: 'Unique constraint failed uq_customer_tax_id_active', meta: { target: ['uq_customer_tax_id_active'] } });
    expect(status).toBe(409);
    expect(body.error.code).toBe('CUSTOMER_DUPLICATE_TAX_ID');
    expect(JSON.stringify(body)).not.toMatch(/uq_customer|constraint failed/i);
  });
});
