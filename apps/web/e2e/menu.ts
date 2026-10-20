import type { Page } from '@playwright/test';

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Abre uma tela pelo menu principal, como a pessoa faria: no celular abre a gaveta, e a tela
 * dentro de um grupo fechado é achada pela busca do menu. O nome casa pelo começo do link,
 * porque alguns itens trazem um contador ("Notas de entrada 2").
 */
export async function abrirNoMenu(page: Page, nome: string | RegExp) {
  const pattern = typeof nome === 'string' ? new RegExp(`^${escape(nome)}`) : nome;
  const botao = page.getByRole('button', { name: 'Abrir o menu' });
  const menu = page.getByRole('navigation', { name: 'Menu principal' });
  // No computador o botão do menu fica escondido; no celular, o menu até a gaveta abrir.
  await botao.or(menu).filter({ visible: true }).first().waitFor();
  if (await botao.isVisible()) await botao.click();
  const link = menu.getByRole('link', { name: pattern }).first();
  if (!(await link.isVisible())) {
    await page
      .getByRole('searchbox', { name: 'Procurar no menu' })
      .fill(typeof nome === 'string' ? nome : nome.source.replace(/[\\^$]/g, ''));
  }
  await link.click();
}
