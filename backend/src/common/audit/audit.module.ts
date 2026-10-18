import { Module } from '@nestjs/common';
import { AUDIT_PORT } from './audit.port';
import { DbAuditPort } from './db-audit.port';

// B1.3.2a: nhật ký thật. Chỉ nơi này gắn AUDIT_PORT (test tĩnh bảo đảm). Customer API vẫn mặc định từ chối (401) cho tới B1.3.3.
@Module({ providers: [{ provide: AUDIT_PORT, useClass: DbAuditPort }], exports: [AUDIT_PORT] })
export class AuditModule {}
