import { expect, test } from '@playwright/test';

/** F3-06.b: busca de NCM pelo nome, sugestão de CEST e significado dos códigos do perfil fiscal. */
test.skip(() => test.info().project.name !== 'web', 'A retaguarda é a mesma nas duas cascas.');

test('achar o NCM pelo nome do produto, escolher o CEST e ver o que cada código significa', async ({ page }) => {
  await page.goto('/criar-conta');
  await page.getByLabel('Seu nome').fill('Rita Dona');
  await page.getByLabel('Nome do negócio').fill(`Empório ${Date.now()}`);
  await page.getByLabel('E-mail').fill(`rita-${Date.now()}@exemplo.com.br`);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Criar conta grátis' }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Rita!' })).toBeVisible();

  // ---------------------------------------------------------------- produto
  await page.getByRole('link', { name: 'Produtos', exact: true }).click();
  await page.getByRole('button', { name: 'Novo produto' }).click();
  await page.getByLabel('Nome', { exact: true }).fill('Cerveja Garrafa 600 ml');
  await page.getByLabel('Preço de venda').fill('9,90');

  // NCM digitado errado: o aviso aparece antes de salvar.
  await page.getByLabel('NCM', { exact: true }).fill('99999999');
  await expect(page.getByText('O NCM 9999.99.99 não está na tabela vigente.')).toBeVisible();

  // Busca pelo nome da mercadoria e escolhe na lista.
  await page.getByLabel('Não sabe o NCM? Busque pelo nome da mercadoria').fill('cervejas malte');
  await page.getByRole('list', { name: 'NCM encontrados' }).getByRole('button', { name: /2203\.00\.00/ }).click();
  await expect(page.getByLabel('NCM', { exact: true })).toHaveValue('22030000');
  await expect(page.getByText('NCM 2203.00.00:')).toBeVisible();

  // O CEST vem sugerido pelo NCM.
  await expect(page.getByText('CEST previstos para este NCM')).toBeVisible();
  await page
    .getByRole('list', { name: 'CEST sugeridos' })
    .getByRole('button', { name: /03\.021\.00 — Cerveja em garrafa de vidro retornável/ })
    .click();
  await expect(page.getByLabel('CEST', { exact: true })).toHaveValue('0302100');

  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await page.getByRole('row', { name: /Cerveja Garrafa 600 ml/ }).click();
  await expect(page.getByLabel('NCM', { exact: true })).toHaveValue('22030000');
  await expect(page.getByLabel('CEST', { exact: true })).toHaveValue('0302100');
  await page.getByRole('button', { name: 'Cancelar' }).click();

  // ---------------------------------------------------------------- perfil fiscal
  await page.getByRole('link', { name: 'Perfis fiscais' }).click();
  await page.getByRole('button', { name: 'Novo perfil' }).click();
  await page.getByLabel('Nome do perfil').fill('Teste de códigos');
  // O campo explica o código digitado.
  await expect(page.getByText(/^Venda de mercadoria adquirida ou recebida de terceiros/).first()).toBeVisible();
  await page.getByLabel('CSOSN').fill('500');
  // O mesmo texto existe nas sugestões escondidas do campo; vale o que está visível.
  await expect(
    page.getByText(/ICMS cobrado anteriormente por substituição tributária/).filter({ visible: true }),
  ).toBeVisible();
  await page.getByLabel('CSOSN').fill('999');
  await expect(page.getByText('Este código não está na tabela oficial. Confira antes de salvar.')).toBeVisible();

  // O servidor confere também: CFOP de outro estado no campo de dentro do estado.
  await page.getByLabel('CSOSN').fill('102');
  await page.getByLabel('CFOP dentro do estado').fill('6102');
  await page.getByRole('button', { name: 'Salvar perfil' }).click();
  await expect(page.getByText(/O CFOP 6102 não é de venda dentro do estado/)).toBeVisible();
  await page.getByLabel('CFOP dentro do estado').fill('5102');
  await page.getByRole('button', { name: 'Salvar perfil' }).click();
  await expect(page.getByRole('row', { name: /Teste de códigos/ })).toContainText('5102 / 6102');

  // ---------------------------------------------------------------- empresa: UF e regime (F3-06.c)
  await page.getByRole('link', { name: 'Empresas e lojas' }).click();
  await expect(page.getByText(/Falta configurar: UF e regime tributário/)).toBeVisible();
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  // UF com alíquota confirmada mostra o número e a lei; UF pendente avisa, sem número.
  await page.getByLabel('UF').selectOption('AL');
  await expect(page.getByText(/alíquota geral de ICMS de AL ainda não foi confirmada/)).toBeVisible();
  await page.getByLabel('UF').selectOption('SP');
  await expect(page.getByText('ICMS geral de SP: 18% (RICMS/2000, art. 52, I).')).toBeVisible();
  await page.getByLabel('Regime tributário').selectOption({ label: 'Lucro Real' });
  await expect(page.getByText(/Na nota: CRT 3, ICMS com CST\./)).toBeVisible();
  await page.getByLabel('Regime tributário').selectOption({ label: 'MEI' });
  await expect(page.getByText(/Na nota: CRT 4, ICMS com CSOSN\./)).toBeVisible();
  await page.getByRole('button', { name: 'Salvar empresa' }).click();
  await expect(page.getByText(/· SP · MEI/)).toBeVisible();
  await expect(page.getByText(/Falta configurar/)).toHaveCount(0);
});
