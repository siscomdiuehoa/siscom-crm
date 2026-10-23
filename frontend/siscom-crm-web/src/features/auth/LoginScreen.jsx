import React from 'react';
import { Input, Button } from '../../ds/index.js';
import { deriveLoginView, submitLogin, LOGIN_UI_TEXT } from '../../auth/loginScreenModel.js';

// VỎ màn hình đăng nhập — tách riêng để thay bằng thiết kế hoàn chỉnh của chủ sở hữu sau này.
// Chưa được nối vào App.jsx. `enabled` (cờ giao diện) mặc định false => không render gì.
// `session` là bộ điều khiển headless (createLoginSession); component không tự tạo client, không đọc storage.
export default function LoginScreen({ session, enabled = false }) {
  const state = React.useSyncExternalStore(session.subscribe, session.getState, session.getState);
  const [identifier, setIdentifier] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [touched, setTouched] = React.useState({});
  if (!enabled) return null;
  const view = deriveLoginView({ status: state.status, error: state.error, identifier, password, touched });

  const onSubmit = async (e) => {
    e.preventDefault();
    const sent = password;
    const r = await submitLogin(session, identifier, sent);
    setTouched(r.touched);
    if (r.submitted) setPassword(''); // không giữ mật khẩu sau khi gửi
  };

  return (
    <main className="login-shell" style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 16 }}>
      <form className="sg-glass-strong" onSubmit={onSubmit} noValidate aria-busy={view.loading || undefined}
        style={{ width: '100%', maxWidth: 380, display: 'grid', gap: 14, padding: 24, borderRadius: 16 }}>
        <h1 style={{ font: 'var(--type-h3)', margin: 0 }}>{LOGIN_UI_TEXT.title}</h1>
        {view.notice ? <div role="status" style={{ font: 'var(--type-sm)', color: 'var(--text-3)' }}>{view.notice}</div> : null}
        {view.bannerError ? <div role="alert" style={{ font: 'var(--type-sm)', color: 'var(--danger, #c0392b)' }}>{view.bannerError}</div> : null}
        <Input label={LOGIN_UI_TEXT.identifierLabel} required autoComplete="username" value={identifier} disabled={view.inputsDisabled}
          error={view.identifierError} onChange={(e) => setIdentifier(e.target.value)} onBlur={() => setTouched((t) => ({ ...t, identifier: true }))} />
        <Input label={LOGIN_UI_TEXT.passwordLabel} required type="password" autoComplete="current-password" value={password} disabled={view.inputsDisabled}
          error={view.passwordError} onChange={(e) => setPassword(e.target.value)} onBlur={() => setTouched((t) => ({ ...t, password: true }))} />
        <Button type="submit" block loading={view.loading} disabled={view.submitDisabled}>{LOGIN_UI_TEXT.submit}</Button>
      </form>
    </main>
  );
}
