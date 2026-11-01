import type { Request, Response } from 'express';
import { AuthController } from './auth.controller';
import type { AuthService } from './auth.service';
import type { AuthConfig } from '../../common/auth/auth.config';
import type { SessionRequest } from '../../common/auth/session/session-actor.provider';
import { newOpaqueToken } from '../../common/auth/session/session-token';

// B1.4 P1 (TRUST_PROXY): nguồn hạn mức và IP ghi phiên phải lấy từ req.ip (Express tính theo 'trust proxy'),
// không lấy thẳng địa chỉ socket — sau nginx mọi yêu cầu có cùng socket 127.0.0.1 nên chung một bucket.
describe('AuthController — nguồn hạn mức / IP phiên theo req.ip (B1.4 P1)', () => {
  const result = { sessionToken: newOpaqueToken(), csrfToken: newOpaqueToken(), maxAgeSeconds: 60, me: {} as never };
  const cfg = { cookieSecure: false } as AuthConfig;
  const res = () => ({ setHeader: jest.fn() }) as unknown as Response;
  const reqOf = (ip: string | undefined, socketAddr: string | undefined) =>
    ({ ip, socket: { remoteAddress: socketAddr }, headers: { 'user-agent': 'ua-test' }, requestId: 'req-test-0001' }) as unknown as Request & { requestId?: string };
  const mk = () => {
    const auth = { login: jest.fn().mockResolvedValue(result), changePassword: jest.fn().mockResolvedValue(result) };
    return { auth, ctl: new AuthController(auth as unknown as AuthService, cfg) };
  };

  it('login: req.ip (do Express tính theo trust proxy) là nguồn hạn mức và IP phiên', async () => {
    const { auth, ctl } = mk();
    await ctl.login({ login: 'a@b', password: 'x' }, reqOf('203.0.113.5', '127.0.0.1'), res());
    expect(auth.login).toHaveBeenCalledWith(expect.objectContaining({ source: '203.0.113.5', ip: '203.0.113.5' }));
  });
  it('login: không có req.ip => rơi về địa chỉ socket; không có cả hai => source "unknown", ip null', async () => {
    const { auth, ctl } = mk();
    await ctl.login({ login: 'a@b', password: 'x' }, reqOf(undefined, '10.0.0.9'), res());
    expect(auth.login).toHaveBeenCalledWith(expect.objectContaining({ source: '10.0.0.9', ip: '10.0.0.9' }));
    await ctl.login({ login: 'a@b', password: 'x' }, reqOf(undefined, undefined), res());
    expect(auth.login).toHaveBeenLastCalledWith(expect.objectContaining({ source: 'unknown', ip: null }));
  });
  it('login: req.ip không phải IP hợp lệ (header giả/proxy sai) => dùng địa chỉ socket, không đưa chuỗi lạ vào hạn mức/phiên', async () => {
    const { auth, ctl } = mk();
    await ctl.login({ login: 'a@b', password: 'x' }, reqOf('khong-phai-ip', '127.0.0.1'), res());
    expect(auth.login).toHaveBeenCalledWith(expect.objectContaining({ source: '127.0.0.1', ip: '127.0.0.1' }));
  });
  it('change-password: cùng quy tắc với login', async () => {
    const { auth, ctl } = mk();
    const req = Object.assign(reqOf('198.51.100.4', '127.0.0.1'), { authSession: { id: 's1' } }) as unknown as SessionRequest;
    await ctl.changePassword({ currentPassword: 'a', newPassword: 'b', confirmPassword: 'b' }, req, res());
    expect(auth.changePassword).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ source: '198.51.100.4', ip: '198.51.100.4' }));
  });
});

// Owner duyệt 2026-11-01: đăng nhập lại khi trình duyệt đang có phiên CÒN SỐNG => service thu hồi phiên đó (RELOGIN).
describe('AuthController.login — chuyển phiên còn sống (req.authSession do CsrfOriginGuard tra) xuống service', () => {
  const result = { sessionToken: newOpaqueToken(), csrfToken: newOpaqueToken(), maxAgeSeconds: 60, me: {} as never };
  const res = () => ({ setHeader: jest.fn() }) as unknown as Response;
  const reqWith = (authSession: unknown) => ({ ip: '10.0.0.1', socket: {}, headers: {}, requestId: 'r', authSession }) as unknown as Request & { requestId?: string };
  it('có phiên sống => previousSession { sessionId, employeeId }; phiên chết/không tra => null', async () => {
    const auth = { login: jest.fn().mockResolvedValue(result) };
    const ctl = new AuthController(auth as unknown as AuthService, { cookieSecure: false } as AuthConfig);
    await ctl.login({ login: 'a@b', password: 'x' }, reqWith({ sessionId: 'sess-old', actor: { employeeId: 'e7', departmentId: null } } as Partial<SessionRequest['authSession']>), res());
    expect(auth.login).toHaveBeenLastCalledWith(expect.objectContaining({ previousSession: { sessionId: 'sess-old', employeeId: 'e7' } }));
    for (const s of [null, undefined]) {
      await ctl.login({ login: 'a@b', password: 'x' }, reqWith(s), res());
      expect(auth.login).toHaveBeenLastCalledWith(expect.objectContaining({ previousSession: null }));
    }
  });
});
