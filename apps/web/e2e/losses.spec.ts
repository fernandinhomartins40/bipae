import { expect, test } from '@playwright/test';

/**
 * F5-05: painel de prevenção de perdas. A conta nova mostra "nada fora do padrão"; o cenário com
 * alertas é simulado aqui (as contas são testadas na API).
 */
test.skip(() => test.info().project.name !== 'web', 'A retaguarda é a mesma nas duas cascas.');

test('painel de prevenção de perdas mostra alertas, operadores, perdas e vencidos', async ({
  page,
}) => {
  await page.goto('/criar-conta');
  await page.getByLabel('Seu nome').fill('Tereza Dona');
  await page.getByLabel('Nome do negócio').fill(`Mercado ${Date.now()}`);
  await page.getByLabel('E-mail').fill(`tereza-${Date.now()}@exemplo.com.br`);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Criar conta grátis' }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Tereza!' })).toBeVisible();

  await page.getByRole('link', { name: 'Prevenção de perdas' }).click();
  await expect(page.getByText('Nada fora do padrão no período')).toBeVisible();

  await page.route('**/v1/reports/losses*', (route) =>
    route.fulfill({
      json: {
        from: '2026-10-01',
        to: '2026-10-16',
        totals: {
          salesCount: 27,
          salesCents: 27000,
          cancelledCount: 5,
          cancelledCents: 5000,
          returnsCount: 1,
          returnsCents: 500,
          authorizedDiscountCount: 1,
          authorizedDiscountCents: 300,
          withdrawalsCount: 1,
          withdrawalsCents: 20000,
          cashDifferenceCents: -2500,
          stockLossCostCents: 5000,
          expiredCostCents: 7500,
        },
        operators: [
          {
            operatorId: 'b',
            name: 'Beto',
            salesCount: 7,
            salesCents: 7000,
            cancelledCount: 4,
            cancelledCents: 4000,
            cancelRateBp: 5714,
            returnsCount: 0,
            returnsCents: 0,
            authorizedDiscountCount: 1,
            authorizedDiscountCents: 300,
            withdrawalsCount: 1,
            withdrawalsCents: 20000,
            cashDifferenceCents: -2500,
            alerts: ['Cancelou 57,1% das vendas; a média do período é 18,5%.'],
          },
        ],
        products: [{ productId: 'p', name: 'Azeite 500 ml', lostMilli: 2000, lostCostCents: 5000 }],
        expiredLots: [
          {
            productId: 'p',
            name: 'Azeite 500 ml',
            lotCode: 'L-VENCIDO',
            expiresOn: '2026-01-31',
            quantityMilli: 3000,
            costCents: 7500,
          },
        ],
        alerts: ['Beto: Cancelou 57,1% das vendas; a média do período é 18,5%.'],
      },
    }),
  );
  await page.reload();
  await expect(page.getByRole('list', { name: 'Alertas' })).toContainText('Beto: Cancelou 57,1%');
  const operadores = page.getByRole('region', { name: 'Por operador' });
  await expect(operadores.getByRole('row', { name: /Beto/ })).toContainText('4 (57,1%)');
  await expect(operadores.getByRole('row', { name: /Beto/ })).toContainText('-R$ 25,00');
  await expect(page.getByRole('region', { name: 'Perdas de estoque' })).toContainText('R$ 50,00');
  await expect(page.getByRole('region', { name: 'Lotes vencidos' })).toContainText('31/01/2026');
});
