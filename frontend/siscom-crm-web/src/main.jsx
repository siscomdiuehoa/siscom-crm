import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/styles.css';
import './styles/app.css';
import App from './App.jsx';
import AuthGate from './features/auth/AuthGate.jsx';
import LoginPreviewEntry from './features/auth/LoginPreviewEntry.jsx';
import { selectAppRoot } from './auth/rootSelector.js';

// Intentionally no <React.StrictMode> in phase 1 (behaviour parity with the legacy UMD app).
// VITE_CRM_AUTH_ENABLED=true => đăng nhập thật bằng phiên cookie (AuthGate). VITE_CRM_LOGIN_PREVIEW_ENABLED chỉ xem thử màn hình.
// Mọi cờ tắt (mặc định) => App demo localStorage như cũ.
const kind = selectAppRoot(import.meta.env);
const Root = kind === 'auth' ? AuthGate : kind === 'preview' ? LoginPreviewEntry : App;
ReactDOM.createRoot(document.getElementById('root')).render(<Root />);
