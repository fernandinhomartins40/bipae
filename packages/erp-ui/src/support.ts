/**
 * Bipaê support sessions opened from the staff panel. The panel opens `<app>/suporte#token=…&exp=…`
 * in a new tab; the token lives only in this tab (sessionStorage) and is removed from the address
 * bar immediately. It is never refreshed: when it expires (30 min), the session ends.
 */
const KEY = 'bipae.supportSession';

export interface SupportSession {
  token: string;
  expiresAt: number;
}

/** Called once at startup: captures a handoff from the panel, if this is one. */
export function captureSupportHandoff(basename: string): void {
  if (typeof window === 'undefined') return;
  const path = window.location.pathname.replace(/\/+$/, '');
  if (path !== `${basename}/suporte`) return;
  const params = new URLSearchParams(window.location.hash.slice(1));
  const token = params.get('token');
  const exp = Number(params.get('exp'));
  if (token && exp > Date.now()) {
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ token, expiresAt: exp }));
    } catch {
      // Storage blocked: the support session simply does not start.
    }
  }
  window.history.replaceState(null, '', `${basename}/`);
}

export function readSupportSession(): SupportSession | null {
  try {
    const raw = typeof window === 'undefined' ? null : sessionStorage.getItem(KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as SupportSession;
    if (session.expiresAt <= Date.now()) {
      sessionStorage.removeItem(KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function endSupportSession() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
