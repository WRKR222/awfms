import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { initTheme } from './stores/theme.store';
import './i18n'; // PW-03: initialise i18next (must load before render)

// Apply saved theme before first render to prevent flash
initTheme();

// ── Service Worker registration (PW-01) ─────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then(reg => {
        console.log('[SW] Registered, scope:', reg.scope);
        // Check for updates every 30 minutes while app is open
        setInterval(() => reg.update(), 30 * 60 * 1000);
      })
      .catch(err => console.warn('[SW] Registration failed:', err));
  });
}

const container = document.getElementById('root');
if (!container) throw new Error('Root element not found');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
