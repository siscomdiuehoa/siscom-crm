import { Inject, Injectable } from '@nestjs/common';
import type { RequestCtx } from '../../common/auth/actor';
import { ARGON2_ALGO, ARGON2_PARAMS, Argon2PasswordHasher } from '../../common/auth/login/argon2.hasher';
import { checkPasswordPolicy } from '../../common/auth/login/password-policy';
import { AcctPrismaService } from '../../prisma/acct-prisma.service';
import { LoginLimiter } from '../auth/login-limiter';
import { accountErrors } from './accounts.errors';
import { accountAudit, approved, findSystemRequester, inAcctTx, lockEmployee, setTempPassword } from './accounts.flow';
import type { AcctTx, PasswordSecret } from './accounts.flow';
import { AccountsReadService } from './accounts.read.service';
import type { AccountRow } from './accounts.read.service';
import { GRANTABLE_ROLE_CODES } from './dto/query-accounts.dto';
import type { ChangeRoleDto, CreateAccountDto, DisableAccountDto, TempPasswordDto, UpdateAccountDto } from './dto/write-account.dto';

// P1 Task 5 (docs/P1_ACCOUNT_ADMIN_DESIGN.md §6.2, §6.3): SÁU thao tác ghi của trang Tài khoản, mỗi thao tác một lần bấm.
// Khuôn chung của mọi thao tác:
//   gate(ctx)        — access.approve, rồi giới hạn tần suất (trước khi chạm database);
//   kiểm dữ liệu     — câu tiếng Việt; băm mật khẩu tạm NGOÀI transaction (tốn CPU);
//   inAcctTx         — khoá theo nhân viên, đọc dòng hiện tại, tự chặn (chính mình / tài khoản hệ thống / sai trạng thái),
//                      gọi hàm đặc quyền theo đúng người đứng tên (accounts.flow.ts), ghi nhật ký người bấm, trả dòng sau thao tác.
// Lỗi ở bất kỳ bước nào => rollback toàn bộ: không còn nhân viên dở, credential dở hay yêu cầu PENDING / APPROVED nào.
// Mật khẩu tạm chỉ tồn tại trong bộ nhớ của request: không ghi log, không vào nhật ký, không trả lại.
const NAME_MAX = 200;
const EMAIL_MAX = 254;
const TITLE_MAX = 120;
const REASON_MAX = 200;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// Vai trò mà việc gỡ phải đi qua yêu cầu ROLE_REVOKE_CRITICAL (giữ access.approve). `admin` không bao giờ được đổi qua giao diện.
const CRITICAL_ROLE = 'crm_admin';
// Bộ giới hạn tần suất của các thao tác ghi (provider riêng để bộ kiểm thử thay bằng hạn mức khác).
export const ACCOUNTS_WRITE_LIMITER = Symbol('ACCOUNTS_WRITE_LIMITER');
// Trần theo NGƯỜI BẤM: 30 thao tác ghi / phút — đủ cho việc quản trị, chặn vòng lặp tự động tạo tài khoản hàng loạt.
export const createAccountsWriteLimiter = (): LoginLimiter => new LoginLimiter({ windowMs: 60_000, maxPerSource: 30, maxPerIdentifier: 30 });

interface Profile { fullName: string; email: string; departmentId: string | null; positionTitle: string | null }

@Injectable()
export class AccountsWriteService {
  private readonly hasher = new Argon2PasswordHasher();

  constructor(
    private readonly acct: AcctPrismaService,
    private readonly reads: AccountsReadService,
    @Inject(ACCOUNTS_WRITE_LIMITER) private readonly limiter: LoginLimiter,
  ) {}

  private gate(ctx: RequestCtx): void {
    this.reads.requireManager(ctx);
    // Nguồn đếm = chính người bấm (đã xác thực): hạn mức của người này không ảnh hưởng người khác.
    if (!this.limiter.allow('p1-accounts:' + ctx.actor.employeeId, null)) throw accountErrors.rateLimited();
  }

