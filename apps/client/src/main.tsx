import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles.css';

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

// Register offline-first service worker in browser environments
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        if (import.meta.env?.DEV) {
          console.debug('[GeekLedger] Service Worker registered scope:', registration.scope);
        }
      })
      .catch((err) => {
        console.warn('[GeekLedger] Service Worker registration failed:', err);
      });
  });
}
