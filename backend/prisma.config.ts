// Prisma 7: URL ket noi nam o day (khong con trong schema.prisma). Moi lenh prisma deu can bien DATABASE_URL (file .env).
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: env('DATABASE_URL') },
});
