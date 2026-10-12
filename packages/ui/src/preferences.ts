/** Display preferences (UX §9): theme, high contrast, large font, sale beep. */
export interface DisplayPreferences {
  theme: 'system' | 'light' | 'dark';
  highContrast: boolean;
  largeFont: boolean;
  beep: boolean;
}

export const DEFAULT_DISPLAY: DisplayPreferences = {
  theme: 'system',
  highContrast: false,
  largeFont: false,
  beep: true,
};

export function applyDisplayPreferences(prefs: DisplayPreferences, root: HTMLElement) {
  if (prefs.theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = prefs.theme;
  if (prefs.highContrast) root.dataset.contrast = 'high';
  else delete root.dataset.contrast;
  if (prefs.largeFont) root.dataset.font = 'large';
  else delete root.dataset.font;
}

export function parseDisplayPreferences(raw: string | null): DisplayPreferences {
  if (!raw) return DEFAULT_DISPLAY;
  try {
    return { ...DEFAULT_DISPLAY, ...(JSON.parse(raw) as Partial<DisplayPreferences>) };
  } catch {
    return DEFAULT_DISPLAY;
  }
}

/**
 * The "bip" of "Bipou? Bipaê!": a short confirmation tone generated with Web Audio,
 * so no audio asset is needed. Silently does nothing where audio is unavailable.
 */
export function playBeep(enabled = true) {
  if (!enabled || typeof window === 'undefined') return;
  const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return;
  try {
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 1760;
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.09);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.1);
    osc.onended = () => void ctx.close();
  } catch {
    // Audio is a nicety; never break a sale because of it.
  }
}
