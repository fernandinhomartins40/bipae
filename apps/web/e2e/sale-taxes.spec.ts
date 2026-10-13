import { expect, test } from '@playwright/test';

/**
 * F3-06.d3 e d4: do cadastro ao imposto na venda. A empresa informa UF e regime, o produto ganha
 * um perfil fiscal, o caixa vende sem internet e a retaguarda mostra os impostos calculados.
 */
test.skip(() => test.info().project.name !== 'web', 'O caminho é o mesmo nas duas cascas.');

test('configurar a empresa, vender sem internet e ver os impostos da venda na retaguarda', async ({
  page,
  context,
}) => {
  await page.goto('/criar-conta');
  await page.getByLabel('Seu nome').fill('Carla Dona');
  await page.getByLabel('Nome do negócio').fill(`Mercado ${Date.now()}`);
  await page.getByLabel('E-mail').fill(`carla-${Date.now()}@exemplo.com.br`);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Criar conta grátis' }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Carla!' })).toBeVisible();

  // Empresa: São Paulo, Lucro Real.
  await page.getByRole('link', { name: 'Empresas e lojas' }).click();
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  await page.getByLabel('UF').selectOption('SP');
  await page.getByLabel('Regime tributário').selectOption({ label: 'Lucro Real' });
  await page.getByRole('button', { name: 'Salvar empresa' }).click();
  await expect(page.getByText(/· SP · Lucro Real/)).toBeVisible();

  // Perfil fiscal do regime normal.
  await page.getByRole('link', { name: 'Perfis fiscais' }).click();
  await page.getByRole('button', { name: 'Novo perfil' }).click();
  await page.getByLabel('Nome do perfil').fill('Revenda Lucro Real');
  await page.getByLabel('Regime da empresa').selectOption('normal');
  await page.getByLabel('CST do ICMS').fill('00');
  await page.getByLabel('CST do PIS e da COFINS').fill('01');
  await page.getByLabel('cClassTrib (IBS/CBS) — opcional').fill('000001');
  await page.getByRole('button', { name: 'Salvar perfil' }).click();
  await expect(page.getByRole('row', { name: /Revenda Lucro Real/ })).toContainText('CST 00');

  // Um produto com o perfil e outro sem.
  await page.getByRole('link', { name: 'Produtos', exact: true }).click();
  await page.getByRole('button', { name: 'Novo produto' }).click();
  await page.getByLabel('Nome', { exact: true }).fill('Arroz 5 kg');
  await page.getByLabel('Preço de venda').fill('100,00');
  await page.getByLabel('Código de barras').fill('7891000315507');
  await page.getByLabel('Perfil fiscal').selectOption({ label: 'Revenda Lucro Real' });
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByRole('row', { name: /Arroz 5 kg/ })).toBeVisible();
  await page.getByRole('button', { name: 'Novo produto' }).click();
  await page.getByLabel('Nome', { exact: true }).fill('Sacola');
  await page.getByLabel('Preço de venda').fill('1,00');
  await page.getByLabel('Código de barras').fill('78912342');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByRole('row', { name: /Sacola/ })).toBeVisible();

  // Caixa: prepara com internet (baixa catálogo e dados fiscais) e vende sem.
  await page.getByRole('link', { name: 'Abrir o caixa' }).click();
  await page.getByLabel('Novo caixa').fill('Caixa 1');
  await page.getByRole('button', { name: 'Criar e usar este caixa' }).click();
  await expect(page.getByRole('heading', { name: 'Abrir o caixa' })).toBeVisible({ timeout: 15_000 });
  await page.getByLabel('Dinheiro na gaveta para troco (R$)').fill('0,00');
  await page.getByRole('button', { name: 'Abrir caixa' }).click();
  await expect(page.getByText('Caixa livre')).toBeVisible();

  await context.setOffline(true);
  const bipar = async (codigo: string) => {
    const campo = page.getByLabel('Bipe o código ou digite o nome do produto');
    await campo.fill(codigo);
    await campo.press('Enter');
  };
  await bipar('7891000315507');
  await bipar('78912342');
  await expect(page.getByTestId('pdv-total')).toHaveText('R$ 101,00');
  await page.getByRole('button', { name: 'Pagar (F10)' }).click();
  await page.getByRole('radio', { name: 'Pix' }).click();
  await page.getByRole('button', { name: 'Adicionar pix' }).click();
  await page.getByRole('button', { name: 'Pagamento recebido' }).click();
  await page.getByRole('button', { name: 'Finalizar venda' }).click();
  await expect(page.getByText('Bipaê! Venda nº 1 concluída.')).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByTestId('sync-status')).toContainText('sincronizado agora', { timeout: 15_000 });
  await expect(page.getByTestId('sync-status')).not.toContainText('para enviar');

  // Retaguarda: o detalhe da venda mostra os impostos de cada item e o que falta configurar.
  await page.goto('/vendas');
  await page.getByRole('row', { name: /Caixa 1 · nº 1/ }).click();
  const itens = page.getByRole('region', { name: 'Itens da venda' });
  // Arroz: ICMS 18% de 100,00; PIS e COFINS sobre 82,00; IBS e CBS de teste de 2026.
  await expect(itens).toContainText('CFOP 5102 · ICMS R$ 18,00 · PIS R$ 1,35 · COFINS R$ 6,23');
  const impostos = page.getByRole('region', { name: 'Impostos da venda' });
  await expect(impostos).toContainText('ICMS');
  await expect(impostos).toContainText('R$ 18,00');
  await expect(impostos).toContainText('Valores para conferência com o contador.');
  // A sacola não tem perfil fiscal: aparece como pendência, sem valor suposto.
  await expect(impostos).toContainText('O produto não tem perfil fiscal. Escolha um no cadastro do produto.');
});
