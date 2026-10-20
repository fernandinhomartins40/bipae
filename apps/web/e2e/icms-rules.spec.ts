import { expect, test } from '@playwright/test';
import { abrirNoMenu } from './menu';

/** F3-06.e: regras de ICMS da empresa, com conferência de conflito e exclusão. */
test.skip(() => test.info().project.name !== 'web', 'A retaguarda é a mesma nas duas cascas.');

test('cadastrar, conferir conflito, editar e excluir uma regra de ICMS', async ({ page }) => {
  await page.goto('/criar-conta');
  await page.getByLabel('Seu nome').fill('Lia Dona');
  await page.getByLabel('Nome do negócio').fill(`Adega ${Date.now()}`);
  await page.getByLabel('E-mail').fill(`lia-${Date.now()}@exemplo.com.br`);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Criar conta grátis' }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Lia!' })).toBeVisible();

  await abrirNoMenu(page, 'Regras de ICMS');
  await expect(page.getByText('Nenhuma regra de ICMS ainda')).toBeVisible();

  // Valores de exemplo, como o contador cadastraria.
  const nova = async (nome: string, aliquota: string) => {
    await page.getByRole('button', { name: 'Nova regra' }).click();
    await page.getByLabel('Nome da regra').fill(nome);
    await page.getByLabel('NCM', { exact: true }).fill('2203');
    await page.getByLabel('Alíquota do ICMS (%)').fill(aliquota);
    await page.getByLabel('Fonte').fill('Orientação do contador');
    await page.getByRole('button', { name: 'Salvar regra' }).click();
  };
  await nova('Cervejas', '25');
  const linha = page.getByRole('row', { name: /Cervejas/ });
  await expect(linha).toContainText('2203');
  await expect(linha).toContainText('Alíquota 25%');

  // Outra regra para o mesmo NCM no mesmo período é recusada com a explicação.
  await nova('Cervejas de novo', '20');
  await expect(
    page.getByText(
      'As regras "Cervejas" e "Cervejas de novo" valem para os mesmos NCM no mesmo período.',
    ),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Cancelar' }).click();

  // Editar e excluir.
  await linha.click();
  await page.getByLabel('Alíquota do ICMS (%)').fill('27,5');
  await page.getByRole('button', { name: 'Salvar regra' }).click();
  await expect(linha).toContainText('Alíquota 27,5%');
  await linha.click();
  await page.getByRole('button', { name: 'Excluir regra' }).click();
  await expect(page.getByText('Nenhuma regra de ICMS ainda')).toBeVisible();

  // Só o código de benefício fiscal (cBenef, F3-27): a isenção vem do CST do produto.
  await page.getByRole('button', { name: 'Nova regra' }).click();
  await page.getByLabel('Nome da regra').fill('Isenção do arroz');
  await page.getByLabel('NCM', { exact: true }).fill('1006');
  await page.getByLabel('Código de benefício fiscal (cBenef, opcional)').fill('pr81');
  await page.getByLabel('Fonte').fill('Orientação do contador');
  await page.getByRole('button', { name: 'Salvar regra' }).click();
  await expect(page.getByText(/8 ou 10 letras e números/)).toBeVisible();
  await page.getByLabel('Código de benefício fiscal (cBenef, opcional)').fill('pr810001');
  await page.getByRole('button', { name: 'Salvar regra' }).click();
  await expect(page.getByRole('row', { name: /Isenção do arroz/ })).toContainText(
    'cBenef PR810001',
  );
});

