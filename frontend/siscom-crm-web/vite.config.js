import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev: /api được proxy sang backend (mặc định http://127.0.0.1:3000) để FE và API CÙNG ORIGIN (http://localhost:5173):
// cookie phiên HttpOnly SameSite=Lax hoạt động không cần CORS credentials (quyết định C2, Issue #8). Đổi đích bằng VITE_DEV_API_TARGET.
const apiTarget = process.env.VITE_DEV_API_TARGET || 'http://127.0.0.1:3000';
const proxy = { '/api': { target: apiTarget, changeOrigin: false, secure: false } };

export default defineConfig({
  plugins: [react()],
  base: './', // relative asset URLs: dist/ works from any folder or sub-path (hash routing needs no server rewrites)
  server: { port: 5173, strictPort: false, open: true, proxy },
  preview: { port: 4173, open: true, proxy },
});
