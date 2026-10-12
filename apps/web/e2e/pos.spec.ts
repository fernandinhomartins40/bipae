import { expect, test, type Page } from '@playwright/test';

/**
 * The register end to end, in both shells (ADR-0012): sell online, lose the internet and keep
 * selling, reconnect and see everything in the back office, then close the register blind.
 */
const isDesktop = () => test.info().project.name === 'desktop-ui';
const go = (page: Page, path: string) => page.goto(isDesktop() ? `/#${path}` : path);
const unique = () => `${test.info().project.name}-${Date.now()}`;

async function signupWithProducts(page: Page) {
  const email = `rafael-${unique()}@exemplo.com.br`;
  await go(page, '/criar-conta');
  await page.getByLabel('Seu nome').fill('Rafael Souza');
  await page.getByLabel('Nome do negócio').fill('Mercadinho do Rafael');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Criar conta grátis' }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Rafael!' })).toBeVisible();

  await page.getByRole('link', { name: 'Produtos', exact: true }).click();
  for (const p of [
    { name: 'Água Mineral 1,5L', price: '2,99', barcode: '78912342', weighable: false },
    { name: 'Banana Prata', price: '6,99', barcode: '', weighable: true },
  ]) {
    await page.getByRole('button', { name: 'Novo produto' }).click();
    await page.getByLabel('Nome', { exact: true }).fill(p.name);
    await page.getByLabel('Preço de venda').fill(p.price);
    if (p.barcode) await page.getByLabel('Código de barras').fill(p.barcode);
    if (p.weighable) await page.getByLabel('Vendido por peso').check();
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByRole('row', { name: new RegExp(p.name) })).toBeVisible();
  }
  return email;
}

async function scan(page: Page, text: string) {
  const input = page.getByLabel('Bipe o código ou digite o nome do produto');
  await input.fill(text);
  await input.press('Enter');
}

test('sell online, keep selling offline, sync on reconnect, close blind', async ({ page, context }) => {
  await signupWithProducts(page);

  // Link this device to a new register and open it.
  await page.getByRole('link', { name: 'Abrir o caixa' }).click();
  await expect(page.getByRole('heading', { name: 'Qual caixa é este aparelho?' })).toBeVisible();
  await page.getByLabel('Novo caixa').fill('Caixa 1');
  await page.getByRole('button', { name: 'Criar e usar este caixa' }).click();
  await expect(page.getByRole('heading', { name: 'Abrir o caixa' })).toBeVisible();
  await page.getByLabel('Dinheiro na gaveta para troco (R$)').fill('100,00');
  await page.getByRole('button', { name: 'Abrir caixa' }).click();
  await expect(page.getByText('Caixa livre')).toBeVisible();

  // Sale 1 (online): barcode, multiplier and a weighed item; cash with change.
  await scan(page, '78912342');
  await scan(page, '2*78912342');
  await expect(page.getByTestId('pdv-total')).toHaveText('R$ 8,97');
  await scan(page, 'banana');
  await page.getByLabel('Peso (KG)').fill('1,250');
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByTestId('pdv-total')).toHaveText('R$ 17,71');
  await page.keyboard.press('F10');
  await page.getByLabel('Valor recebido (R$)').fill('20,00');
  await page.getByRole('button', { name: 'Adicionar dinheiro' }).click();
  await expect(page.getByText('Troco')).toBeVisible();
  await page.getByRole('button', { name: 'Finalizar venda' }).click();
  await expect(page.getByText('Bipaê! Venda nº 1 concluída. Troco: R$ 2,29.')).toBeVisible();

  // Internet goes down. The register keeps selling.
  await context.setOffline(true);
  await scan(page, '78912342');
  await page.keyboard.press('F6');
  await page.getByLabel('CPF ou CNPJ do cliente').fill('12345678909');
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await page.getByRole('button', { name: 'Pagar (F10)' }).click();
  await page.getByRole('radio', { name: 'Pix' }).click();
  await page.getByRole('button', { name: 'Adicionar pix' }).click();
  await page.getByRole('button', { name: 'Pagamento recebido' }).click();
  await page.getByRole('button', { name: 'Finalizar venda' }).click();
  await expect(page.getByText('Bipaê! Venda nº 2 concluída.')).toBeVisible();
  await expect(page.getByTestId('sync-status')).toContainText('Sem conexão');
  await expect(page.getByTestId('sync-status')).toContainText('para enviar');

  // Back online: pending sales go up by themselves.
  await context.setOffline(false);
  await expect(page.getByTestId('sync-status')).toContainText('sincronizado agora', { timeout: 15_000 });
  await expect(page.getByTestId('sync-status')).not.toContainText('para enviar');

  // Blind close: count the drawer; the difference shows only after confirming.
  await page.keyboard.press('F9');
  await page.getByRole('button', { name: 'Fechar o caixa' }).click();
  await page.getByLabel('Dinheiro (R$)').fill('117,71');
  await page.getByLabel('Pix (R$)').fill('2,99');
  await page.getByRole('button', { name: 'Confirmar fechamento' }).click();
  await expect(page.getByText('Bateu certinho. Bipaê!')).toBeVisible();
  await page.getByRole('button', { name: 'Ok' }).click();
  await expect(page.getByRole('heading', { name: 'Abrir o caixa' })).toBeVisible();

  // The back office sees both sales, with stock moved by the ledger.
  await page.getByRole('button', { name: 'Voltar' }).click();
  await page.getByRole('link', { name: 'Vendas' }).click();
  await expect(page.getByRole('row', { name: /Caixa 1 · nº 1/ })).toContainText('R$ 17,71');
  await expect(page.getByRole('row', { name: /Caixa 1 · nº 2/ })).toContainText('123.456.789-09');
  await page.getByRole('link', { name: 'Produtos', exact: true }).click();
  await expect(page.getByRole('row', { name: /Água Mineral/ })).toContainText('-4');
});

