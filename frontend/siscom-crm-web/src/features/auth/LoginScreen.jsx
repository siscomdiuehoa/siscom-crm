import React from 'react';
import { Input, Button } from '../../ds/index.js';
import { Icon } from '../../ds/core/Icon.jsx';
import { deriveLoginView, createLoginSubmitter, focusTargetAfterSubmit, touchedAfterSubmit, LOGIN_UI_TEXT } from '../../auth/loginScreenModel.js';
import LoginHeroScene from './LoginHeroScene.jsx';
import logo from '../../assets/logo-siscom.png';

// SISCOM Login V3 (05/11/2026) — thiết kế lại GIAO DIỆN theo mẫu Colorlib "Login Page 04": chia đôi màn hình, bên trái cảnh HVAC/MEP phủ xanh
// thương hiệu, bên phải form kính mờ (glassmorphism) nền sáng. CHỈ ĐỔI GIAO DIỆN: logic, mô hình trạng thái, hợp đồng API, phiên cookie,
// Remember Me 90 ngày và mọi mã lỗi giữ nguyên (loginScreenModel/loginSession/cookieSession không đổi).
// `session` là bộ điều khiển headless (createLoginSession); component không tự tạo client, không đọc storage.
// Trợ năng: Enter gửi qua <form> (một lần, có chặn gửi trùng), lỗi gắn aria-describedby + aria-invalid, banner role="alert",
// focus về trường lỗi đầu tiên, nút hiện/ẩn mật khẩu (không log, không lưu).
export const LOGIN_IDS = { identifier: 'login-identifier', password: 'login-password', identifierError: 'login-identifier-error', passwordError: 'login-password-error', banner: 'login-banner', remember: 'login-remember', rememberHint: 'login-remember-hint', forgot: 'login-forgot', forgotPanel: 'login-forgot-panel' };

// Ảnh công trình HVAC/MEP THẬT của SISCOM (nếu có): đặt URL ở đây (vd. '/login-hero.jpg' + file trong public/). null => cảnh minh hoạ SVG.
export const LOGIN_HERO_PHOTO = null;

// Chữ riêng của V3 (không đổi LOGIN_UI_TEXT dùng chung với bộ điều khiển/test).
export const LOGIN_V3_TEXT = {
  eyebrow: 'SISCOM CRM',
  heroTitle: 'Nền tảng CRM cho công trình HVAC/MEP của SISCOM',
  // (Không dùng cụm "Khách hàng"/"Tổng quan": test loginPreview bảo đảm màn hình đăng nhập không chứa nội dung CRM.)
  heroLead: 'Nền tảng nội bộ của SISCOM cho đội kinh doanh, kỹ thuật và kế toán — gọn, nhanh, dùng được cả trên điện thoại.',
  chips: ['Phân quyền theo vai trò', 'Phiên đăng nhập bảo mật', 'Dùng được trên điện thoại'],
  welcome: 'Chào mừng quay lại. Đăng nhập để tiếp tục vào SISCOM CRM.',
  forgot: 'Quên mật khẩu?',
  forgotHelp: 'SISCOM CRM chưa có đặt lại mật khẩu tự động. Vui lòng liên hệ quản trị viên CRM của công ty để được đặt lại mật khẩu.',
  footer: 'SISCOM — Your Solid Partner',
};

function FieldError({ id, children }) {
  if (!children) return null;
  return <span id={id} className="sg-hint sg-hint--error lg3-err" style={{ marginTop: 4 }}>{children}</span>;
}

