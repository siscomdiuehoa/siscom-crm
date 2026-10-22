import 'reflect-metadata';
import type { ExecutionContext } from '@nestjs/common';
import { DomainException } from '../../errors/domain.exception';
import { newSecret, sha256Hex, SECRET_RE } from './grant-secret';
import { PrivilegedApiClient, PRIVILEGED_OPS, privilegedOpSql, toDomainError } from './privileged-api.client';
import { PrivilegedReadyGuard } from './privileged-ready.guard';
import { SessionBoundActor } from './privileged.types';
import { parseGrantHeader, PRIV_GRANT_HEADER, RESOLVE_GRANT_SQL, SessionGrantVerifier } from './session-grant.verifier';

// F-01 giai đoạn 2 — TOÀN BỘ test dùng mock trong bộ nhớ: KHÔNG kết nối PostgreSQL, không .env.
// "Đạt" ở đây chỉ chứng minh logic phía Node (phân tích bằng chứng, từ chối, tham số gắn). KHÔNG chứng minh hàm SQL hay quyền DB thật (UNVERIFIED).

const SID = 'f1397400-0000-4000-8000-000000000001';
const EMP_DB = 'f1397200-0000-4000-8000-000000000001';
const EMP_OTHER = 'f1397200-0000-4000-8000-000000000002';
const GRANT = newSecret();
const reqOf = (headers: Record<string, unknown>, body: unknown = {}) => ({ headers, body, query: {} }) as never;

