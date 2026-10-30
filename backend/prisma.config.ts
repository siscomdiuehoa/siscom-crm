// Prisma 7: URL ket noi nam o day (khong con trong schema.prisma). Moi lenh prisma deu can bien DATABASE_URL (file .env).
// B1.4 P3 (S1 tach role): lenh prisma (migrate deploy/status/diff) UU TIEN MIGRATE_DATABASE_URL (chu so huu siscom_migrator) neu dat,
// roi ve DATABASE_URL (siscom_app) khi chua tach role. Backend chay van chi dung DATABASE_URL. Khong bao gio dung tai khoan postgres.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';
import { pickPrismaCliUrl } from './src/config/migrate-url';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: pickPrismaCliUrl(process.env).url },
});
