import AxeBuilder from '@axe-core/playwright';
import { expect, request, test, type Page } from '@playwright/test';
import { settleAnimations } from './animations';

/**
 * F8-15: o caixa redesenhado. Uma venda em cada modo de tela ("Venda em destaque" e "Grade de
 * produtos"), com o guia da primeira venda, o pagamento em cartões e a venda concluída.
 */
test.skip(() => test.info().project.name !== 'web', 'As telas são as mesmas nas duas cascas.');

/** WCAG 2.2 AA pelo axe, como nas outras telas do caixa (F7-03). */
async function semViolacoes(page: Page, onde: string) {
  await settleAnimations(page);
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(axe.violations.map((v) => `${onde} · ${v.id}: ${v.help}`)).toEqual([]);
}

async function abrirCaixa(page: Page) {
  const email = `modos-${Date.now()}@exemplo.com.br`;
  const api = await request.newContext({ baseURL: 'http://localhost:3334/v1/' });
  const conta = await (
    await api.post('auth/signup', {
      data: {
        ownerName: 'Lia Dona',
        businessName: `Padaria ${Date.now()}`,
        email,
        password: 'senha-forte-123',
      },
    })
  ).json();
  const headers = { authorization: `Bearer ${conta.accessToken}` };
  for (const p of [
    { name: 'Café com Leite', priceCents: 650, category: 'Bebidas', barcodes: ['789000011'] },
    { name: 'Suco de Laranja', priceCents: 900, category: 'Bebidas', barcodes: ['789000028'] },
    { name: 'Pão de Queijo', priceCents: 450, category: 'Padaria', barcodes: ['789000035'] },
    { name: 'Coxinha', priceCents: 700, category: 'Salgados', barcodes: ['789000042'] },
  ]) {
    expect((await api.post('products', { headers, data: p })).ok(), p.name).toBeTruthy();
  }
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByRole('link', { name: 'Abrir o caixa' }).click();
  await page.getByLabel('Novo caixa').fill('Balcão');
  await page.getByRole('button', { name: 'Criar e usar este caixa' }).click();
  await page.getByLabel('Dinheiro na gaveta para troco (R$)').fill('0', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Abrir caixa' }).click();
  await expect(page.getByText('Caixa livre')).toBeVisible();
}

test('vende na venda em destaque e na grade de produtos, e o caixa lembra o modo', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1366, height: 768 });
  await abrirCaixa(page);

  // Venda em destaque (o padrão), com o guia da primeira venda.
  const modos = page.getByRole('group', { name: 'Modo da tela' });
  await expect(modos.getByRole('button', { name: 'Venda em destaque' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByTestId('pdv-tip')).toContainText('Bipe ou digite aqui');
  const campo = page.getByLabel('Bipe o código ou digite o nome do produto');
  await campo.fill('2*789000011');
  await campo.press('Enter');
  await expect(page.getByTestId('pdv-last-item')).toContainText('Café com Leite');
  await expect(page.getByTestId('pdv-last-item')).toContainText('2 UN × R$ 6,50');
  await expect(page.getByTestId('pdv-tip')).toContainText('Toque para receber');

  // Busca por nome: o produto aparece com a foto (iniciais) e o preço, para tocar.
  await campo.fill('coxi');
  const resultados = page.getByRole('list', { name: 'Resultados da busca' });
  await resultados.getByRole('button', { name: /Coxinha/ }).click();
  await expect(page.getByTestId('pdv-total')).toHaveText('R$ 20,00');

  // Pagamento em cartões, com a nota de R$ 50 e o troco em destaque.
  await page.getByRole('button', { name: 'Receber (F10)' }).click();
  const pagamento = page.getByRole('dialog', { name: 'Pagamento' });
  await expect(pagamento.getByRole('radio', { name: 'Dinheiro' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await pagamento
    .getByRole('group', { name: 'Notas rápidas' })
    .getByRole('button', { name: 'R$ 50,00' })
    .click();
  await expect(pagamento.getByTestId('payment-change')).toContainText('R$ 30,00');
  await pagamento.getByRole('button', { name: 'Finalizar venda' }).click();

  // Venda concluída: troco gigante; o Enter segue para a próxima.
  const sucesso = page.getByTestId('sale-success');
  await expect(sucesso.getByTestId('sale-change')).toHaveText('R$ 30,00');
  await expect(page.getByText('Bipaê! Venda nº 1 concluída. Troco: R$ 30,00.')).toBeVisible();
  await expect(page.getByTestId('pdv-tip')).toHaveCount(0);
  await semViolacoes(page, 'venda concluída');
  await page.keyboard.press('Enter');
  await expect(sucesso).toHaveCount(0);
  await expect(page.getByText('Caixa livre')).toBeVisible();

  // Grade de produtos: abas de categorias e produtos para tocar.
  await modos.getByRole('button', { name: 'Grade de produtos' }).click();
  const abas = page.getByRole('navigation', { name: 'Categorias' });
  await expect(abas.getByRole('button')).toHaveText(['Todos', 'Bebidas', 'Padaria', 'Salgados']);
  await abas.getByRole('button', { name: 'Padaria' }).click();
  const grade = page.getByRole('list', { name: 'Produtos' });
  await expect(grade.getByRole('button')).toHaveCount(1);
  await grade.getByRole('button', { name: /Pão de Queijo/ }).click();
  await grade.getByRole('button', { name: /Pão de Queijo/ }).click();
  await expect(grade.getByRole('button', { name: /Pão de Queijo/ })).toHaveAccessibleName(
    'Pão de Queijo, R$ 4,50, 2 na venda',
  );
  await expect(page.getByTestId('pdv-total')).toHaveText('R$ 9,00');
  await semViolacoes(page, 'grade de produtos');
  await page.keyboard.press('F10');
  await pagamento.getByRole('radio', { name: 'Pix' }).click();
  await pagamento.getByRole('button', { name: 'Adicionar pix' }).click();
  await pagamento.getByRole('button', { name: 'Pagamento recebido' }).click();
  await pagamento.getByRole('button', { name: 'Finalizar venda' }).click();
  await expect(sucesso.getByRole('heading', { name: 'Venda nº 2 concluída!' })).toBeVisible();
  await sucesso.getByRole('button', { name: 'Próxima venda' }).click();
  await expect(sucesso).toHaveCount(0);

  // O caixa lembra o modo: recarregar volta na grade.
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Categorias' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(modos.getByRole('button', { name: 'Grade de produtos' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});
