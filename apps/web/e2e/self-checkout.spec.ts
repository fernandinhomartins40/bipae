import { expect, request, test } from '@playwright/test';

/**
 * F5-06: autoatendimento. O operador liga o modo com um PIN de atendente; o cliente bipa e
 * paga; tirar item, confirmar o pagamento e desligar o modo pedem o PIN. Recarregar a página
 * não sai do modo.
 */
test.skip(() => test.info().project.name !== 'web', 'O caixa é o mesmo nas duas cascas.');

test('autoatendimento: o cliente bipa e paga, e o atendente confirma com o PIN', async ({
  page,
}) => {
  const email = `sara-auto-${Date.now()}@exemplo.com.br`;
  const api = await request.newContext({ baseURL: 'http://localhost:3334/v1/' });
  const conta = await (
    await api.post('auth/signup', {
      data: {
        ownerName: 'Sara Dona',
        businessName: `Mercadinho ${Date.now()}`,
        email,
        password: 'senha-forte-123',
      },
    })
  ).json();
  const headers = { authorization: `Bearer ${conta.accessToken}` };
  await api.post('products', {
    headers,
    data: { name: 'Café 500 g', priceCents: 1890, barcodes: ['7896005800027'] },
  });
  await api.post('products', {
    headers,
    data: { name: 'Açúcar 1 kg', priceCents: 549, barcodes: ['7891910000197'] },
  });

  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByRole('link', { name: 'Abrir o caixa' }).click();
  await page.getByLabel('Novo caixa').fill('Autoatendimento 1');
  await page.getByRole('button', { name: 'Criar e usar este caixa' }).click();
  await expect(page.getByRole('heading', { name: 'Abrir o caixa' })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByLabel('Dinheiro na gaveta para troco (R$)').fill('0');
  await page.getByRole('button', { name: 'Abrir caixa' }).click();
  await expect(page.getByText('Caixa livre')).toBeVisible();

  // O operador liga o modo e escolhe o PIN.
  await page.getByRole('button', { name: 'Autoatendimento' }).click();
  await page.getByLabel('PIN do atendente').fill('2468');
  await page.getByLabel('Repita o PIN').fill('2468');
  await page.getByRole('button', { name: 'Ligar o autoatendimento' }).click();
  await expect(page.getByText('Bipe seus produtos e toque em Pagar.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Desconto (F4)' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sair do caixa' })).toHaveCount(0);

  // Recarregar a página não sai do modo.
  await page.reload();
  await expect(page.getByText('Bipe seus produtos e toque em Pagar.')).toBeVisible({
    timeout: 15_000,
  });

  const campo = page.getByLabel('Bipe o código ou digite o nome do produto');
  await campo.fill('7896005800027');
  await campo.press('Enter');
  await campo.fill('7891910000197');
  await campo.press('Enter');
  await expect(page.getByTestId('pdv-total')).toHaveText('R$ 24,39');

  // Tirar item pede o PIN; PIN errado não tira.
  await page.getByRole('row', { name: /Açúcar 1 kg/ }).click();
  await page.getByRole('button', { name: 'Tirar item' }).click();
  await page.getByLabel('PIN do atendente').fill('1111');
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByText('PIN errado. Chame o atendente.')).toBeVisible();
  await page.getByLabel('PIN do atendente').fill('2468');
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByTestId('pdv-total')).toHaveText('R$ 18,90');

  // Pagamento: só Pix e cartão; o atendente confirma com o PIN.
  await page.getByRole('button', { name: 'Pagar (F10)' }).click();
  await expect(page.getByRole('radio', { name: 'Dinheiro' })).toHaveCount(0);
  await page.getByRole('radio', { name: 'Pix' }).click();
  await page.getByRole('button', { name: 'Adicionar pix' }).click();
  await page.getByRole('button', { name: 'Pagamento recebido' }).click();
  await page.getByRole('button', { name: 'Finalizar venda' }).click();
  await page.getByLabel('PIN do atendente').fill('2468');
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByText('Bipaê! Venda nº 1 concluída.')).toBeVisible();

  // Desligar o modo pede o PIN e volta ao caixa normal.
  await page.getByRole('button', { name: 'Desligar autoatendimento' }).click();
  await page.getByLabel('PIN do atendente').fill('2468');
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByRole('button', { name: 'Sair do caixa' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Desconto (F4)' })).toBeVisible();
});