test('ver a referência do Portal da DIFAL com as linhas defasadas (F3-25)', async ({ page }) => {
  await page.goto('/criar-conta');
  await page.getByLabel('Seu nome').fill('Ana Dona');
  await page.getByLabel('Nome do negócio').fill(`Mercearia ${Date.now()}`);
  await page.getByLabel('E-mail').fill(`ana-${Date.now()}@exemplo.com.br`);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Criar conta grátis' }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Ana!' })).toBeVisible();

  await abrirNoMenu(page, 'Empresas e lojas');
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  await page.getByLabel('UF').selectOption('MA');
  await page.getByRole('button', { name: 'Salvar empresa' }).click();
  await expect(page.getByText(/ · MA/)).toBeVisible();

  await abrirNoMenu(page, 'Regras de ICMS');
  await expect(
    page.getByRole('heading', {
      name: 'Referência: alíquotas por produto de MA no Portal da DIFAL',
    }),
  ).toBeVisible();
  await expect(page.getByText('O portal está desatualizado para MA')).toBeVisible();
  const tabela = page.getByRole('table', {
    name: 'Alíquotas por produto de MA no Portal da DIFAL',
  });
  await expect(tabela.getByText('Defasada').first()).toBeVisible();
  const linhas = await tabela.getByRole('row').count();
  await page.getByLabel('Procurar no portal').fill('regra geral');
  await expect.poll(() => tabela.getByRole('row').count()).toBeLessThan(linhas);
});

test('MVA oficial de SP sugerida pelo NCM e usada com um clique (F3-26)', async ({ page }) => {
  await page.goto('/criar-conta');
  await page.getByLabel('Seu nome').fill('Rita Dona');
  await page.getByLabel('Nome do negócio').fill(`Laticínios ${Date.now()}`);
  await page.getByLabel('E-mail').fill(`rita-${Date.now()}@exemplo.com.br`);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Criar conta grátis' }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Rita!' })).toBeVisible();

  await abrirNoMenu(page, 'Empresas e lojas');
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  await page.getByLabel('UF').selectOption('SP');
  await page.getByRole('button', { name: 'Salvar empresa' }).click();
  await expect(page.getByText(/ · SP/)).toBeVisible();

  await abrirNoMenu(page, 'Regras de ICMS');
  await page.getByRole('button', { name: 'Nova regra' }).click();
  await page.getByLabel('Nome da regra').fill('Leite UHT');
  await page.getByLabel('Vale a partir de').fill('2026-10-16');
  await page.getByLabel('NCM', { exact: true }).fill('0401.10.10');
  const sugestao = page.getByRole('region', { name: 'MVA oficial' });
  await expect(sugestao).toContainText('MVA 23,06%');
  await expect(sugestao).toContainText('Portaria SRE 12/2026');
  await sugestao.getByRole('button', { name: 'Usar 23,06%' }).click();
  await expect(page.getByLabel('MVA (%)')).toHaveValue('23.06');
  await expect(page.getByLabel('Fonte')).toHaveValue(
    /Portaria SRE 12\/2026.*CEST 17\.016\.00.*23,06%/,
  );

  // Água sanitária: os produtos de limpeza saíram da ST em SP (F3-26.b).
  await page.getByLabel('NCM', { exact: true }).fill('2828.90.11');
  await expect(page.getByText('Saiu da substituição tributária em SP')).toBeVisible();
  const aviso = page.getByText(/Produtos de limpeza \(CEST 11\.001\.00\) saiu da ST/);
  await expect(aviso).toContainText('01/08/2026');
  await expect(aviso).toContainText('Portaria SRE 20/2026');

  // Cerveja: continua na ST, com a base pela pauta da Portaria SRE 27/2026 (F3-26.e).
  await page.getByLabel('NCM', { exact: true }).fill('2203.00.00');
  await expect(page.getByText('Base da ST pela pauta em SP')).toBeVisible();
  await expect(
    page.getByText(/de 01\/07\/2026 a 31\/12\/2026 \(Portaria SRE 27\/2026/),
  ).toBeVisible();
  await expect(page.getByText(/chega em breve/)).toBeVisible();

  // cBenef em SP: o SEM CBENEF não é mais aceito desde 01/07/2026 (Tabela CST x cBenef).
  await page.getByLabel('Código de benefício fiscal (cBenef, opcional)').fill('SEM CBENEF');
  await expect(page.getByText('Código fora da vigência')).toBeVisible();
});

