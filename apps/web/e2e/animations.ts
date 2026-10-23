import type { Page } from '@playwright/test';

/**
 * Espera as animações de entrada terminarem antes de medir a tela. O axe calcula o contraste com a
 * opacidade do momento: no meio de um "aparecer" (opacidade de 0 a 1) o texto sai como ilegível.
 * As animações sem fim (o "pulsar" do carregamento) não entram na espera.
 */
export async function settleAnimations(page: Page) {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity,
      ),
  );
}
