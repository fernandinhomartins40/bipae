import { expect, request, test, type Page } from '@playwright/test';
import { abrirNoMenu } from './menu';

/** F6-08.b: pontos ganhos numa venda com CPF e usados como desconto na seguinte. */
test.skip(() => test.info().project.name !== 'web', 'O caixa é o mesmo nas duas cascas.');

async function venderComCpf(page: Page) {
  const campo = page.getByLabel('Bipe o código ou digite o nome do produto');
  await campo.fill('7891000100103');
  await campo.press('Enter');
  await page.getByRole('button', { name: 'Cliente/CPF (F6)' }).click();
  await page.getByLabel('CPF ou CNPJ do cliente').fill('12345678909');
  await page.getByRole('button', { name: 'Confirmar' }).click();
}

async function pagarPix(page: Page) {
  await page.getByRole('button', { name: 'Receber (F10)' }).click();
  await page.getByRole('radio', { name: 'Pix' }).click();
  await page.getByRole('button', { name: 'Adicionar pix' }).click();
  await page.getByRole('button', { name: 'Pagamento recebido' }).click();
  await page.getByRole('button', { name: 'Finalizar venda' }).click();
}

test('ganha pontos numa venda e usa na seguinte', async ({ page }) => {
  const email = `pontos-${Date.now()}@exemplo.com.br`;
  const api = await request.newContext({ baseURL: 'http://localhost:3334/v1/' });
  const conta = await (
    await api.post('auth/signup', {
      data: {
        ownerName: 'Rui Dono',
        businessName: `Adega ${Date.now()}`,
        email,
        password: 'senha-forte-123',
      },
    })
  ).json();
  const headers = { authorization: `Bearer ${conta.accessToken}` };
  await api.post('products', {
    headers,
    data: { name: 'Vinho Tinto', priceCents: 5000, barcodes: ['7891000100103'] },
  });
  const cliente = await (
    await api.post('customers', { headers, data: { name: 'Ana Lima', taxId: '12345678909' } })
  ).json();

  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Entrar' }).click();

  // O programa: 1 ponto a cada R$ 1,00, cada ponto vale R$ 0,05, mínimo de 10 pontos.
  await abrirNoMenu(page, 'Relacionamento');
  const programa = page.getByRole('region', { name: 'Programa de fidelidade' });
  await programa.getByLabel('Cada ponto vale no caixa (R$)').fill('0,05');
  await programa.getByLabel('Mínimo de pontos para usar').fill('10');
  await programa.getByLabel('Programa ligado').check();
  await programa.getByRole('button', { name: 'Salvar programa' }).click();
  await expect(programa.getByText('Programa de fidelidade salvo.')).toBeVisible();

  await page.getByRole('link', { name: 'Abrir o caixa' }).click();
  await page.getByLabel('Novo caixa').fill('Balcão');
  await page.getByRole('button', { name: 'Criar e usar este caixa' }).click();
  await expect(page.getByRole('heading', { name: 'Abrir o caixa' })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByLabel('Dinheiro na gaveta para troco (R$)').fill('0');
  await page.getByRole('button', { name: 'Abrir caixa' }).click();

  // Primeira venda: R$ 50,00 = 50 pontos.
  await venderComCpf(page);
  await pagarPix(page);
  await expect(page.getByText('Bipaê! Venda nº 1 concluída.')).toBeVisible();

  // Segunda venda: depois de sincronizar, o caixa mostra os 50 pontos (R$ 2,50).
  await venderComCpf(page);
  await expect(async () => {
    await page.getByTestId('sync-status').click();
    await expect(page.getByTestId('loyalty-points')).toContainText('50 pontos', { timeout: 2000 });
  }).toPass({ timeout: 45_000 });
  await expect(page.getByTestId('loyalty-points')).toContainText('R$ 2,50');
  await page.getByRole('button', { name: 'Usar pontos' }).click();
  await expect(page.getByTestId('loyalty-used')).toContainText('Usando 50 pontos: −R$ 2,50');
  await expect(page.getByTestId('pdv-total')).toHaveText('R$ 47,50');
  await pagarPix(page);
  await expect(page.getByText('Bipaê! Venda nº 2 concluída.')).toBeVisible();

  // No servidor: 50 ganhos, 50 usados, 47 ganhos na segunda.
  await expect(async () => {
    await page.getByTestId('sync-status').click();
    const extrato = await (await api.get(`loyalty/customers/${cliente.id}`, { headers })).json();
    expect(extrato.points).toBe(47);
  }).toPass({ timeout: 45_000 });
});
