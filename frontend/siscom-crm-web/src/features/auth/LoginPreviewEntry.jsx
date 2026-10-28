import React from 'react';
import LoginScreen from './LoginScreen.jsx';
import { createLoginPreviewSession } from '../../auth/loginPreview.js';

// Điểm vào xem thử đăng nhập — chỉ được main.jsx chọn khi VITE_CRM_LOGIN_PREVIEW_ENABLED === 'true'.
// Không tải App/dữ liệu khách hàng, không đọc storage, không gọi mạng.
export default function LoginPreviewEntry() {
  const [session] = React.useState(createLoginPreviewSession);
  return <LoginScreen session={session} enabled />;
}
