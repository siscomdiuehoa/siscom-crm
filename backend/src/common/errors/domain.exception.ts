import { HttpException } from '@nestjs/common';

// Lỗi nghiệp vụ: mã ổn định (error.code) + thông điệp tiếng Việt an toàn để trả về client.
export class DomainException extends HttpException {
  constructor(status: number, public readonly code: string, message: string, public readonly details?: unknown) {
    super({ code, message }, status);
  }
}
