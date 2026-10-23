import { expect, request, test, type Page } from '@playwright/test';
import { abrirNoMenu } from './menu';

/** F8-08: o caixa cobra Pix com o QR da loja e cartão na maquininha à parte. */
test.skip(() => test.info().project.name !== 'web', 'A retaguarda é a mesma nas duas cascas.');

async function scan(page: Page, text: string) {
  const input = page.getByLabel('Bipe o código ou digite o nome do produto');
  await input.fill(text);
  await input.press('Enter');
}

test('Pix com o QR da loja e cartão confirmado na maquininha', async ({ page }) => {
  const email = `lia-pagamentos-${Date.now()}@exemplo.com.br`;
  const api = await request.newContext({ baseURL: 'http://localhost:3334/v1/' });
  const conta = await (
    await api.post('auth/signup', {
      data: {
        ownerName: 'Lia Dona',
        businessName: `Mercearia ${Date.now()}`,
        email,
        password: 'senha-forte-123',
      },
    })
  ).json();
  await api.post('products', {
    headers: { authorization: `Bearer ${conta.accessToken}` },
    data: { name: 'Café 500g', priceCents: 1890, barcodes: ['78912342'] },
  });

  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Entrar' }).click();

  await abrirNoMenu(page, 'Meios de pagamento');
  await expect(page.getByRole('list', { name: 'Integrações de pagamento' })).toContainText(
    'Chega em breve',
  );
  await page.getByLabel('Pix', { exact: true }).selectOption('static_qr');
  await page.getByLabel('Chave Pix da loja').fill('loja@exemplo.com.br');
  await page.getByLabel('Cidade').fill('Guarapuava');
  await expect(page.getByTestId('pix-preview')).toContainText('br.gov.bcb.pix');
  await page.getByRole('button', { name: 'Salvar meios de pagamento' }).click();
  await expect(page.getByText('Salvo. Os caixas da loja recebem')).toBeVisible();

  await page.getByRole('link', { name: 'Abrir o caixa' }).click();
  await page.getByLabel('Novo caixa').fill('Caixa 1');
  await page.getByRole('button', { name: 'Criar e usar este caixa' }).click();
  await page.getByLabel('Dinheiro na gaveta para troco (R$)').fill('0', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Abrir caixa' }).click();
  await expect(page.getByText('Caixa livre')).toBeVisible();

  // Pix: o QR traz a chave e o valor da venda.
  await scan(page, '78912342');
  await page.getByRole('button', { name: 'Receber (F10)' }).click();
  await page.getByRole('radio', { name: 'Pix' }).click();
  await page.getByRole('button', { name: 'Adicionar pix' }).click();
  await expect(page.getByRole('img', { name: 'QR Code do Pix de R$ 18,90' })).toBeVisible();
  await page.getByText('Pix copia e cola').click();
  const copia = page.getByTestId('pix-copia-e-cola');
  await expect(copia).toContainText('loja@exemplo.com.br');
  await expect(copia).toContainText('540518.90');
  await page.getByRole('button', { name: 'Pagamento recebido' }).click();
  await page.getByRole('button', { name: 'Finalizar venda' }).click();
  await expect(page.getByText('Bipaê! Venda nº 1 concluída.')).toBeVisible();

  // Cartão: cobra na maquininha e confirma, com o NSU se quiser; nada aprova sozinho.
  await scan(page, '78912342');
  await page.getByRole('button', { name: 'Receber (F10)' }).click();
  await page.getByRole('radio', { name: 'Cartão de débito' }).click();
  await page.getByRole('button', { name: 'Adicionar cartão de débito' }).click();
  await expect(page.getByText('Cobre R$ 18,90 na maquininha.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Finalizar venda' })).toBeDisabled();
  await page.getByLabel('Código da transação (NSU), opcional').fill('123456');
  await page.getByRole('button', { name: 'Aprovado na maquininha' }).click();
  await page.getByRole('button', { name: 'Finalizar venda' }).click();
  await expect(page.getByText('Bipaê! Venda nº 2 concluída.')).toBeVisible();
});
