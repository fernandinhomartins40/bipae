import { useEffect, useState } from 'react';

/**
 * Caixa com cara de app no celular e no tablet em pé (F8-14). Abaixo do `lg` (1024px) o caixa
 * troca para o layout compacto; do notebook para cima continua o layout de sempre.
 */
export const COMPACT_QUERY = '(max-width: 1023.98px)';

function matches(query: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query).matches
    : false;
}

/** Verdadeiro no celular e no tablet em pé. Sem `matchMedia` (testes, SSR), fica no de sempre. */
export function useCompactLayout(): boolean {
  const [compact, setCompact] = useState(() => matches(COMPACT_QUERY));
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(COMPACT_QUERY);
    const update = () => setCompact(list.matches);
    update();
    list.addEventListener?.('change', update);
    return () => list.removeEventListener?.('change', update);
  }, []);
  return compact;
}

/**
 * Altura visível de verdade (F8-14). Escreve `--app-vh` e `--app-vtop` na raiz a partir do
 * `visualViewport`: quando o teclado do celular sobe, a tela do caixa encolhe junto e o campo de
 * bipar e o total continuam à vista. Também trava o "puxar para atualizar", que no meio de uma
 * venda recarregaria a página.
 */
export function useAppViewport(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return;
    const root = document.documentElement;
    const previousOverscroll = root.style.overscrollBehavior;
    root.style.overscrollBehavior = 'none';
    const viewport = window.visualViewport;
    const apply = () => {
      const height = viewport?.height ?? window.innerHeight;
      const top = viewport?.offsetTop ?? 0;
      root.style.setProperty('--app-vh', `${Math.round(height)}px`);
      root.style.setProperty('--app-vtop', `${Math.round(top)}px`);
    };
    apply();
    viewport?.addEventListener('resize', apply);
    viewport?.addEventListener('scroll', apply);
    window.addEventListener('resize', apply);
    return () => {
      viewport?.removeEventListener('resize', apply);
      viewport?.removeEventListener('scroll', apply);
      window.removeEventListener('resize', apply);
      root.style.removeProperty('--app-vh');
      root.style.removeProperty('--app-vtop');
      root.style.overscrollBehavior = previousOverscroll;
    };
  }, [enabled]);
}

/** Já está em tela cheia ou instalado como app (PWA em `standalone`/`fullscreen`)? */
export function isAppLike(): boolean {
  if (typeof document === 'undefined') return true;
  if (document.fullscreenElement) return true;
  return matches('(display-mode: standalone)') || matches('(display-mode: fullscreen)');
}

/** Pede a tela cheia ao navegador. Onde não há suporte (iPhone, por exemplo), não faz nada. */
export async function enterFullscreen(): Promise<boolean> {
  const root = typeof document === 'undefined' ? null : document.documentElement;
  if (!root || !document.fullscreenEnabled || typeof root.requestFullscreen !== 'function') {
    return false;
  }
  try {
    await root.requestFullscreen({ navigationUI: 'hide' });
    return true;
  } catch {
    return false;
  }
}

export async function exitFullscreen(): Promise<void> {
  if (typeof document === 'undefined' || !document.fullscreenElement) return;
  await document.exitFullscreen?.().catch(() => undefined);
}

/** Acompanha se a página está em tela cheia (o usuário pode sair pelo gesto do sistema). */
export function useFullscreenState(): boolean {
  const [on, setOn] = useState(
    () => typeof document !== 'undefined' && Boolean(document.fullscreenElement),
  );
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const update = () => setOn(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);
  return on;
}

/**
 * No navegador do celular, o primeiro toque no caixa pede a tela cheia (a API só aceita depois de
 * um gesto do usuário). Instalado como app ou sem suporte, nada acontece. Ao sair do caixa, a
 * tela cheia que o caixa pediu é desfeita.
 */
export function useFullscreenOnFirstTouch(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return;
    let asked = false;
    const onPointer = (event: PointerEvent) => {
      if (asked || event.pointerType !== 'touch') return;
      asked = true;
      if (!isAppLike()) void enterFullscreen();
    };
    document.addEventListener('pointerdown', onPointer, { capture: true });
    return () => {
      document.removeEventListener('pointerdown', onPointer, { capture: true });
      // A tela cheia é do caixa (pelo primeiro toque ou pelo menu): ao sair, volta ao normal.
      void exitFullscreen();
    };
  }, [enabled]);
}
