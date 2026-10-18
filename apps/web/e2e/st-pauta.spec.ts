import { expect, request, test } from '@playwright/test';

/** F3-26.f: no cadastro do produto, a cerveja escolhe o item da pauta da ST de SP. */
test.skip(() => test.info().project.name !== 'web', 'A retaguarda é a mesma nas duas cascas.');
// A pauta guardada é a da Portaria SRE 27/2026 (até 31/12/2026); depois dela, vale a nova.
test.skip(() => new Date().toISOString().slice(0, 10) > '2026-12-31', 'Fora da vigência da pauta.');

test('cerveja com o CEST da pauta: escolhe o item e grava no produto', async ({ page }) => {
  const email = `pauta-${Date.now()}@exemplo.com.br`;
  const api = await request.newContext({ baseURL: 'http://localhost:3334/v1/' });
  const conta = await (
    await api.post('auth/signup', {
      data: {
        ownerName: 'Vera Dona',
        businessName: `Distribuidora ${Date.now()}`,
        email,
        password: 'senha-forte-123',
      },
    })
  ).json();
  const headers = { authorization: `Bearer ${conta.accessToken}` };
  const [empresa] = await (await api.get('companies', { headers })).json();
  await api.patch(`companies/${empresa.id}`, {
    headers,
    data: { legalName: 'Distribuidora Bipaê LTDA', uf: 'SP' },
  });
  const criado = await api.post('products', {
    headers,
    data: { name: 'Cerveja Skol lata 710 ml', priceCents: 700, ncm: '22030000', cest: '0302103' },
  });

  expect(criado.status(), await criado.text()).toBe(201);
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page
    .getByRole('navigation', { name: 'Menu principal' })
    .getByRole('link', { name: 'Produtos' })
    .click();
  await page.getByRole('row', { name: /Cerveja Skol/ }).click();
  const pauta = page.getByRole('region', { name: 'Pauta da ST (SP)' });
  await expect(pauta).toBeVisible();
  await pauta.getByLabel('Procurar na pauta').fill('skol lata 710');
  await pauta.getByRole('button', { name: /SKOL LATA LATA 710 ML/ }).click();
  await expect(pauta.getByText('Escolhido: item 1.2 do Anexo III.')).toBeVisible();
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(async () => {
    const lista = await (await api.get('products', { headers })).json();
    const items = (lista.items ?? lista) as { name: string; stPauta: unknown }[];
    expect(items.find((p) => p.name.startsWith('Cerveja Skol'))!.stPauta).toEqual({
      uf: 'SP',
      annex: 'III',
      item: '1.2',
    });
  }).toPass({ timeout: 15_000 });
});
