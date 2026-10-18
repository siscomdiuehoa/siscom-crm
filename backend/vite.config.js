import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './', // relative asset URLs: dist/ works from any folder or sub-path (hash routing needs no server rewrites)
  server: { port: 5173, strictPort: false, open: true },
  preview: { port: 4173, open: true },
});