test('discount above the limit needs a manager, who approves on the cashier screen', async ({ page }) => {
  const ownerEmail = await signupWithProducts(page);
  // The owner may give any discount, so create a cashier and sell as them.
  await page.getByRole('link', { name: 'Equipe' }).click();
  await page.getByRole('button', { name: 'Adicionar pessoa' }).click();
  const email = `caixa-${unique()}@exemplo.com.br`;
  await page.getByLabel('Nome').fill('Juliana');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha inicial').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Adicionar' }).click();
  await expect(page.getByRole('row', { name: /Juliana/ })).toBeVisible();

  // A register must exist for the cashier to pick.
  await page.getByRole('link', { name: 'Caixas' }).click();
  await page.getByRole('button', { name: 'Novo caixa' }).click();
  await page.getByLabel('Nome do caixa').fill('Caixa da Ju');
  await page.getByRole('button', { name: 'Criar caixa' }).click();
  await expect(page.getByRole('row', { name: /Caixa da Ju/ })).toBeVisible();

  await page.getByRole('button', { name: 'Sair' }).click();
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByRole('link', { name: 'Abrir o caixa' }).click();
  await page.getByRole('button', { name: /Caixa da Ju/ }).click();
  await page.getByRole('button', { name: 'Abrir caixa' }).click();

  await scan(page, '78912342');
  await page.keyboard.press('F4');
  await page.getByLabel('Desconto (%)').fill('50');
  await page.getByRole('button', { name: 'Aplicar desconto' }).click();
  await expect(page.getByRole('heading', { name: 'Autorização do gerente' })).toBeVisible();
  await page.getByLabel('E-mail do gerente').fill(email);
  await page.getByLabel('Senha do gerente').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Autorizar' }).click();
  await expect(page.getByText('Esta pessoa não tem permissão para autorizar isso.')).toBeVisible();

  // The owner approves with their own credentials; the discount is applied and recorded.
  await page.getByLabel('E-mail do gerente').fill(ownerEmail);
  await page.getByRole('button', { name: 'Autorizar' }).click();
  await expect(page.getByTestId('pdv-total')).toHaveText('R$ 1,49');
  await page.keyboard.press('F10');
  await page.getByRole('radio', { name: 'Pix' }).click();
  await page.getByRole('button', { name: 'Adicionar pix' }).click();
  await page.getByRole('button', { name: 'Pagamento recebido' }).click();
  await page.getByRole('button', { name: 'Finalizar venda' }).click();
  await expect(page.getByText('Bipaê! Venda nº 1 concluída.')).toBeVisible();
});
