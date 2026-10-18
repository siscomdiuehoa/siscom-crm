import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const logger = new Logger('HTTP');
const ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/;

// Gan X-Request-Id va ghi log moi yeu cau (khong ghi query string, header, body de tranh lo du lieu nhay cam).
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  const id = incoming && ID_PATTERN.test(incoming) ? incoming : randomUUID();
  (req as Request & { requestId?: string }).requestId = id;
  res.setHeader('X-Request-Id', id);
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    logger.log(req.method + ' ' + req.originalUrl.split('?')[0] + ' ' + res.statusCode + ' ' + ms.toFixed(1) + 'ms id=' + id);
  });
  next();
}
