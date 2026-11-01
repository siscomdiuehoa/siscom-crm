import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../../generated/prisma/client';
import { classifyRememberFailure, REMEMBER_MAX_DEVICES, rememberAbsExpiry, RememberFailure } from '../../common/auth/session/remember-token';
import { newOpaqueToken, sha256Hex } from '../../common/auth/session/session-token';
import { ipPrefix } from './client-hints';

// Thao tác DB cho remember_device (Issue #177). Mọi hàm nhận `tx` (transaction của người gọi) để cùng commit với phiên/nhật ký.
// Token chỉ tồn tại ở dạng plaintext trong bộ nhớ của lời gọi và trong cookie trả cho trình duyệt; DB chỉ có SHA-256.
export type RememberTx = Pick<PrismaClient, 'rememberDevice' | '$executeRaw'>;
export type RememberRow = NonNullable<Awaited<ReturnType<PrismaClient['rememberDevice']['findUnique']>>>;
export interface IssueParams { employeeId: string; tokenVersion: number; passwordAuthAt: Date; now: Date; ip: string | null; userAgent: string | null }
export interface Issued { token: string; maxAgeSeconds: number; familyId: string }
export type ConsumeResult = { kind: 'OK'; row: RememberRow } | { kind: RememberFailure; row: RememberRow | null };

