import type { Platform } from '@bipae/platform';
import { useCallback, useEffect, useState } from 'react';

/**
 * Preferências do caixa guardadas no próprio aparelho (F8-15), pelo port de preferências da
 * plataforma: nada vai para a rede e tudo funciona sem internet.
 */

/** Os dois modos de tela do caixa. */
export type RegisterMode = 'spotlight' | 'grid';

export const REGISTER_MODES: Record<RegisterMode, string> = {
  spotlight: 'Venda em destaque',
  grid: 'Grade de produtos',
};

/** O modo de tela é por caixa: cada terminal lembra o seu. */
export const layoutPrefKey = (terminalId: string) => `bipae.pdv.layout.${terminalId}`;
/** Dicas da primeira venda: "seen" depois de vistas ou puladas. */
export const TIPS_PREF = 'bipae.pdv.tips';
/** Som curto da venda concluída: "on" liga; desligado por padrão. */
export const SUCCESS_SOUND_PREF = 'bipae.pdv.success-sound';

/**
 * Lê e grava uma preferência de texto. `loaded` diz se a leitura já voltou, para a tela não
 * piscar com o valor padrão (por exemplo, mostrar as dicas a quem já viu).
 */
export function usePreference<T extends string>(
  platform: Platform,
  key: string,
  fallback: T,
  allowed: readonly T[],
): { value: T; set: (next: T) => void; loaded: boolean } {
  const [value, setValue] = useState<T>(fallback);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    setLoaded(false);
    void platform.preferences
      .get(key)
      .catch(() => null)
      .then((raw) => {
        if (!alive) return;
        setValue(
          raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback,
        );
        setLoaded(true);
      });
    return () => {
      alive = false;
    };
    // `allowed` e `fallback` são constantes de quem chama.
  }, [platform, key]);
  const set = useCallback(
    (next: T) => {
      setValue(next);
      void platform.preferences.set(key, next).catch(() => undefined);
    },
    [platform, key],
  );
  return { value, set, loaded };
}

/** Verdadeiro quando o sistema pede menos movimento: a tela de sucesso fica parada. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Som curto da venda concluída: duas notas subindo, geradas na hora (Web Audio), sem arquivo
 * de áudio. Onde não há áudio, não faz nada; nunca atrapalha a venda.
 */
export function playSuccessSound() {
  if (typeof window === 'undefined') return;
  const AudioCtx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return;
  try {
    const ctx = new AudioCtx();
    const notes = [1046.5, 1318.5];
    notes.forEach((frequency, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = ctx.currentTime + i * 0.12;
      osc.type = 'sine';
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.12, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.2);
      if (i === notes.length - 1) osc.onended = () => void ctx.close();
    });
  } catch {
    // Som é um agrado: nunca quebra a venda.
  }
}
