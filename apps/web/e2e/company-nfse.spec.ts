import { expect, request, test } from '@playwright/test';

/**
 * F5-13.h: percentuais da NFS-e na empresa. Só aparecem os campos do regime, o preenchimento
 * automático do navegador não entra e, sem saber o número, a tela calcula o do Simples.
 */
test.skip(() => test.info().project.name !== 'web', 'A retaguarda é a mesma nas duas cascas.');

test('calcula o percentual do Simples pelo anexo e pelo faturamento e salva', async ({ page }) => {
  const email = `rita-nfse-${Date.now()}@exemplo.com.br`;
  const api = await request.newContext({ baseURL: 'http://localhost:3334/v1/' });
  const conta = await (
    await api.post('auth/signup', {
      data: {
        ownerName: 'Rita Dona',
        businessName: `Agência ${Date.now()}`,
        email,
        password: 'senha-forte-123',
      },
    })
  ).json();
  const headers = { authorization: `Bearer ${conta.accessToken}` };

  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByRole('link', { name: 'Empresas e lojas' }).click();
  await page.getByRole('button', { name: 'Editar', exact: true }).click();

  // Sem regime, nenhum percentual; no Simples, só o do Simples.
  await expect(page.getByText('Escolha o regime tributário acima')).toBeVisible();
  await page.getByLabel('Regime tributário').selectOption({ label: 'Simples Nacional' });
  await expect(page.getByLabel('Tributos municipais aproximados (%)')).toHaveCount(0);
  const simples = page.getByLabel('Percentual aproximado do Simples (%)');
  await simples.fill('Brasil');
  await expect(simples).toHaveValue('');

  await page.getByRole('button', { name: 'Não sei o percentual: calcular para mim' }).click();
  await page.getByLabel('Anexo do Simples do seu serviço').selectOption('III');
  await page.getByLabel('Faturamento dos últimos 12 meses').fill('500.000,00');
  await page.getByRole('button', { name: 'Calcular', exact: true }).click();
  await expect(page.getByText('9,97%', { exact: false }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Usar 9,97%' }).click();
  await expect(simples).toHaveValue('9,97');

  await page.getByRole('button', { name: 'Salvar empresa' }).click();
  await expect(page.getByRole('button', { name: 'Salvar empresa' })).toHaveCount(0);
  const [empresa] = await (await api.get('companies', { headers })).json();
  expect(empresa.nfseSimplesPercent).toBe('9.97');
});
