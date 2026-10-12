import { BipaeApp } from '@bipae/erp-ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createDesktopPlatform } from './platform';
import './styles.css';

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3333';
const platform = await createDesktopPlatform();

// Hash routing: the Tauri asset protocol has no server-side fallback for deep links.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BipaeApp platform={platform} apiUrl={apiUrl} router="hash" />
  </StrictMode>,
);