export class RememberDevices {
  // Cấp thiết bị MỚI (login có tích nhớ). Tuần tự hoá theo nhân viên bằng advisory lock rồi áp giới hạn: thiết bị thứ N+1 thay thế thiết bị ít dùng gần nhất.
  async issue(tx: RememberTx, p: IssueParams, token: string = newOpaqueToken()): Promise<Issued> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'remember:' + p.employeeId}))`;
    // QA lần 3 Minor-4: hàng "ma" (token con chèn song song với lệnh thu hồi family) => thu hồi nốt, không tính vào giới hạn.
    const dead = await this.revokedFamilies(tx, p.employeeId, p.now);
    if (dead.size > 0) {
      await tx.rememberDevice.updateMany({ where: { employeeId: p.employeeId, familyId: { in: [...dead] }, revokedAt: null }, data: { revokedAt: p.now, revokeReason: 'FAMILY_REVOKED' } });
    }
    const active = (await tx.rememberDevice.findMany({
      where: { employeeId: p.employeeId, rotatedAt: null, revokedAt: null, absExpiresAt: { gt: p.now } },
      orderBy: { lastUsedAt: 'asc' }, select: { familyId: true },
    })).filter((r) => !dead.has(r.familyId));
    const excess = active.length - (REMEMBER_MAX_DEVICES - 1);
    if (excess > 0) {
      await tx.rememberDevice.updateMany({ where: { familyId: { in: active.slice(0, excess).map((r) => r.familyId) }, revokedAt: null }, data: { revokedAt: p.now, revokeReason: 'DEVICE_LIMIT' } });
    }
    return this.insert(tx, p, token, randomUUID(), rememberAbsExpiry(p.passwordAuthAt));
  }

  // Rotation: token con CÙNG family, CÙNG mốc tuyệt đối (không gia hạn), CÙNG mốc nhập mật khẩu gốc.
  async rotate(tx: RememberTx, old: RememberRow, p: { now: Date; ip: string | null; userAgent: string | null }): Promise<Issued> {
    const issued = await this.insert(tx, { employeeId: old.employeeId, tokenVersion: old.tokenVersion, passwordAuthAt: old.passwordAuthAt, now: p.now, ip: p.ip, userAgent: p.userAgent },
      newOpaqueToken(), old.familyId, old.absExpiresAt);
    await tx.rememberDevice.update({ where: { id: old.id }, data: { replacedById: issued.rowId } });
    return { token: issued.token, maxAgeSeconds: issued.maxAgeSeconds, familyId: issued.familyId };
  }

  private async insert(tx: RememberTx, p: IssueParams, token: string, familyId: string, absExpiresAt: Date): Promise<Issued & { rowId: string }> {
    const row = await tx.rememberDevice.create({
      data: {
        employeeId: p.employeeId, familyId, tokenHash: sha256Hex(token), tokenVersion: p.tokenVersion, passwordAuthAt: p.passwordAuthAt, absExpiresAt,
        issuedAt: p.now, lastUsedAt: p.now, ipPrefix: ipPrefix(p.ip), uaShort: p.userAgent ? p.userAgent.slice(0, 200) : null,
      },
      select: { id: true },
    });
    return { token, familyId, rowId: row.id, maxAgeSeconds: Math.max(1, Math.floor((absExpiresAt.getTime() - p.now.getTime()) / 1000)) };
  }

  // Compare-and-set nguyên tử: chỉ MỘT lời gọi chuyển được rotated_at từ NULL (PostgreSQL READ COMMITTED: yêu cầu song song chờ khoá dòng
  // rồi đánh giá lại điều kiện => 0 hàng). Thua => phân loại INVALID / RACE / REPLAY (chưa đổi gì; việc thu hồi do người gọi quyết định).
  async consume(tx: RememberTx, token: string, now: Date): Promise<ConsumeResult> {
    const tokenHash = sha256Hex(token);
    const won = await tx.rememberDevice.updateMany({ where: { tokenHash, rotatedAt: null, revokedAt: null, absExpiresAt: { gt: now } }, data: { rotatedAt: now, lastUsedAt: now } });
    const row = await tx.rememberDevice.findUnique({ where: { tokenHash } });
    if (won.count === 1) return row ? { kind: 'OK', row } : { kind: 'INVALID', row: null };
    return { kind: classifyRememberFailure(row, now), row };
  }

  async revokeFamily(tx: RememberTx, familyId: string, reason: string, now: Date): Promise<number> {
    return (await tx.rememberDevice.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: now, revokeReason: reason } })).count;
  }

  // Thu hồi chuỗi của một token. employeeId != null => chỉ khi token thuộc đúng nhân viên đó (logout không thu hồi token của người khác).
  // Trả { employeeId, familyId } của thiết bị đã thu hồi (để người gọi thu hồi phiên đã khôi phục từ nó — câu 3), hoặc null.
  async revokeByToken(tx: RememberTx, token: string, employeeId: string | null, reason: string, now: Date): Promise<{ employeeId: string; familyId: string } | null> {
    const row = await tx.rememberDevice.findUnique({ where: { tokenHash: sha256Hex(token) } });
    if (!row || (employeeId !== null && row.employeeId !== employeeId)) return null;
    await this.revokeFamily(tx, row.familyId, reason, now);
    return { employeeId: row.employeeId, familyId: row.familyId };
  }

  // Thu hồi mọi thiết bị của nhân viên; trả số THIẾT BỊ đang hoạt động đã bị thu hồi.
  async revokeAll(tx: RememberTx, employeeId: string, reason: string, now: Date): Promise<number> {
    const active = await tx.rememberDevice.findMany({ where: { employeeId, rotatedAt: null, revokedAt: null }, select: { familyId: true } });
    await tx.rememberDevice.updateMany({ where: { employeeId, revokedAt: null }, data: { revokedAt: now, revokeReason: reason } });
    return active.length;
  }

  // Thu hồi MỘT thiết bị của chính nhân viên. id không tồn tại / của người khác / đã thu hồi => false (không phân biệt).
  async revokeOne(tx: RememberTx, employeeId: string, familyId: string, reason: string, now: Date): Promise<boolean> {
    const active = await tx.rememberDevice.findMany({ where: { employeeId, familyId, rotatedAt: null, revokedAt: null }, select: { id: true } });
    if (active.length === 0) return false;
    await tx.rememberDevice.updateMany({ where: { employeeId, familyId, revokedAt: null }, data: { revokedAt: now, revokeReason: reason } });
    return true;
  }

  // Mốc thu hồi phiên khi phát hiện REPLAY trên family ĐÃ bị thu hồi (QA lần 3b Important-A, lần 3c Minor-1); null nếu family chưa thu hồi.
  // Mốc = max(MIN(revoked_at), MAX(rotated_at)): mọi phiên tái lập từ family có issued_at = rotated_at của một hàng (consume và newSession
  // dùng chung `now`), và sau khi family bị thu hồi không còn rotated_at nào được commit (CAS cần revoked_at IS NULL; hàng "ma" thắng CAS thì
  // trigger chặn token con => rollback). Lệnh thu hồi chốt `now` trước lần xoay vòng song song vẫn được phủ. Phiên nạn nhân đăng nhập lại
  // SAU mốc không bị đăng xuất lặp lại.
  async familyRevokedAt(db: Pick<PrismaClient, 'rememberDevice'>, familyId: string): Promise<Date | null> {
    const rows = await db.rememberDevice.findMany({ where: { familyId }, select: { revokedAt: true, rotatedAt: true } });
    let minRevoked: number | null = null; let maxRotated: number | null = null;
    for (const r of rows) {
      if (r.revokedAt !== null && (minRevoked === null || r.revokedAt.getTime() < minRevoked)) minRevoked = r.revokedAt.getTime();
      if (r.rotatedAt !== null && (maxRotated === null || r.rotatedAt.getTime() > maxRotated)) maxRotated = r.rotatedAt.getTime();
    }
    return minRevoked === null ? null : new Date(Math.max(minRevoked, maxRotated ?? minRevoked));
  }

  // Family của nhân viên đã có ít nhất một hàng bị thu hồi (coi như thu hồi cả family; trigger DB cũng chặn xoay vòng tiếp).
  // QA lần 3b Minor-B: chỉ family còn hạn (family hết hạn không còn hàng hoạt động nào cần lọc); Set để tra O(1).
  private async revokedFamilies(db: Pick<PrismaClient, 'rememberDevice'>, employeeId: string, now: Date): Promise<Set<string>> {
    const rows = await db.rememberDevice.findMany({ where: { employeeId, revokedAt: { not: null }, absExpiresAt: { gt: now } }, select: { familyId: true } });
    return new Set(rows.map((r) => r.familyId));
  }

  async list(db: Pick<PrismaClient, 'rememberDevice'>, employeeId: string, currentToken: string | null, now: Date) {
    const currentHash = currentToken === null ? null : sha256Hex(currentToken);
    const dead = await this.revokedFamilies(db, employeeId, now);
    const rows = (await db.rememberDevice.findMany({ where: { employeeId, rotatedAt: null, revokedAt: null, absExpiresAt: { gt: now } }, orderBy: { lastUsedAt: 'desc' } }))
      .filter((r) => !dead.has(r.familyId));
    return rows.map((r) => ({ id: r.familyId, uaShort: r.uaShort, ipPrefix: r.ipPrefix, issuedAt: r.issuedAt, lastUsedAt: r.lastUsedAt, expiresAt: r.absExpiresAt, current: currentHash !== null && r.tokenHash === currentHash }));
  }
}
