import { expect, request, test } from '@playwright/test';
import { abrirNoMenu } from './menu';

/**
 * F5-13.l: as NFS-e em que a empresa aparece, em Compras. As respostas do Ambiente Nacional são
 * simuladas aqui; a conversa real é testada na API.
 */
test.skip(() => test.info().project.name !== 'web', 'A retaguarda é a mesma nas duas cascas.');

test('busca as NFS-e da empresa e mostra prestador, papel, valor e situação', async ({ page }) => {
  const email = `agencia-nfse-${Date.now()}@exemplo.com.br`;
  const api = await request.newContext({ baseURL: 'http://localhost:3334/v1/' });
  await api.post('auth/signup', {
    data: {
      ownerName: 'Rita Dona',
      businessName: `Agência ${Date.now()}`,
      email,
      password: 'senha-forte-123',
    },
  });
  let buscou = false;
  await page.route('**/fiscal/nfse-received/sync/**', (route) => {
    buscou = true;
    return route.fulfill({
      json: { received: 1, nextQueryAt: new Date().toISOString(), message: '1 NFS-e recebida(s).' },
    });
  });
  await page.route('**/fiscal/nfse-received', (route) =>
    route.fulfill({
      json: buscou
        ? [
            {
              id: '0192a000-0000-7000-8000-000000000001',
              companyId: '0192a000-0000-7000-8000-000000000002',
              accessKey: '41094012242761086000115000000000000126104123456789',
              role: 'tomador',
              number: '12',
              issuerTaxId: '22333444000102',
              issuerName: 'Gráfica Exemplo LTDA',
              takerTaxId: '11222333000181',
              takerName: 'Agência Bipaê LTDA',
              issuedAt: '2026-10-20T10:00:00-03:00',
              valueCents: 100_000,
              netCents: 95_000,
              serviceCode: '130501',
              cancelled: false,
            },
          ]
        : [],
    }),
  );

  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await abrirNoMenu(page, 'Compras');
  await expect(
    page.getByRole('heading', { name: 'Notas de serviço (NFS-e) da sua empresa' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Buscar NFS-e agora' }).click();
  await expect(page.getByText('1 NFS-e recebida(s).')).toBeVisible();
  const linha = page.getByRole('row', { name: /Gráfica Exemplo LTDA/ });
  await expect(linha).toContainText('Sua empresa tomou');
  await expect(linha).toContainText('R$ 1.000,00');
  await expect(linha).toContainText('Válida');
  await expect(linha.getByRole('button', { name: 'Baixar o XML da NFS-e 12' })).toBeVisible();
});
