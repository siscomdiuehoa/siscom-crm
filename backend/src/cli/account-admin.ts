import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, openSync, unlinkSync, writeSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import type { ConfigService } from '@nestjs/config';
import { AccountAdmin, AccountAdminError, assertTargetUrl, handoverText, parseArgs, ParsedArgs } from '../modules/auth/account-admin';
import { PrismaService } from '../prisma/prisma.service';

// FV-5: node dist/cli/account-admin.js <add|reset-password|disable|list> [tham số]  (sau npm run build; xem docs/FV5_ACCOUNT_ADMIN.md).
// Kết nối: MIGRATE_DATABASE_URL (chủ sở hữu, siscom_migrator). Không đọc .env, không in mật khẩu/URL. DB thật chỉ khi Owner duyệt riêng (--allow-db).

// Tạo file bàn giao MỚI (không ghi đè), chỉ người chạy có quyền: tạo rỗng -> khoá ACL (Windows: icacls) -> mới ghi nội dung.
export function createPrivateFile(path: string): { path: string; fd: number } {
  const full = resolve(path);
  if (existsSync(full)) throw new AccountAdminError('OUT_EXISTS', 'file --out đã tồn tại, không ghi đè: ' + full);
  const fd = openSync(full, 'wx', 0o600);
  if (process.platform === 'win32') {
    const user = process.env.USERNAME;
    try {
      if (!user) throw new Error('thiếu USERNAME');
      execFileSync('icacls', [full, '/inheritance:r', '/grant:r', user + ':F'], { stdio: 'ignore', windowsHide: true });
    } catch {
      closeSync(fd); try { unlinkSync(full); } catch { /* bỏ qua */ }
      throw new AccountAdminError('OUT_ACL', 'không đặt được quyền "chỉ người chạy" cho file --out; đã huỷ.');
    }
  }
  return { path: full, fd };
}

async function confirm(a: ParsedArgs, dbName: string): Promise<void> {
  if (a.command === 'list' || a.yes) return;
  if (!process.stdin.isTTY) throw new AccountAdminError('CONFIRM', 'không có bàn phím để xác nhận; thêm --yes nếu chạy bằng script đã được duyệt.');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const typed = (await rl.question('Thao tác ' + a.command + ' sẽ GHI vào database "' + dbName + '". Gõ lại tên database để tiếp tục: ')).trim();
    if (typed !== dbName) throw new AccountAdminError('CONFIRM', 'tên gõ lại không khớp; huỷ, không ghi gì.');
  } finally { rl.close(); }
}

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  const url = process.env.MIGRATE_DATABASE_URL;
  if (!url) throw new AccountAdminError('INPUT', 'thiếu biến môi trường MIGRATE_DATABASE_URL (chủ sở hữu DB).');
  const target = assertTargetUrl(url, a.allowDb);
  const prisma = new PrismaService({ getOrThrow: () => url } as unknown as ConfigService);
  let out: { path: string; fd: number } | null = null;
  try {
    const tool = new AccountAdmin(prisma);
    const dbName = await tool.preflight(a.allowDb);
    if (dbName !== target.dbName) throw new AccountAdminError('DB_REFUSED', 'database thực tế khác URL.');
    if (a.command === 'list') {
      for (const r of await tool.list()) console.log([r.code, r.fullName, r.email ?? '', r.department ?? '', r.roles, r.status, r.login ?? 'chưa có', r.mustChange ? 'phải đổi MK' : ''].join(' | '));
      return;
    }
    await confirm(a, dbName);
    if (a.command === 'disable') {
      const r = await tool.disable(a);
      console.log('Đã khoá đăng nhập ' + r.code + ' (mọi phiên bị thu hồi) trên ' + dbName + '.');
      return;
    }
    out = createPrivateFile(a.out!);
    const issued = a.command === 'add' ? await tool.add(a) : await tool.resetPassword(a);
    writeSync(out.fd, handoverText(issued, dbName), null, 'utf8');
    closeSync(out.fd);
    const saved = out.path; out = null;
    console.log((a.command === 'add' ? 'Đã tạo tài khoản ' : 'Đã đặt lại mật khẩu ') + issued.code + ' (' + issued.email + ') trên ' + dbName + '. Mật khẩu tạm KHÔNG in; đã ghi vào: ' + saved);
  } finally {
    if (out) { try { closeSync(out.fd); } catch { /* bỏ qua */ } try { unlinkSync(out.path); } catch { /* bỏ qua */ } } // thao tác lỗi => không để file rỗng/dở
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    // Không in stack/URL; thông điệp DB có thể chứa uuid nhưng không chứa mật khẩu (mật khẩu không bao giờ nằm trong câu lệnh lỗi trả về).
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Thất bại: ' + msg.replace(/postgres(ql)?:\/\/\S+/g, '<url>'));
    process.exit(1);
  });
}
