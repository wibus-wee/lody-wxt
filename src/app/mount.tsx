import './global.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { startDiagnostics } from './diagnostics';
import { AppProviders } from './providers';

export function mountApp(surface: 'popup' | 'options' | 'web' | 'sidepanel') {
  const root = document.getElementById('root');
  if (!root) throw new Error('Missing #root mount element');
  document.body.dataset.surface = surface;
  void startDiagnostics();
  createRoot(root).render(
    <StrictMode>
      <AppProviders>
        <App surface={surface} />
      </AppProviders>
    </StrictMode>,
  );
}
