import React from 'react';
import { Input, Button } from '../../ds/index.js';
import { deriveLoginView, createLoginSubmitter, focusTargetAfterSubmit, touchedAfterSubmit, LOGIN_UI_TEXT } from '../../auth/loginScreenModel.js';

// Vỏ màn hình đăng nhập — tách riêng để thay bằng thiết kế hoàn chỉnh của chủ sở hữu sau này.
// Chưa được nối vào App.jsx. `enabled` (cờ giao diện) mặc định false => không render gì.
// `session` là bộ điều khiển headless (createLoginSession); component không tự tạo client, không đọc storage.
// Trợ năng: Enter gửi qua <form> (một lần, có chặn gửi trùng), lỗi gắn aria-describedby + aria-invalid,
// banner role="alert", focus về trường lỗi đầu tiên, nút hiện/ẩn mật khẩu (không log, không lưu).
export const LOGIN_IDS = { identifier: 'login-identifier', password: 'login-password', identifierError: 'login-identifier-error', passwordError: 'login-password-error', banner: 'login-banner' };

function FieldError({ id, children }) {
  if (!children) return null;
  return <span id={id} className="sg-hint sg-hint--error" style={{ marginTop: 4 }}>{children}</span>;
}

export default function LoginScreen({ session, enabled = false }) {
  const state = React.useSyncExternalStore(session.subscribe, session.getState, session.getState);
  const [identifier, setIdentifier] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [touched, setTouched] = React.useState({});
  const [showPassword, setShowPassword] = React.useState(false);
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
    const r = await submitter(identifier, password);
    if (r.reason === 'IN_FLIGHT') return;
    setTouched(touchedAfterSubmit(r));
    if (r.submitted) { setPassword(''); setShowPassword(false); } // không giữ mật khẩu sau khi gửi
    const field = focusTargetAfterSubmit(r, session.getState());
    if (field) setFocusRequest((p) => ({ field, n: (p ? p.n : 0) + 1 }));
  };

  const idDesc = [view.identifierError && LOGIN_IDS.identifierError, view.bannerError && LOGIN_IDS.banner].filter(Boolean).join(' ') || undefined;
  const pwDesc = [view.passwordError && LOGIN_IDS.passwordError, view.bannerError && LOGIN_IDS.banner].filter(Boolean).join(' ') || undefined;
  const errCls = (err) => (err ? 'sg-control--error' : '');

  return (
    <main className="login-shell" style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 16 }}>
      <form className="sg-glass-strong" onSubmit={onSubmit} noValidate aria-busy={view.loading || undefined} aria-labelledby="login-title"
        style={{ width: '100%', maxWidth: 380, display: 'grid', gap: 14, padding: 24, borderRadius: 16 }}>
        <h1 id="login-title" style={{ font: 'var(--type-h3)', margin: 0 }}>{LOGIN_UI_TEXT.title}</h1>
        {view.notice ? <div role="status" style={{ font: 'var(--type-sm)', color: 'var(--text-3)' }}>{view.notice}</div> : null}
        {view.bannerError ? <div id={LOGIN_IDS.banner} role="alert" data-kind={view.bannerKind} style={{ font: 'var(--type-sm)', color: 'var(--danger, #c0392b)' }}>{view.bannerError}</div> : null}
        <div>
          <Input id={LOGIN_IDS.identifier} name="username" label={LOGIN_UI_TEXT.identifierLabel} required aria-required="true" autoComplete="username"
            autoCapitalize="none" autoCorrect="off" spellCheck={false} className={errCls(view.identifierError)}
            aria-invalid={!!view.identifierError} aria-describedby={idDesc}
            value={identifier} disabled={view.inputsDisabled}
            onChange={(e) => setIdentifier(e.target.value)} onBlur={() => setTouched((t) => ({ ...t, identifier: true }))} />
          <FieldError id={LOGIN_IDS.identifierError}>{view.identifierError}</FieldError>
        </div>
        <div>
          <Input id={LOGIN_IDS.password} name="password" label={LOGIN_UI_TEXT.passwordLabel} required aria-required="true"
            type={showPassword ? 'text' : 'password'} autoComplete="current-password" className={errCls(view.passwordError)}
            aria-invalid={!!view.passwordError} aria-describedby={pwDesc}
            value={password} disabled={view.inputsDisabled}
            suffix={(
              <button type="button" className="sg-btn sg-btn--ghost sg-btn--sm" aria-pressed={showPassword} aria-controls={LOGIN_IDS.password}
                disabled={view.inputsDisabled} onClick={() => setShowPassword((v) => !v)}>
                {showPassword ? LOGIN_UI_TEXT.hidePassword : LOGIN_UI_TEXT.showPassword}
              </button>
            )}
            onChange={(e) => setPassword(e.target.value)} onBlur={() => setTouched((t) => ({ ...t, password: true }))} />
          <FieldError id={LOGIN_IDS.passwordError}>{view.passwordError}</FieldError>
        </div>
        <Button type="submit" block loading={view.loading} disabled={view.submitBlocked}>{LOGIN_UI_TEXT.submit}</Button>
      </form>
    </main>
  );
}
