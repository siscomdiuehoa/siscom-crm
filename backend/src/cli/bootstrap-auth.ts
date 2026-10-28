import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { validateEnv } from '../config/env.validation';
import { bootstrapAuth, bootstrapUsersFromEnv } from '../modules/auth/bootstrap';
import { PrismaService } from '../prisma/prisma.service';

// CLI khởi tạo xác thực MVP: node dist/cli/bootstrap-auth.js (sau npm run build). Chỉ chạy trên DB THỬ hoặc khi chủ dự án phê duyệt
// riêng cho DB thật (AGENTS.md). Từ chối siscom_crm_dev trừ khi BOOTSTRAP_ALLOW_DEV=yes (phê duyệt bằng văn bản). Không in mật khẩu.
async function main(): Promise<void> {
  const env = validateEnv(process.env as Record<string, unknown>);
  const url = new URL(String(env.DATABASE_URL));
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (dbName === 'siscom_crm_dev' && process.env.BOOTSTRAP_ALLOW_DEV !== 'yes') {
    throw new Error('TU CHOI: DATABASE_URL tro toi siscom_crm_dev. Can phe duyet rieng (BOOTSTRAP_ALLOW_DEV=yes).');
  }
  const users = bootstrapUsersFromEnv(process.env);
  const prisma = new PrismaService({ getOrThrow: () => env.DATABASE_URL } as unknown as ConfigService);
  try {
    const r = await bootstrapAuth(prisma, users);
    console.log('Khoi tao xong tren ' + dbName + ' (closed=' + r.closed + '). Tai khoan (dang nhap bang email HOAC ma NV):');
    for (const e of r.employees) console.log('  ' + e.key.padEnd(10) + ' ' + e.code + '  ' + e.email + '  vai tro=' + e.role);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error('Khoi tao that bai: ' + (err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