test('Paraná: MVA da Resolução SEFA 571/2019 e eletrônicos fora da ST (F3-26.c)', async ({
  page,
}) => {
  await page.goto('/criar-conta');
  await page.getByLabel('Seu nome').fill('Davi Dono');
  await page.getByLabel('Nome do negócio').fill(`Doceria ${Date.now()}`);
  await page.getByLabel('E-mail').fill(`davi-${Date.now()}@exemplo.com.br`);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Criar conta grátis' }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Davi!' })).toBeVisible();

  await abrirNoMenu(page, 'Empresas e lojas');
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  await page.getByLabel('UF').selectOption('PR');
  await page.getByRole('button', { name: 'Salvar empresa' }).click();
  await expect(page.getByText(/ · PR/)).toBeVisible();

  await abrirNoMenu(page, 'Regras de ICMS');
  await page.getByRole('button', { name: 'Nova regra' }).click();
  await page.getByLabel('Nome da regra').fill('Chocolate branco');
  await page.getByLabel('Vale a partir de').fill('2026-10-17');
  await page.getByLabel('NCM', { exact: true }).fill('1704.90.10');
  const sugestao = page.getByRole('region', { name: 'MVA oficial' });
  await expect(sugestao).toContainText('41,47%');
  await expect(sugestao).toContainText('Resolução SEFA 571/2019');
  // Dois CEST com a mesma MVA (chocolate branco e o 17.005.00): usar o do chocolate branco.
  await sugestao
    .getByRole('listitem')
    .filter({ hasText: 'CEST 17.001.00' })
    .getByRole('button', { name: 'Usar 41,47%' })
    .click();
  await expect(page.getByLabel('MVA (%)')).toHaveValue('41.47');

  // Ar-condicionado: os eletrônicos saíram da ST no PR em 01/03/2026.
  await page.getByLabel('NCM', { exact: true }).fill('8415.10.11');
  await expect(page.getByText('Saiu da substituição tributária em PR')).toBeVisible();
  await expect(page.getByText(/Decreto 12\.828\/2026/).first()).toBeVisible();

  // cBenef (F3-27.b): a tabela oficial do PR explica o código e os CST.
  await page.getByLabel('Código de benefício fiscal (cBenef, opcional)').fill('PR810205');
  const cb = page.getByRole('region', { name: 'Código de benefício' });
  await expect(cb).toContainText('74-A do Anexo V');
  await expect(cb).toContainText('CST 30, CST 40');
  await page.getByLabel('Código de benefício fiscal (cBenef, opcional)').fill('PR999999');
  await expect(page.getByText('Código fora da tabela de PR')).toBeVisible();
});

test('Minas Gerais: MVA do leite UHT pelo Anexo XV do RICMS/MG (F3-26.c.MG)', async ({ page }) => {
  await page.goto('/criar-conta');
  await page.getByLabel('Seu nome').fill('Bia Dona');
  await page.getByLabel('Nome do negócio').fill(`Empório ${Date.now()}`);
  await page.getByLabel('E-mail').fill(`bia-${Date.now()}@exemplo.com.br`);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Criar conta grátis' }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Bia!' })).toBeVisible();

  await abrirNoMenu(page, 'Empresas e lojas');
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  await page.getByLabel('UF').selectOption('MG');
  await page.getByRole('button', { name: 'Salvar empresa' }).click();
  await expect(page.getByText(/ · MG/)).toBeVisible();

  await abrirNoMenu(page, 'Regras de ICMS');
  await page.getByRole('button', { name: 'Nova regra' }).click();
  await page.getByLabel('Nome da regra').fill('Leite UHT');
  await page.getByLabel('Vale a partir de').fill('2026-10-17');
  await page.getByLabel('NCM', { exact: true }).fill('0401.10.10');
  const sugestao = page.getByRole('region', { name: 'MVA oficial' });
  await expect(sugestao).toContainText('RICMS/MG, Anexo XV, Parte 2');
  await sugestao
    .getByRole('listitem')
    .filter({ hasText: 'CEST 17.016.00' })
    .getByRole('button', { name: 'Usar 15%' })
    .click();
  await expect(page.getByLabel('MVA (%)')).toHaveValue('15');
});
