import { expect, test, type Page } from '@playwright/test';

/**
 * The <bipae-pdv> element inside a host "admin panel", against the Node reference backend.
 * Playwright locators pierce the shadow DOM, so the tests read like the operator's view.
 */

async function money(page: Page, label: string, digits: string) {
  const input = page.getByLabel(label, { exact: true });
  await input.fill('');
  await input.pressSequentially(digits);
}

// Shortcuts work while the register has focus (the scan field gets it back after each dialog).
async function shortcut(page: Page, key: string) {
  await expect(page.getByLabel('Bipe o código ou digite o nome do produto')).toBeFocused();
  await page.keyboard.press(key);
}

async function scan(page: Page, text: string) {
  const input = page.getByLabel('Bipe o código ou digite o nome do produto');
  await input.fill(text);
  await input.press('Enter');
}

test('full register day: open, sell with weight, discount and split payment, cancel, withdraw, blind close', async ({
  page,
}, info) => {
  test.skip(
    info.project.name !== 'desktop',
    'O fluxo completo roda uma vez (o banco da demo é compartilhado).',
  );
  await page.goto('/');

  // Open the register with R$ 100,00.
  await expect(page.getByRole('heading', { name: 'Abrir o caixa' })).toBeVisible();
  await money(page, 'Troco inicial', '10000');
  await page.getByRole('button', { name: 'Abrir caixa' }).click();
  await expect(page.getByText('Caixa livre')).toBeVisible();

  // Scan by barcode, multiply with 3*, search by name and weigh.
  await scan(page, '7891000100103');
  await scan(page, '3*7891000400104');
  await scan(page, 'banana');
  await page.getByLabel('Peso em KG (ex.: 1,255)').fill('1,255');
  await page.getByRole('button', { name: 'Adicionar', exact: true }).last().click();
  await expect(page.getByRole('cell', { name: /^Arroz Tipo 1 5kg/ })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Alterar quantidade de Leite Integral 1L' }),
  ).toHaveText('3 UN');
  await expect(page.getByRole('button', { name: 'Alterar quantidade de Banana Prata' })).toHaveText(
    '1,255 KG',
  );
  // 28,90 + 3 × 5,59 + 1,255 × 6,99 (8,77) = 54,44
  await expect(page.getByTestId('total')).toHaveText('R$ 54,44');

  // Acima do limite de 10% pede o gerente (P-05): senha errada é recusada, a certa autoriza.
  await shortcut(page, 'F4');
  await page.getByLabel('Percentual').fill('15');
  await expect(page.getByText('Acima de 10% precisa da autorização de um gerente.')).toBeVisible();
  await page.getByLabel('Login do gerente').fill('gerente@demo');
  await page.getByLabel('Senha do gerente').fill('errada');
  await page.getByRole('button', { name: 'Autorizar e aplicar' }).click();
  await expect(page.getByText(/Login ou senha do gerente incorretos/)).toBeVisible();
  await page.getByLabel('Senha do gerente').fill('senha-gerente');
  await page.getByRole('button', { name: 'Autorizar e aplicar' }).click();
  // 54,44 − 15% (8,17) = 46,27
  await expect(page.getByTestId('total')).toHaveText('R$ 46,27');
  // Volta para 5%, dentro do limite, sem precisar do gerente. Espera o diálogo anterior fechar;
  // numa máquina lenta o F4 pode chegar antes de o foco voltar, então tenta de novo.
  await expect(page.getByRole('dialog', { name: 'Desconto na venda' })).toHaveCount(0);
  await expect(async () => {
    await shortcut(page, 'F4');
    await expect(page.getByLabel('Percentual')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15_000 });
  await page.getByLabel('Percentual').fill('5');
  await page.getByRole('button', { name: 'Aplicar desconto' }).click();
  await expect(page.getByTestId('total')).toHaveText('R$ 51,72');

  // Pix R$ 20,00 + cash R$ 50,00 → change R$ 18,28.
  await shortcut(page, 'F2');
  await page.getByRole('radio', { name: 'Pix' }).click();
  await money(page, 'Valor', '2000');
  await page.getByRole('button', { name: 'Lançar Pix' }).click();
  await page.getByRole('radio', { name: 'Dinheiro' }).click();
  await expect(page.getByRole('button', { name: 'R$ 35,00' })).toBeVisible(); // quick cash buttons
  await money(page, 'Valor recebido', '5000');
  await page.getByRole('button', { name: 'Lançar Dinheiro' }).click();
  await expect(page.getByTestId('change')).toHaveText('R$ 18,28');
  await page.getByLabel('CPF ou CNPJ na nota (opcional)').fill('529.982.247-25');
  await page.getByRole('button', { name: 'Concluir venda' }).click();
  await expect(page.getByRole('dialog', { name: 'Venda nº 1 registrada' })).toBeVisible();
  await expect(page.getByText('R$ 18,28')).toBeVisible();
  // The host page hears about the sale.
  await expect(page.locator('#log')).toContainText('venda nº 1');
  await page.getByRole('button', { name: 'Nova venda' }).click();

  // Stock went down in the host's own table.
  const stock = await (await page.request.get('/api/estoque')).json();
  expect(Number(stock.find((p: { id: string }) => p.id === 'p4').stock)).toBe(117);

  // A second sale, then cancel it from the sales list.
  await scan(page, 'café');
  await expect(page.getByTestId('total')).toHaveText('R$ 17,49');
  await shortcut(page, 'F2');
  await page.getByRole('radio', { name: 'Cartão de débito' }).click();
  await page.getByRole('button', { name: 'Lançar Cartão de débito' }).click();
  await page.getByRole('button', { name: 'Concluir venda' }).click();
  await page.getByRole('button', { name: 'Nova venda' }).click();
  await shortcut(page, 'F9');
  const list = page.getByRole('dialog', { name: 'Vendas deste caixa' });
  await list.getByRole('row', { name: /^2 / }).getByRole('button', { name: 'Cancelar' }).click();
  await list.getByLabel('Motivo do cancelamento').fill('Cliente desistiu');
  await list.getByRole('button', { name: 'Cancelar venda' }).click();
  await expect(list.getByText('cancelada')).toBeVisible();
  await list.getByRole('button', { name: 'Fechar' }).click();

  // Withdrawal larger than the drawer is refused; a normal one works.
  await page.getByRole('button', { name: 'Sangria' }).click();
  await money(page, 'Valor', '99999');
  await page.getByLabel('Motivo').fill('Depósito');
  await page.getByRole('button', { name: 'Registrar sangria' }).click();
  await expect(page.getByText(/A gaveta tem R\$ 131,72 em dinheiro/)).toBeVisible();
  await money(page, 'Valor', '3000');
  await page.getByRole('button', { name: 'Registrar sangria' }).click();
  await expect(page.getByText('Sangria de R$ 30,00 registrada.')).toBeVisible();

  // Blind close: cash expected 100 + 31,72 − 30 = 101,72; Pix 20,00. Count R$ 1,00 short.
  await page.getByRole('button', { name: 'Fechar caixa' }).click();
  await money(page, 'Dinheiro na gaveta', '10072');
  await money(page, 'Total em Pix', '2000');
  await page.getByRole('button', { name: 'Confirmar contagem e fechar' }).click();
  const closed = page.getByRole('dialog', { name: 'Caixa fechado' });
  await expect(closed.getByRole('row', { name: /Dinheiro/ })).toContainText('R$ 101,72');
  await expect(closed.getByText('Falta de R$ 1,00.')).toBeVisible();
  await expect(page.locator('#log')).toContainText('diferença -100');
  await closed.getByRole('button', { name: 'Concluir' }).click();
  await expect(page.getByRole('heading', { name: 'Abrir o caixa' })).toBeVisible();
});

test('fits a tablet and explains a wrong configuration', async ({ page }, info) => {
  test.skip(info.project.name !== 'tablet');
  await page.goto('/');
  await expect(page.getByText('Mercadinho Demonstração').first()).toBeVisible();
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const width = await page.evaluate(() => window.innerWidth);
  expect(scrollWidth).toBeLessThanOrEqual(width);

  await page.evaluate(() => {
    const el = document.createElement('bipae-pdv');
    el.setAttribute('api', '/api/pdv');
    el.setAttribute('token', 'token-invalido');
    el.id = 'bad';
    document.querySelector('main')!.append(el);
  });
  await expect(
    page.locator('#bad').getByText('Sua sessão expirou. Entre de novo no sistema.'),
  ).toBeVisible();
});

test('fast scanner on a slow network: no scan is lost', async ({ page }, info) => {
  test.skip(info.project.name !== 'tablet');
  // Every product lookup takes 300 ms, like a busy store connection.
  await page.route('**/api/pdv/products**', async (route) => {
    await new Promise((r) => setTimeout(r, 300));
    await route.continue();
  });
  await page.goto('/');
  const open = page.getByRole('button', { name: 'Abrir caixa' });
  await expect(open.or(page.getByText('Caixa livre'))).toBeVisible();
  if (await open.isVisible()) await open.click();

  const input = page.getByLabel('Bipe o código ou digite o nome do produto');
  for (const code of ['7891000100103', '7891000200100', '7891000100103']) {
    await input.fill(code);
    await input.press('Enter'); // no waiting between reads, like a barcode scanner
  }
  await expect(
    page.getByRole('button', { name: 'Alterar quantidade de Arroz Tipo 1 5kg' }),
  ).toHaveText('2 UN');
  await expect(
    page.getByRole('button', { name: 'Alterar quantidade de Feijão Carioca 1kg' }),
  ).toHaveText('1 UN');
  // 2 × 28,90 + 8,99
  await expect(page.getByTestId('total')).toHaveText('R$ 66,79');
});