  // ───── Thêm nhân viên ─────
  async create(ctx: RequestCtx, dto: CreateAccountDto): Promise<AccountRow> {
    this.gate(ctx);
    const clicker = ctx.actor.employeeId;
    const errs: string[] = [];
    const p = this.profile(dto, errs);
    if (!(GRANTABLE_ROLE_CODES as readonly string[]).includes(dto.role)) errs.push('Vai trò không hợp lệ.');
    errs.push(...this.passwordProblems(dto.tempPassword, { email: p.email, code: null }));
    if (errs.length) throw accountErrors.validation(errs);
    const secret = await this.secret(dto.tempPassword);
    return inAcctTx(this.acct, async (tx) => {
      const sys = await findSystemRequester(tx);
      const roleId = await this.roleId(tx, dto.role);
      await this.requireDepartment(tx, p.departmentId);
      const made = await tx.$queryRaw<{ id: string }[]>`
        SELECT public.fn_acct_api_employee_create(${clicker}::uuid, ${p.fullName}, ${p.email}, ${p.departmentId}::uuid, ${p.positionTitle}) AS id`;
      const id = made[0]?.id;
      if (!id) throw new Error('P1: không tạo được nhân viên.');
      const row = await this.reads.rowById(tx, id, clicker);
      // Mã nhân viên chỉ có sau khi tạo: mật khẩu tạm cũng không được chứa nó (cùng chính sách với đổi mật khẩu). Vi phạm => rollback.
      const withCode = this.passwordProblems(dto.tempPassword, { email: p.email, code: row.code });
      if (withCode.length) throw accountErrors.validation(withCode);
      await tx.$executeRaw`SELECT public.fn_auth_api_credential_create(${sys}::uuid, ${id}::uuid)`;
      const grant = await approved(tx, sys, clicker, 'ROLE_GRANT', id, roleId);
      await tx.$executeRaw`SELECT public.fn_auth_api_role_grant(${sys}::uuid, ${grant}::uuid)`;
      await setTempPassword(tx, sys, clicker, id, secret);
      await accountAudit(tx, clicker, 'ACCOUNT_CREATE', id, { role: dto.role });
      return this.reads.rowById(tx, id, clicker);
    });
  }

  // ───── Sửa họ tên / email / phòng ban / chức danh (khoá lạc quan theo updatedAt; không qua yêu cầu phê duyệt) ─────
  async update(ctx: RequestCtx, id: string, dto: UpdateAccountDto): Promise<AccountRow> {
    this.gate(ctx);
    const clicker = ctx.actor.employeeId;
    const errs: string[] = [];
    const p = this.profile(dto, errs);
    const expected = new Date(dto.updatedAt);
    if (Number.isNaN(expected.getTime())) errs.push('updatedAt không hợp lệ.');
    if (errs.length) throw accountErrors.validation(errs);
    return inAcctTx(this.acct, async (tx) => {
      await lockEmployee(tx, id);
      const row = await this.reads.rowById(tx, id, clicker);
      if (row.isSystem) throw accountErrors.systemAccount();
      await this.requireDepartment(tx, p.departmentId);
      await tx.$queryRaw`
        SELECT public.fn_acct_api_employee_update(${clicker}::uuid, ${id}::uuid, ${expected.toISOString()}::timestamptz, ${p.fullName}, ${p.email}, ${p.departmentId}::uuid, ${p.positionTitle})`;
      return this.reads.rowById(tx, id, clicker);
    });
  }