export default function LoginScreen({ session, enabled = false }) {
  const state = React.useSyncExternalStore(session.subscribe, session.getState, session.getState);
  const [identifier, setIdentifier] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [touched, setTouched] = React.useState({});
  const [showPassword, setShowPassword] = React.useState(false);
  const [remember, setRemember] = React.useState(false); // B1.4 Remember Me: mặc định KHÔNG tích
  const [showForgot, setShowForgot] = React.useState(false);
  const [focusRequest, setFocusRequest] = React.useState(null); // { field, n }
  const submitter = React.useMemo(() => createLoginSubmitter(session), [session]);

  React.useEffect(() => {
    if (!focusRequest || typeof document === 'undefined') return;
    const el = document.getElementById(LOGIN_IDS[focusRequest.field]);
    if (el && !el.disabled) el.focus();
  }, [focusRequest]);

  if (!enabled) return null;
  const view = deriveLoginView({ status: state.status, error: state.error, identifier, password, touched });

  const onSubmit = async (e) => {
    e.preventDefault();
    const r = await submitter(identifier, password, remember);
    if (r.reason === 'IN_FLIGHT') return;
    setTouched(touchedAfterSubmit(r));
    if (r.submitted) { setPassword(''); setShowPassword(false); } // không giữ mật khẩu sau khi gửi
    const field = focusTargetAfterSubmit(r, session.getState());
    if (field) setFocusRequest((p) => ({ field, n: (p ? p.n : 0) + 1 }));
  };

  const idDesc = [view.identifierError && LOGIN_IDS.identifierError, view.bannerError && LOGIN_IDS.banner].filter(Boolean).join(' ') || undefined;
  const pwDesc = [view.passwordError && LOGIN_IDS.passwordError, view.bannerError && LOGIN_IDS.banner].filter(Boolean).join(' ') || undefined;
  const errCls = (err) => (err ? 'sg-control--error' : '');
  const T = LOGIN_V3_TEXT;

  return (
    <main className="login-shell" data-login="v3" style={{ display: 'block', padding: 0 }}>
      <div className="lg3">
        <aside className="lg3-hero" data-photo={LOGIN_HERO_PHOTO ? 'true' : undefined}>
          {LOGIN_HERO_PHOTO ? <img className="lg3-photo" src={LOGIN_HERO_PHOTO} alt="" aria-hidden="true" /> : <LoginHeroScene />}
          <div className="lg3-hero__tint" aria-hidden="true" />
          <div className="lg3-hero__body">
            <p className="lg3-eyebrow"><span className="lg3-eyebrow__dot" aria-hidden="true" />{T.eyebrow}</p>
            <h2 className="lg3-hero__title">{T.heroTitle}</h2>
            <p className="lg3-hero__lead">{T.heroLead}</p>
            <ul className="lg3-chips">
              {T.chips.map((c) => <li key={c}><Icon name="check" size={14} />{c}</li>)}
            </ul>
          </div>
        </aside>

        <section className="lg3-pane">
          <div className="lg3-wrap">
            <form className="lg3-card" onSubmit={onSubmit} noValidate aria-busy={view.loading || undefined} aria-labelledby="login-title">
              <img className="lg3-logo" src={logo} alt="SISCOM" width="152" height="43" />
              <h1 id="login-title" className="lg3-title">{LOGIN_UI_TEXT.title}</h1>
              <p className="lg3-sub">{T.welcome}</p>

              {view.notice ? <div role="status" className="lg3-notice">{view.notice}</div> : null}
              {view.bannerError ? (
                <div id={LOGIN_IDS.banner} role="alert" data-kind={view.bannerKind} className="lg3-banner">
                  <Icon name="circle-alert" size={16} /><span>{view.bannerError}</span>
                </div>
              ) : null}

              <div className="lg3-field">
                <Input id={LOGIN_IDS.identifier} name="username" label={LOGIN_UI_TEXT.identifierLabel} required aria-required="true" autoComplete="username"
                  icon="mail" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} className={errCls(view.identifierError)}
                  placeholder="Email hoặc NV-0001"
                  aria-invalid={!!view.identifierError} aria-describedby={idDesc}
                  value={identifier} disabled={view.inputsDisabled}
                  onChange={(e) => setIdentifier(e.target.value)} onBlur={() => setTouched((t) => ({ ...t, identifier: true }))} />
                <FieldError id={LOGIN_IDS.identifierError}>{view.identifierError}</FieldError>
              </div>

              <div className="lg3-field">
                <Input id={LOGIN_IDS.password} name="password" label={LOGIN_UI_TEXT.passwordLabel} required aria-required="true"
                  icon="lock" type={showPassword ? 'text' : 'password'} autoComplete="current-password" className={errCls(view.passwordError)}
                  placeholder="Nhập mật khẩu"
                  aria-invalid={!!view.passwordError} aria-describedby={pwDesc}
                  value={password} disabled={view.inputsDisabled}
                  suffix={(
                    <button type="button" className="lg3-eye" aria-pressed={showPassword} aria-controls={LOGIN_IDS.password}
                      disabled={view.inputsDisabled} onClick={() => setShowPassword((v) => !v)}>
                      <Icon name={showPassword ? 'eye-off' : 'eye'} size={18} />
                      <span className="sr-only">{showPassword ? LOGIN_UI_TEXT.hidePassword : LOGIN_UI_TEXT.showPassword}</span>
                    </button>
                  )}
                  onChange={(e) => setPassword(e.target.value)} onBlur={() => setTouched((t) => ({ ...t, password: true }))} />
                <FieldError id={LOGIN_IDS.passwordError}>{view.passwordError}</FieldError>
                <div className="lg3-forgotrow">
                  <button type="button" id={LOGIN_IDS.forgot} className="lg3-link" aria-expanded={showForgot} aria-controls={LOGIN_IDS.forgotPanel}
                    onClick={() => setShowForgot((v) => !v)}>{T.forgot}</button>
                </div>
                {showForgot ? <div id={LOGIN_IDS.forgotPanel} role="note" className="lg3-forgot"><Icon name="info" size={16} /><span>{T.forgotHelp}</span></div> : null}
              </div>

              <div className="lg3-remember">
                <label htmlFor={LOGIN_IDS.remember} className="lg3-remember__label">
                  <input id={LOGIN_IDS.remember} name="remember" type="checkbox" checked={remember} disabled={view.inputsDisabled}
                    aria-describedby={LOGIN_IDS.rememberHint} onChange={(e) => setRemember(e.target.checked)} />
                  <span>{LOGIN_UI_TEXT.rememberLabel}</span>
                </label>
                <span id={LOGIN_IDS.rememberHint} className="lg3-remember__hint">{LOGIN_UI_TEXT.rememberHint}</span>
              </div>

              <Button type="submit" block size="lg" className="lg3-submit" loading={view.loading} disabled={view.submitBlocked}>{LOGIN_UI_TEXT.submit}</Button>
              <p className="lg3-foot"><Icon name="shield-check" size={14} />{T.footer}</p>
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}
