import React from 'react';
import App from '../../App.jsx';
import LoginScreen from './LoginScreen.jsx';
import { createCookieAuthClient, readCookieAuthConfig } from '../../auth/cookieAuthClient.js';
import { createCookieSession } from '../../auth/cookieSession.js';
import { createCustomerApiUi } from '../customers/customerApiUi.js';

// Cổng xác thực: chỉ được main.jsx chọn khi VITE_CRM_AUTH_ENABLED === 'true'. Khi tải trang: hỏi /auth/me (cookie còn hiệu lực
// => vào thẳng App); chưa đăng nhập => LoginScreen; AUTHENTICATED => App với phiên + bộ điều khiển Customer API gắn phiên.
// Không đọc/ghi storage; không có đường demo/đăng nhập giả.
export default function AuthGate({ env = import.meta.env }) {
  const [session] = React.useState(() => createCookieSession(createCookieAuthClient(readCookieAuthConfig(env))));
  const state = React.useSyncExternalStore(session.subscribe, session.getState, session.getState);
  const [restoring, setRestoring] = React.useState(true);
  React.useEffect(() => { let alive = true; session.restore().finally(() => { if (alive) setRestoring(false); }); return () => { alive = false; }; }, [session]);
  // Bộ điều khiển API tạo lại cho MỖI phiên đăng nhập (employeeId đổi => bộ nhớ đệm danh sách/chi tiết của người trước không còn).
  const customerApi = React.useMemo(() => (state.status === 'AUTHENTICATED' ? createCustomerApiUi({ env, session }) : null), [env, session, state.status, state.employeeId]);

  if (state.status === 'AUTHENTICATED' && customerApi) return <App session={session} customerApi={customerApi} />;
  if (restoring && state.status === 'LOADING') {
    return <main style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', font: 'var(--type-sm)', color: 'var(--text-3)' }} aria-busy="true">Đang kiểm tra phiên đăng nhập…</main>;
  }
  return <LoginScreen session={session} enabled />;
}