  // ───── Đổi vai trò (mỗi nhân viên một vai trò trên giao diện): cấp vai trò mới rồi gỡ vai trò cũ, cùng transaction ─────
  async changeRole(ctx: RequestCtx, id: string, dto: ChangeRoleDto): Promise<AccountRow> {
    this.gate(ctx);
    const clicker = ctx.actor.employeeId;
    if (!(GRANTABLE_ROLE_CODES as readonly string[]).includes(dto.role)) throw accountErrors.validation(['Vai trò không hợp lệ.']);
    return inAcctTx(this.acct, async (tx) => {
      await lockEmployee(tx, id);
      const row = await this.target(tx, id, clicker);
      if (row.roles.length !== 1) throw accountErrors.multiRole();
      const from = row.roles[0];
      if (from === dto.role) throw accountErrors.validation(['Tài khoản đang giữ đúng vai trò này.']);
      const sys = await findSystemRequester(tx);
      const toId = await this.roleId(tx, dto.role);
      const fromId = await this.roleId(tx, from);
      const grant = await approved(tx, sys, clicker, 'ROLE_GRANT', id, toId);
      await tx.$executeRaw`SELECT public.fn_auth_api_role_grant(${sys}::uuid, ${grant}::uuid)`;
      // Gỡ vai trò trọng yếu cần yêu cầu riêng (database tiêu thụ nó trong trigger); vai trò nghiệp vụ thì không (truyền NULL).
      const revoke = from === CRITICAL_ROLE ? await approved(tx, sys, clicker, 'ROLE_REVOKE_CRITICAL', id, fromId) : null;
      await tx.$executeRaw`SELECT public.fn_auth_api_role_revoke(${sys}::uuid, ${id}::uuid, ${fromId}::uuid, ${revoke}::uuid)`;
      await accountAudit(tx, clicker, 'ACCOUNT_ROLE_CHANGE', id, { from, to: dto.role });
      return this.reads.rowById(tx, id, clicker);
    });
  }

  // ───── Cấp lại mật khẩu (tài khoản đang dùng): thu hồi mọi phiên, buộc đổi ở lần đăng nhập tới ─────
  async resetPassword(ctx: RequestCtx, id: string, dto: TempPasswordDto): Promise<AccountRow> {
    this.gate(ctx);
    const clicker = ctx.actor.employeeId;
    const early = this.passwordProblems(dto.tempPassword, { email: null, code: null });
    if (early.length) throw accountErrors.validation(early);
    const secret = await this.secret(dto.tempPassword);
    return inAcctTx(this.acct, async (tx) => {
      await lockEmployee(tx, id);
      const row = await this.target(tx, id, clicker);
      if (row.login === 'DISABLED') throw accountErrors.state('Tài khoản đang bị khoá. Hãy dùng "Mở lại tài khoản".');
      if (row.login === 'NONE') throw accountErrors.state('Tài khoản chưa có mật khẩu. Hãy dùng "Mở lại tài khoản" để cấp mật khẩu.');
      this.requirePolicy(dto.tempPassword, row);
      const sys = await findSystemRequester(tx);
      await setTempPassword(tx, sys, clicker, id, secret);
      await accountAudit(tx, clicker, 'ACCOUNT_PASSWORD_RESET', id, null);
      return this.reads.rowById(tx, id, clicker);
    });
  }

  // ───── Khoá đăng nhập: người đó bị đăng xuất ngay; bản ghi nhân viên, khách hàng, lịch sử giữ nguyên ─────
  async disable(ctx: RequestCtx, id: string, dto: DisableAccountDto): Promise<AccountRow> {
    this.gate(ctx);
    const clicker = ctx.actor.employeeId;
    const reason = typeof dto.reason === 'string' ? dto.reason.trim() : '';
    if (reason.length < 1 || reason.length > REASON_MAX) throw accountErrors.validation(['Lý do khoá cần từ 1 đến ' + REASON_MAX + ' ký tự.']);
    return inAcctTx(this.acct, async (tx) => {
      await lockEmployee(tx, id);
      const row = await this.target(tx, id, clicker);
      if (row.login === 'DISABLED') throw accountErrors.state('Tài khoản đã bị khoá từ trước.');
      if (row.login === 'NONE') throw accountErrors.state('Tài khoản chưa có mật khẩu nên không có gì để khoá.');
      const sys = await findSystemRequester(tx);
      await tx.$queryRaw`SELECT public.fn_auth_api_credential_disable(${sys}::uuid, ${id}::uuid, ${reason})`;
      await accountAudit(tx, clicker, 'ACCOUNT_DISABLE', id, { reason });
      return this.reads.rowById(tx, id, clicker);
    });
  }

