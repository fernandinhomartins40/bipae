import { BipaeApp } from '@bipae/erp-ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { createWebPlatform } from './platform';
import './styles.css';

let updateWaiting = false;
const onRegister = () => location.pathname.startsWith(`${import.meta.env.BASE_URL}caixa`);
const updateSW = registerSW({
  onNeedRefresh() {
    updateWaiting = true;
    // Outside the register a new version applies right away (otherwise new pages, like
    // /download, would bounce to the start page on the old cached app). On the register it
    // never reloads mid-sale: it applies as soon as the operator leaves the register screen.
    if (!onRegister()) void updateSW(true);
  },
  onRegisteredSW(_url, registration) {
    // Long-lived tabs (a register open all day) still learn about new versions.
    if (registration) setInterval(() => void registration.update(), 60 * 60_000);
  },
});
setInterval(() => {
  if (updateWaiting && !onRegister()) void updateSW(true);
}, 15_000);

const platform = createWebPlatform({
  applyUpdate: () => updateSW(true),
  waiting: () => updateWaiting,
});

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3333';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BipaeApp
      platform={platform}
      apiUrl={apiUrl}
      router="browser"
      basename={import.meta.env.BASE_URL.slice(0, -1)}
    />
  </StrictMode>,
);
