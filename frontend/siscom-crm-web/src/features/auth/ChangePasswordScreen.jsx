import React from 'react';
import { Input, Button } from '../../ds/index.js';
import { CHANGE_PASSWORD_UI_TEXT, deriveChangePasswordView, createChangePasswordSubmitter } from '../../auth/changePasswordModel.js';

// Màn hình đổi mật khẩu của chính mình (PR 8, B1.3.3) — cùng phong cách LoginScreen (Liquid Glass `sg-glass-strong`, DS Input/Button).
// - `session` là bộ điều khiển phiên cookie (createCookieSession): component không tự tạo client, không đọc storage, không log.
// - Mật khẩu chỉ nằm trong state; cả 3 ô bị xoá sau mỗi lần gửi (thành công hay thất bại). Không giữ mật khẩu.
// - `forced` (me.mustChangePassword): không có nút Đóng, chỉ "Đăng xuất"; thành công => onDone (AuthGate tự vào App vì me đã đổi).
// - Trợ năng: lỗi gắn aria-describedby + aria-invalid, banner role="alert", thanh độ mạnh role="meter", focus về trường lỗi đầu tiên.
export const CHANGE_PASSWORD_IDS = { current: 'cp-current', next: 'cp-next', confirm: 'cp-confirm', banner: 'cp-banner', strength: 'cp-strength', currentError: 'cp-current-error', nextError: 'cp-next-error', confirmError: 'cp-confirm-error', title: 'cp-title' };
const FIELD_ID = { current: CHANGE_PASSWORD_IDS.current, next: CHANGE_PASSWORD_IDS.next, confirm: CHANGE_PASSWORD_IDS.confirm };
const STRENGTH_COLOR = ['var(--text-3)', 'var(--danger, #c0392b)', 'var(--warning-text, #b7791f)', 'var(--success-text, #2f855a)', 'var(--success-text, #2f855a)'];

function FieldError({ id, children }) {
  if (!children) return null;
  return <span id={id} className="sg-hint sg-hint--error" style={{ marginTop: 4 }}>{children}</span>;
}

function StrengthMeter({ value, label }) {
  const T = CHANGE_PASSWORD_UI_TEXT;
  return (
    <div id={CHANGE_PASSWORD_IDS.strength} role="meter" aria-label="Độ mạnh mật khẩu" aria-valuemin={0} aria-valuemax={4} aria-valuenow={value} aria-valuetext={label} style={{ display: 'grid', gap: 6, marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 4 }}>
        {[1, 2, 3, 4].map((i) => <span key={i} aria-hidden="true" style={{ flex: 1, height: 4, borderRadius: 2, background: i <= value ? STRENGTH_COLOR[value] : 'var(--border-subtle)', transition: 'background var(--dur-fast)' }} />)}
      </div>
      <span style={{ font: 'var(--type-caption)', color: STRENGTH_COLOR[value] }}>Độ mạnh: {label}</span>
      <span style={{ font: 'var(--type-caption)', color: 'var(--text-3)' }}>{T.hint}</span>
    </div>
  );
}

