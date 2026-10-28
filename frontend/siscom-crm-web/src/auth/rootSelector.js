// Chọn gốc render (thuần, không React): 'auth' khi VITE_CRM_AUTH_ENABLED === 'true' (đăng nhập thật bằng phiên cookie, PR #167);
// 'preview' khi chỉ bật VITE_CRM_LOGIN_PREVIEW_ENABLED; còn lại 'app' (demo localStorage như cũ). Mặc định mọi cờ TẮT => 'app'.
import { readLoginPreviewFlag } from './loginPreview.js';
import { readCookieAuthConfig } from './cookieAuthClient.js';

export function selectAppRoot(env) {
  if (readCookieAuthConfig(env).enabled) return 'auth';
  return readLoginPreviewFlag(env) ? 'preview' : 'app';
}
