import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { validateEnv } from '../config/env.validation';
import { catalogProblems, LOOKUP_CATALOG, seedLookupCatalog, seedTargetRefusal } from '../modules/lookups/lookups.catalog';
import { PrismaService } from '../prisma/prisma.service';

// CLI seed danh mục chuẩn D3: node dist/cli/seed-lookups.js (sau npm run build). IDEMPOTENT: INSERT ... ON CONFLICT (type, code) DO NOTHING,
// chạy nhiều lần không trùng, không sửa/xoá dòng có sẵn. CHỈ chạy trên database thử (siscom_crm_test_*/restore_*; từ chối siscom_crm_dev
// và baseline đã khoá bất kể biến môi trường). Đích được đối chiếu lại bằng current_database() trước khi ghi. Không in bí mật.
async function main(): Promise<void> {
  const env = validateEnv(process.env as Record<string, unknown>);
  const url = new URL(String(env.DATABASE_URL));
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const refusal = seedTargetRefusal(dbName, process.env);
  if (refusal) throw new Error(refusal);
  const problems = catalogProblems();
  if (problems.length) throw new Error('Catalog khong hop le: ' + problems.join('; '));
  const prisma = new PrismaService({ getOrThrow: () => env.DATABASE_URL } as unknown as ConfigService);
  try {
    const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
    if (db !== dbName) throw new Error('Dang noi vao "' + db + '" thay vi "' + dbName + '". Dung lai.');
    const r = await seedLookupCatalog(prisma, LOOKUP_CATALOG);
    console.log('Seed danh muc tren ' + dbName + ': tong ' + r.total + ', chen moi ' + r.inserted + ', da co ' + r.existing + '.');
    for (const [t, v] of Object.entries(r.byType)) console.log('  ' + t.padEnd(16) + ' ' + v.present + '/' + v.total);
    if (r.inactive.length) console.log('  CANH BAO: dang is_active=false (giu nguyen): ' + r.inactive.join(', '));
    if (r.missing.length) throw new Error('Sau seed van thieu: ' + r.missing.join(', '));
    if (!r.defaultsOk) throw new Error('tier/status mac dinh (customers.defaults.ts) khong ton tai hoac khong hoat dong => POST /customers se LOOKUP_INVALID.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error('Seed that bai: ' + (err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
