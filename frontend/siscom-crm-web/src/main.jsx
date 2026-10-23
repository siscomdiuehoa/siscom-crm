import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/styles.css';
import './styles/app.css';
import App from './App.jsx';
import LoginPreviewEntry from './features/auth/LoginPreviewEntry.jsx';
import { selectRootKind } from './auth/loginPreview.js';

// Intentionally no <React.StrictMode> in phase 1 (behaviour parity with the legacy UMD app).
// VITE_CRM_LOGIN_PREVIEW_ENABLED (mặc định tắt) chỉ để xem thử màn hình đăng nhập; tắt => App như cũ.
const Root = selectRootKind(import.meta.env) === 'preview' ? LoginPreviewEntry : App;
ReactDOM.createRoot(document.getElementById('root')).render(<Root />);
