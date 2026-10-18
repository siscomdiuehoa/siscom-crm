import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { DomainException } from '../errors/domain.exception';
import { mapPrismaError } from '../errors/prisma-error.mapper';

const MESSAGES: Record<number, string> = {
  400: 'Dữ liệu gửi lên không hợp lệ.',
  401: 'Chưa xác thực.',
  403: 'Không có quyền thực hiện thao tác này.',
  404: 'Không tìm thấy đường dẫn yêu cầu.',
  405: 'Phương thức không được hỗ trợ.',
  413: 'Dữ liệu gửi lên quá lớn.',
  429: 'Gửi yêu cầu quá nhanh. Vui lòng thử lại sau.',
};
// B1.2.3: mã lỗi ổn định cho lỗi không phải DomainException (cộng thêm, không đổi các trường B1.1).
const CODES: Record<number, string> = {
  400: 'VALIDATION_FAILED', 401: 'UNAUTHENTICATED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT', 413: 'PAYLOAD_TOO_LARGE', 429: 'TOO_MANY_REQUESTS',
};
const FALLBACK_5XX = 'Lỗi hệ thống. Vui lòng thử lại sau.';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(raw: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { requestId?: string }>();
    // Lỗi cơ sở dữ liệu đã nhận diện được => lỗi nghiệp vụ an toàn (không lộ tên bảng/constraint).
    const exception = raw instanceof DomainException ? raw : (mapPrismaError(raw) ?? raw);
    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message: string | undefined;
    let details: unknown;
    if (exception instanceof DomainException) {
      status = exception.getStatus();
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = CODES[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED');
      const body = exception.getResponse();
      if (status === 400 && typeof body === 'object' && body !== null && Array.isArray((body as { message?: unknown }).message)) {
        details = ((body as { message: unknown[] }).message).map((m) => String(m));
      }
    }
    if (status >= 500) code = 'INTERNAL_ERROR';
    const text = status >= 500 ? FALLBACK_5XX : (message ?? MESSAGES[status] ?? 'Yêu cầu không thể xử lý.');
    const path = req.originalUrl.split('?')[0];
    if (status >= 500) {
      // Chi tiết thật (có thể chứa thông tin hạ tầng) chỉ ghi ở máy chủ, không trả về client.
      const stack = raw instanceof Error ? raw.stack : String(raw);
      this.logger.error(req.method + ' ' + path + ' -> ' + status + ' id=' + req.requestId + '\n' + stack);
    } else {
      this.logger.warn(req.method + ' ' + path + ' -> ' + status + ' ' + code + ' id=' + req.requestId);
    }
    res.status(status).json({
      statusCode: status,
      message: text,
      ...(Array.isArray(details) ? { details } : {}),
      error: { code, message: text, ...(details !== undefined ? { details } : {}) },
      path,
      timestamp: new Date().toISOString(),
      requestId: req.requestId,
    });
  }
}
