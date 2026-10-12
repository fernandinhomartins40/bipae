import { BipaeApp } from '@bipae/erp-ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { createWebPlatform } from './platform';
import './styles.css';

let updateWaiting = false;
const updateSW = registerSW({
  onNeedRefresh() {
    updateWaiting = true;
  },
});

const platform = createWebPlatform({
  applyUpdate: () => updateSW(true),
  waiting: () => updateWaiting,
});

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3333';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BipaeApp platform={platform} apiUrl={apiUrl} router="browser" />
  </StrictMode>,
);
