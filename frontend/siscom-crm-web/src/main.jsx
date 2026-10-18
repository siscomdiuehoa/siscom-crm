import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/styles.css';
import './styles/app.css';
import App from './App.jsx';

// Intentionally no <React.StrictMode> in phase 1 (behaviour parity with the legacy UMD app).
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