export function ChangePasswordForm({ session, forced = false, onDone, onClose, onSubmittingChange }) {
  const T = CHANGE_PASSWORD_UI_TEXT;
  const state = React.useSyncExternalStore(session.subscribe, session.getState, session.getState);
  const [current, setCurrent] = React.useState('');
  const [next, setNext] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [touched, setTouched] = React.useState({});
  const [show, setShow] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [serverError, setServerError] = React.useState(null);
  const [focusRequest, setFocusRequest] = React.useState(null);
  const submitter = React.useMemo(() => createChangePasswordSubmitter(session), [session]);

  React.useEffect(() => {
    if (!focusRequest || typeof document === 'undefined') return;
    const el = document.getElementById(FIELD_ID[focusRequest.field]);
    if (el && !el.disabled) el.focus();
  }, [focusRequest]);

  const view = deriveChangePasswordView({ status: state.status, submitting, serverError, current, next, confirm, touched, me: state.me });
  const focusField = (field) => { if (field) setFocusRequest((p) => ({ field, n: (p ? p.n : 0) + 1 })); };
  const clear = () => { setCurrent(''); setNext(''); setConfirm(''); setShow(false); setTouched({}); };

  const onSubmit = async (e) => {
    e.preventDefault();
    setTouched({ current: true, next: true, confirm: true });
    if (view.submitBlocked) return;
    setSubmitting(true); onSubmittingChange && onSubmittingChange(true);
    let r;
    try { r = await submitter(current, next, confirm); } finally { setSubmitting(false); onSubmittingChange && onSubmittingChange(false); }
    if (r.reason === 'IN_FLIGHT') return;
    if (!r.submitted) { focusField(r.firstInvalid); return; }
    clear(); // không giữ mật khẩu sau khi gửi
    if (r.ok) { setServerError(null); onDone && onDone(); return; }
    setServerError(r.error);
    focusField(r.error && r.error.field ? r.error.field : 'current');
  };
  const set = (setter, key) => (e) => { if (serverError) setServerError(null); setter(e.target.value); };
  const blur = (key) => () => setTouched((t) => ({ ...t, [key]: true }));
  const desc = (errId, hasErr) => [hasErr && errId, view.bannerError && CHANGE_PASSWORD_IDS.banner].filter(Boolean).join(' ') || undefined;
  const errCls = (err) => (err ? 'sg-control--error' : '');
  const type = show ? 'text' : 'password';
  const toggle = (
    <button type="button" className="sg-btn sg-btn--ghost sg-btn--sm" aria-pressed={show} aria-controls={[CHANGE_PASSWORD_IDS.current, CHANGE_PASSWORD_IDS.next, CHANGE_PASSWORD_IDS.confirm].join(' ')}
      disabled={view.inputsDisabled} onClick={() => setShow((v) => !v)}>{show ? T.hidePassword : T.showPassword}</button>
  );

  return (
    <form className="sg-glass-strong" onSubmit={onSubmit} noValidate aria-busy={view.loading || undefined} aria-labelledby={CHANGE_PASSWORD_IDS.title}
      style={{ width: '100%', maxWidth: 420, display: 'grid', gap: 14, padding: 24, borderRadius: 16 }}>
      <h2 id={CHANGE_PASSWORD_IDS.title} style={{ font: 'var(--type-h3)', margin: 0 }}>{T.title}</h2>
      {forced ? <div role="status" style={{ font: 'var(--type-sm)', color: 'var(--text-2)' }}>{T.forcedNotice}</div> : null}
      {view.bannerError ? <div id={CHANGE_PASSWORD_IDS.banner} role="alert" data-kind={view.bannerKind} style={{ font: 'var(--type-sm)', color: 'var(--danger, #c0392b)' }}>{view.bannerError}</div> : null}
      <div>
        <Input id={CHANGE_PASSWORD_IDS.current} name="current-password" label={T.currentLabel} required aria-required="true" type={type} autoComplete="current-password"
          className={errCls(view.currentError)} aria-invalid={!!view.currentError} aria-describedby={desc(CHANGE_PASSWORD_IDS.currentError, view.currentError)}
          value={current} disabled={view.inputsDisabled} onChange={set(setCurrent, 'current')} onBlur={blur('current')} suffix={toggle} />
        <FieldError id={CHANGE_PASSWORD_IDS.currentError}>{view.currentError}</FieldError>
      </div>
      <div>
        <Input id={CHANGE_PASSWORD_IDS.next} name="new-password" label={T.nextLabel} required aria-required="true" type={type} autoComplete="new-password"
          className={errCls(view.nextError)} aria-invalid={!!view.nextError} aria-describedby={desc(CHANGE_PASSWORD_IDS.nextError, view.nextError) || CHANGE_PASSWORD_IDS.strength}
          value={next} disabled={view.inputsDisabled} onChange={set(setNext, 'next')} onBlur={blur('next')} />
        <FieldError id={CHANGE_PASSWORD_IDS.nextError}>{view.nextError}</FieldError>
        <StrengthMeter value={view.strength} label={view.strengthLabel} />
      </div>
      <div>
        <Input id={CHANGE_PASSWORD_IDS.confirm} name="confirm-password" label={T.confirmLabel} required aria-required="true" type={type} autoComplete="new-password"
          className={errCls(view.confirmError)} aria-invalid={!!view.confirmError} aria-describedby={desc(CHANGE_PASSWORD_IDS.confirmError, view.confirmError)}
          value={confirm} disabled={view.inputsDisabled} onChange={set(setConfirm, 'confirm')} onBlur={blur('confirm')} />
        <FieldError id={CHANGE_PASSWORD_IDS.confirmError}>{view.confirmError}</FieldError>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        {forced
          ? <Button type="button" variant="secondary" icon="log-out" disabled={view.loading} onClick={() => session.logout()}>{T.logout}</Button>
          : (onClose ? <Button type="button" variant="secondary" disabled={view.loading} onClick={onClose}>{T.close}</Button> : null)}
        <Button type="submit" icon="check" loading={view.loading} disabled={view.submitBlocked}>{T.submit}</Button>
      </div>
    </form>
  );
}

// Màn hình toàn trang khi bắt buộc đổi mật khẩu (AuthGate dùng khi me.mustChangePassword = true).
export default function ChangePasswordScreen({ session, onDone }) {
  return (
    <main className="login-shell" style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 16 }}>
      <ChangePasswordForm session={session} forced onDone={onDone} />
    </main>
  );
}