describe('grant-secret', () => {
  it('newSecret: 256 bit base64url (43 ký tự), khớp regex hàm SQL, không trùng', () => {
    const a = newSecret();
    expect(a).toMatch(SECRET_RE);
    expect(a).toHaveLength(43);
    expect(new Set(Array.from({ length: 200 }, () => newSecret())).size).toBe(200);
  });
  it('sha256Hex khớp vector chuẩn (abc)', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('parseGrantHeader (bằng chứng, không phải danh tính)', () => {
  it('chấp nhận <uuid>.<grant>', () => {
    expect(parseGrantHeader(`${SID}.${GRANT}`)).toEqual({ sessionId: SID, grant: GRANT });
    expect(parseGrantHeader(`${SID.toUpperCase()}.${GRANT}`)?.sessionId).toBe(SID);
  });
  it.each([
    ['thiếu', undefined],
    ['mảng (header lặp)', [`${SID}.${GRANT}`]],
    ['không có dấu chấm', SID + GRANT],
    ['uuid sai', `not-a-uuid.${GRANT}`],
    ['grant quá ngắn', `${SID}.abc`],
    ['grant chứa ký tự lạ', `${SID}.${'a'.repeat(42)}+`],
    ['grant chứa dấu chấm thừa', `${SID}.${'a'.repeat(30)}.${'b'.repeat(30)}`],
    ['hai header nối bằng dấu phẩy', `${SID}.${GRANT}, ${SID}.${GRANT}`],
    ['khoảng trắng', ` ${SID}.${GRANT}`],
    ['số', 42],
  ])('từ chối: %s', (_n, v) => {
    expect(parseGrantHeader(v)).toBeNull();
  });
});

describe('SessionGrantVerifier', () => {
  const ok = () => jest.fn().mockResolvedValue([{ employee_id: EMP_DB }]);

  it('chạy đúng câu SQL cố định với tham số GẮN; danh tính chỉ từ kết quả DB', async () => {
    const run = ok();
    const v = new SessionGrantVerifier(run);
    expect(v.dbVerifiable).toBe(true);
    const bound = await v.verify(reqOf({ [PRIV_GRANT_HEADER]: `${SID}.${GRANT}` }));
    expect(bound).toEqual({ employeeId: EMP_DB, departmentId: null, proof: GRANT, sessionId: SID });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(RESOLVE_GRANT_SQL, [SID, GRANT]);
    expect(RESOLVE_GRANT_SQL).not.toContain(GRANT);
    expect(RESOLVE_GRANT_SQL).not.toContain(SID);
  });
  it('SPOOF: x-actor-id / actorId / p_actor trong header, body, query bị bỏ qua hoàn toàn', async () => {
    const run = ok();
    const v = new SessionGrantVerifier(run);
    const req = {
      headers: { [PRIV_GRANT_HEADER]: `${SID}.${GRANT}`, 'x-actor-id': EMP_OTHER, 'x-employee-id': EMP_OTHER },
      body: { actorId: EMP_OTHER, p_actor: EMP_OTHER, employeeId: EMP_OTHER },
      query: { actor: EMP_OTHER },
    } as never;
    expect((await v.verify(req))?.employeeId).toBe(EMP_DB);
    expect(run).toHaveBeenCalledWith(RESOLVE_GRANT_SQL, [SID, GRANT]);
  });
  it('chỉ có header giả danh tính, không có bằng chứng => null và KHÔNG chạm DB', async () => {
    const run = ok();
    const v = new SessionGrantVerifier(run);
    expect(await v.verify(reqOf({ 'x-actor-id': EMP_OTHER }, { actorId: EMP_OTHER }))).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });
  it('FORGED/EXPIRED/REPLAYED/REVOKED (DB trả NULL) => null', async () => {
    for (const rows of [[{ employee_id: null }], [], [{}], [{ employee_id: 'không-phải-uuid' }], [{ employee_id: 123 }], [{ employee_id: EMP_DB }, { employee_id: EMP_DB }]]) {
      const v = new SessionGrantVerifier(jest.fn().mockResolvedValue(rows));
      expect(await v.verify(reqOf({ [PRIV_GRANT_HEADER]: `${SID}.${GRANT}` }))).toBeNull();
    }
  });
  it('DB lỗi/treo kết nối => null (fail-closed), không ném ra ngoài', async () => {
    const v = new SessionGrantVerifier(jest.fn().mockRejectedValue(new Error('connection refused')));
    expect(await v.verify(reqOf({ [PRIV_GRANT_HEADER]: `${SID}.${GRANT}` }))).toBeNull();
  });
});

describe('PrivilegedReadyGuard + SessionGrantVerifier (cổng không tin req.actor khi lệch bằng chứng)', () => {
  const ctx = (req: unknown) => ({ switchToHttp: () => ({ getRequest: () => req }) }) as unknown as ExecutionContext;
  const readiness = (ready: boolean) => ({ isReady: async () => ready }) as never;
  const reqWith = (actorId: string | null, headers: Record<string, unknown>) => ({ headers, body: {}, query: {}, actor: actorId ? { employeeId: actorId, departmentId: null } : undefined });
  const verifier = (rows: unknown[]) => new SessionGrantVerifier(jest.fn().mockResolvedValue(rows));
  const code = async (p: Promise<unknown>) => (await p.then(() => null, (e: DomainException) => ({ status: e.getStatus(), code: e.code }))) as { status: number; code: string } | null;

  it('khớp: req.actor = chủ grant => qua và gắn privilegedActor', async () => {
    const req = reqWith(EMP_DB, { [PRIV_GRANT_HEADER]: `${SID}.${GRANT}` });
    await expect(new PrivilegedReadyGuard(readiness(true), verifier([{ employee_id: EMP_DB }])).canActivate(ctx(req))).resolves.toBe(true);
    expect((req as { privilegedActor?: SessionBoundActor }).privilegedActor?.sessionId).toBe(SID);
  });
  it('LEO THANG CHÉO NGƯỜI DÙNG: req.actor = E2 nhưng grant thuộc E1 => 403 ACTOR_MISMATCH', async () => {
    const req = reqWith(EMP_OTHER, { [PRIV_GRANT_HEADER]: `${SID}.${GRANT}` });
    expect(await code(new PrivilegedReadyGuard(readiness(true), verifier([{ employee_id: EMP_DB }])).canActivate(ctx(req)))).toEqual({ status: 403, code: 'ACTOR_MISMATCH' });
  });
  it('không có bằng chứng / DB từ chối => 401; cổng đóng => 503 (trước mọi thứ)', async () => {
    const noProof = reqWith(EMP_DB, {});
    expect(await code(new PrivilegedReadyGuard(readiness(true), verifier([{ employee_id: EMP_DB }])).canActivate(ctx(noProof)))).toEqual({ status: 401, code: 'UNAUTHENTICATED' });
    const forged = reqWith(EMP_DB, { [PRIV_GRANT_HEADER]: `${SID}.${GRANT}` });
    expect(await code(new PrivilegedReadyGuard(readiness(true), verifier([{ employee_id: null }])).canActivate(ctx(forged)))).toEqual({ status: 401, code: 'UNAUTHENTICATED' });
    expect(await code(new PrivilegedReadyGuard(readiness(false), verifier([{ employee_id: EMP_DB }])).canActivate(ctx(forged)))).toEqual({ status: 503, code: 'PRIVILEGED_UNAVAILABLE' });
  });
});

describe('PrivilegedApiClient (SQL cố định, tham số gắn, không có p_actor)', () => {
  const actor: SessionBoundActor = { employeeId: EMP_DB, departmentId: null, proof: GRANT, sessionId: SID };
  const argsFor: Record<string, unknown[]> = {
    REQUEST_CREATE: ['PASSWORD_RESET', EMP_OTHER, null, { n: 1 }, 60], REQUEST_DECIDE: [SID, true], ROLE_GRANT: [SID], ROLE_REVOKE: [EMP_OTHER, SID, null],
    ROLE_PERMISSION_CHANGE: [SID], RESET_TOKEN_ISSUE: [SID, sha256Hex('x'), 10], CHANGE_OWN_PASSWORD: [1, 'h', 'argon2id', '{}'],
    CREDENTIAL_CREATE: [EMP_OTHER], CREDENTIAL_DISABLE: [EMP_OTHER, 'lý do'],
  };

  it('có đúng 9 thao tác, mọi câu SQL gọi hàm *_v2, hai tham số đầu là ($1 phiên, $2 grant), không p_actor/ghép chuỗi', () => {
    expect(PRIVILEGED_OPS).toHaveLength(9);
    for (const op of PRIVILEGED_OPS) {
      const sql = privilegedOpSql(op);
      expect(sql).toMatch(/^SELECT public\.fn_auth_api_[a-z_]+_v2\(\$1::uuid, \$2::text/);
      expect(sql).not.toMatch(/p_actor|\$\{|'\s*\+|%s/);
      expect(Object.keys(argsFor)).toContain(op);
    }
  });
  it.each(Object.keys(argsFor))('%s: tham số = [phiên, grant, ...nghiệp vụ], danh tính chỉ từ actor', async (op) => {
    const run = jest.fn().mockResolvedValue([{ result: 'R' }]);
    const out = await new PrivilegedApiClient(run).call(op as never, actor, argsFor[op]);
    expect(out).toBe('R');
    expect(run).toHaveBeenCalledWith(privilegedOpSql(op as never), [SID, GRANT, ...argsFor[op]]);
  });
  it('sai số tham số nghiệp vụ => ném (không gửi DB)', async () => {
    const run = jest.fn();
    await expect(new PrivilegedApiClient(run).call('ROLE_GRANT', actor, [])).rejects.toThrow();
    await expect(new PrivilegedApiClient(run).call('ROLE_GRANT', actor, [SID, EMP_OTHER])).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });
  it('actor thiếu bằng chứng => 401, không gửi DB', async () => {
    const run = jest.fn();
    await expect(new PrivilegedApiClient(run).call('ROLE_GRANT', { employeeId: EMP_DB, departmentId: null, proof: '' } as never, [SID])).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(run).not.toHaveBeenCalled();
  });
  it('lỗi DB => lỗi miền chung, KHÔNG lộ thông điệp DB', async () => {
    const e = (code: string, message: string) => Object.assign(new Error(message), { code });
    expect(toDomainError(e('42501', 'SESSION_PROOF_INVALID: x'))).toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(toDomainError(e('42501', 'APPROVAL_REQUIRED: nguoi thao tac abc'))).toMatchObject({ code: 'FORBIDDEN' });
    expect(toDomainError(e('23514', 'violates check constraint secret_table_x'))).toMatchObject({ code: 'INVALID_REQUEST' });
    expect(toDomainError(e('23001', 'LAST_ADMIN: uuid'))).toMatchObject({ code: 'CONFLICT' });
    const unknown = toDomainError(e('XX000', 'password authentication failed for user siscom_auth'));
    expect(unknown).toMatchObject({ code: 'INTERNAL' });
    expect(JSON.stringify(unknown.getResponse())).not.toMatch(/siscom_auth|secret_table|uuid|abc/);
    const run = jest.fn().mockRejectedValue(e('42501', 'SESSION_PROOF_INVALID: x'));
    return expect(new PrivilegedApiClient(run).call('ROLE_GRANT', actor, [SID])).rejects.toMatchObject({ status: 401 });
  });
});
