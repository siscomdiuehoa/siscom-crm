import React from 'react';
import { ChangePasswordForm } from './ChangePasswordScreen.jsx';
import { CHANGE_PASSWORD_UI_TEXT, canCloseDialog } from '../../auth/changePasswordModel.js';

// Hộp thoại đổi mật khẩu mở từ thanh đầu trang (chế độ API). Overlay + role="dialog" như CustomerFormDrawer; Esc/bấm nền => đóng,
// NHƯNG không đóng trong lúc đang gửi (F6): máy chủ vẫn hoàn tất đổi mật khẩu và thu hồi phiên khác, đóng sớm sẽ làm người dùng tưởng đã huỷ.
export default function ChangePasswordDialog({ open, session, onClose, onDone }) {
  const [submitting, setSubmitting] = React.useState(false);
  const tryClose = React.useCallback(() => { if (canCloseDialog({ submitting }) && onClose) onClose(); }, [submitting, onClose]);
  React.useEffect(() => {
    if (!open || typeof window === 'undefined') return;
    const h = (e) => { if (e.key === 'Escape') tryClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, tryClose]);
  if (!open) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 70, display: 'grid', placeItems: 'center', padding: 16 }}>
      <div onClick={tryClose} style={{ position: 'absolute', inset: 0, background: 'var(--overlay)', backdropFilter: 'blur(4px)', animation: 'sg-fade var(--dur-base)' }} />
      <div role="dialog" aria-modal="true" aria-label={CHANGE_PASSWORD_UI_TEXT.title} aria-busy={submitting || undefined} style={{ position: 'relative', width: '100%', maxWidth: 420, animation: 'sg-fade-up var(--dur-slow) var(--ease-out)' }}>
        <ChangePasswordForm session={session} onClose={tryClose} onDone={onDone} onSubmittingChange={setSubmitting} />
      </div>
    </div>
  );
}