  // ───── Mở lại (tài khoản đã khoá hoặc chưa có mật khẩu): luôn kèm mật khẩu tạm mới ─────
  async enable(ctx: RequestCtx, id: string, dto: TempPasswordDto): Promise<AccountRow> {
    this.gate(ctx);
    const clicker = ctx.actor.employeeId;
    const early = this.passwordProblems(dto.tempPassword, { email: null, code: null });
    if (early.length) throw accountErrors.validation(early);
    const secret = await this.secret(dto.tempPassword);
    return inAcctTx(this.acct, async (tx) => {
      await lockEmployee(tx, id);
      const row = await this.target(tx, id, clicker);
      if (row.login === 'ACTIVE' || row.login === 'MUST_CHANGE') throw accountErrors.state('Tài khoản đang dùng bình thường, không cần mở lại.');
      this.requirePolicy(dto.tempPassword, row);
      const sys = await findSystemRequester(tx);
      if (row.login === 'NONE') await tx.$executeRaw`SELECT public.fn_auth_api_credential_create(${sys}::uuid, ${id}::uuid)`;
      await setTempPassword(tx, sys, clicker, id, secret);
      await accountAudit(tx, clicker, 'ACCOUNT_ENABLE', id, null);
      return this.reads.rowById(tx, id, clicker);
    });
  }

  // ───── Dùng chung ─────
  // Dòng đích của thao tác trên quyền / mật khẩu / khoá: không phải chính mình, không phải tài khoản hệ thống. Database cũng chặn (TWO_PERSON,
  // SELF_MODIFICATION) ở các thao tác có yêu cầu; riêng khoá không có kiểm đó trong database nên máy chủ PHẢI tự chặn ở đây.
  private async target(tx: AcctTx, id: string, clicker: string): Promise<AccountRow> {
    const row = await this.reads.rowById(tx, id, clicker);
    if (row.isSelf) throw accountErrors.selfModification();
    if (row.isSystem) throw accountErrors.systemAccount();
    return row;
  }

  private profile(dto: { fullName: string; email: string; departmentId?: string | null; positionTitle?: string | null }, errs: string[]): Profile {
    const fullName = typeof dto.fullName === 'string' ? dto.fullName.trim() : '';
    const email = typeof dto.email === 'string' ? dto.email.trim() : '';
    const title = typeof dto.positionTitle === 'string' ? dto.positionTitle.trim() : '';
    if (fullName.length < 1 || fullName.length > NAME_MAX) errs.push('Họ tên cần từ 1 đến ' + NAME_MAX + ' ký tự.');
    if (email.length < 1 || email.length > EMAIL_MAX || !EMAIL_RE.test(email)) errs.push('Email không hợp lệ.');
    if (title.length > TITLE_MAX) errs.push('Chức danh tối đa ' + TITLE_MAX + ' ký tự.');
    return { fullName, email, departmentId: dto.departmentId ?? null, positionTitle: title === '' ? null : title };
  }

  // Thông điệp của chính sách mật khẩu (không bao giờ chứa mật khẩu).
  private passwordProblems(pw: unknown, who: { email: string | null; code: string | null }): string[] {
    return typeof pw === 'string' ? checkPasswordPolicy(pw, who) : ['Chưa nhập mật khẩu tạm.'];
  }

  private requirePolicy(pw: string, row: AccountRow): void {
    const problems = this.passwordProblems(pw, { email: row.email, code: row.code });
    if (problems.length) throw accountErrors.validation(problems);
  }

  private async secret(pw: string): Promise<PasswordSecret> {
    return { hash: await this.hasher.hash(pw), algo: ARGON2_ALGO, params: { ...ARGON2_PARAMS } };
  }

  private async roleId(tx: AcctTx, code: string): Promise<string> {
    const r = await tx.role.findFirst({ where: { code, isConfirmed: true }, select: { id: true } });
    if (!r) throw accountErrors.validation(['Vai trò "' + code + '" chưa sẵn sàng trong hệ thống.']);
    return r.id;
  }

  private async requireDepartment(tx: AcctTx, departmentId: string | null): Promise<void> {
    if (departmentId === null) return;
    const d = await tx.department.findFirst({ where: { id: departmentId, isActive: true }, select: { id: true } });
    if (!d) throw accountErrors.validation(['Phòng ban không tồn tại hoặc đã đóng.']);
  }
}
