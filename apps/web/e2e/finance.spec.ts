import { expect, test } from '@playwright/test';

/** F4-04: lançar uma conta parcelada e dar baixa. */
test.skip(() => test.info().project.name !== 'web', 'A retaguarda é a mesma nas duas cascas.');

test('conta a pagar em 3 parcelas, baixa da primeira e resumo atualizado', async ({ page }) => {
  await page.goto('/criar-conta');
  await page.getByLabel('Seu nome').fill('Leo Dono');
  await page.getByLabel('Nome do negócio').fill(`Padaria ${Date.now()}`);
  await page.getByLabel('E-mail').fill(`leo-${Date.now()}@exemplo.com.br`);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Criar conta grátis' }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Leo!' })).toBeVisible();

  await page.getByRole('link', { name: 'Contas a pagar e receber' }).click();
  await page.getByRole('button', { name: 'Nova conta' }).click();
  await page.getByLabel('Descrição').fill('Forno novo');
  await page.getByLabel('Valor total').fill('300,00');
  await page.getByLabel('Valor total').blur();
  await page.getByLabel('Primeiro vencimento').fill('2099-03-10');
  await page.getByLabel('Parcelas').fill('3');
  await page.getByRole('button', { name: 'Lançar conta' }).click();

  await expect(page.getByRole('row', { name: /Forno novo \(1\/3\)/ })).toContainText('10/03/2099');
  await expect(page.getByRole('row', { name: /Forno novo \(3\/3\)/ })).toContainText('10/05/2099');
  await expect(page.getByTestId('open-payable')).toHaveText('R$ 300,00');

  await page.getByRole('row', { name: /Forno novo \(1\/3\)/ }).click();
  await page.getByRole('button', { name: 'Confirmar pagamento' }).click();
  await expect(page.getByTestId('open-payable')).toHaveText('R$ 200,00');
  await expect(page.getByRole('row', { name: /Forno novo \(1\/3\)/ })).toHaveCount(0);
});

test('fluxo de caixa mostra a conta paga hoje (F4-05)', async ({ page }) => {
  await page.goto('/criar-conta');
  await page.getByLabel('Seu nome').fill('Ana Dona');
  await page.getByLabel('Nome do negócio').fill(`Quitanda ${Date.now()}`);
  await page.getByLabel('E-mail').fill(`ana-fluxo-${Date.now()}@exemplo.com.br`);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Criar conta grátis' }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Ana!' })).toBeVisible();

  await page.getByRole('link', { name: 'Contas a pagar e receber' }).click();
  await page.getByRole('button', { name: 'Nova conta' }).click();
  await page.getByLabel('Descrição').fill('Energia');
  await page.getByLabel('Valor total').fill('150,00');
  await page.getByLabel('Valor total').blur();
  await page.getByRole('button', { name: 'Lançar conta' }).click();
  await page.getByRole('row', { name: /Energia/ }).click();
  await page.getByRole('button', { name: 'Confirmar pagamento' }).click();
  await expect(page.getByRole('row', { name: /Energia/ })).toHaveCount(0);

  await page.getByRole('link', { name: 'Fluxo de caixa' }).click();
  await expect(page.getByTestId('cash-flow-net')).toHaveText('-R$ 150,00');
});

test('DRE gerencial mostra a despesa do mês por categoria (F4-06)', async ({ page }) => {
  await page.goto('/criar-conta');
  await page.getByLabel('Seu nome').fill('Edu Dono');
  await page.getByLabel('Nome do negócio').fill(`Açougue ${Date.now()}`);
  await page.getByLabel('E-mail').fill(`edu-dre-${Date.now()}@exemplo.com.br`);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Criar conta grátis' }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Edu!' })).toBeVisible();

  await page.getByRole('link', { name: 'Contas a pagar e receber' }).click();
  await page.getByRole('button', { name: 'Nova conta' }).click();
  await page.getByLabel('Descrição').fill('Aluguel da loja');
  await page.getByLabel('Categoria').fill('Aluguel');
  await page.getByLabel('Valor total').fill('2.000,00');
  await page.getByLabel('Valor total').blur();
  await page.getByRole('button', { name: 'Lançar conta' }).click();
  await expect(page.getByRole('row', { name: /Aluguel da loja/ })).toBeVisible();

  await page.getByRole('link', { name: 'DRE gerencial' }).click();
  await expect(page.getByRole('row', { name: /^Aluguel/ })).toContainText('R$ 2.000,00');
  await expect(page.getByRole('row', { name: /Resultado/ })).toContainText('-R$ 2.000,00');
});

test('importa o extrato OFX e concilia com a conta sugerida (F4-07)', async ({ page }) => {
  await page.goto('/criar-conta');
  await page.getByLabel('Seu nome').fill('Rita Dona');
  await page.getByLabel('Nome do negócio').fill(`Mercearia ${Date.now()}`);
  await page.getByLabel('E-mail').fill(`rita-ofx-${Date.now()}@exemplo.com.br`);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Criar conta grátis' }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Rita!' })).toBeVisible();

  await page.getByRole('link', { name: 'Contas a pagar e receber' }).click();
  await page.getByRole('button', { name: 'Nova conta' }).click();
  await page.getByLabel('Descrição').fill('Internet');
  await page.getByLabel('Valor total').fill('99,90');
  await page.getByLabel('Valor total').blur();
  await page.getByLabel('Primeiro vencimento').fill('2026-10-05');
  await page.getByRole('button', { name: 'Lançar conta' }).click();
  await expect(page.getByRole('row', { name: /Internet/ })).toBeVisible();

  await page.getByRole('link', { name: 'Conciliação bancária' }).click();
  const extrato = `OFXHEADER:100\nDATA:OFXSGML\nCHARSET:1252\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL
<BANKACCTFROM><BANKID>0001<ACCTID>777-0</BANKACCTFROM><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261006<TRNAMT>-99.90<FITID>Z1<MEMO>DÉBITO PROVEDOR</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
  await page.locator('input[type=file]').setInputFiles({
    name: 'extrato.ofx',
    mimeType: 'application/x-ofx',
    buffer: Buffer.from(extrato, 'latin1'),
  });
  await expect(page.getByText('Banco 0001 · Conta 777-0: 1 lançamento(s) novo(s).')).toBeVisible();
  const linha = page.getByRole('row', { name: /DÉBITO PROVEDOR/ });
  await linha.getByRole('button', { name: 'Internet (05/10/2026)' }).click();
  await expect(page.getByText('Conciliado com Internet.')).toBeVisible();
  await expect(page.getByText('Nada para conciliar')).toBeVisible();
});
