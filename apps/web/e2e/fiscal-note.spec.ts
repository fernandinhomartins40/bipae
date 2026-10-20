import { expect, request, test } from '@playwright/test';
import { abrirNoMenu } from './menu';

/**
 * F3-14.c: dados da nota na empresa, situação da NFC-e na venda e aviso na reimpressão. Sem
 * certificado A1 neste ambiente, a nota fica em "falta configurar" com o motivo; a autorização
 * em si é testada na API contra a SEFAZ simulada.
 */
test.skip(() => test.info().project.name !== 'web', 'A retaguarda é a mesma nas duas cascas.');

test('a venda mostra a NFC-e em "falta configurar" com o motivo, e o caixa avisa na reimpressão', async ({
  page,
}) => {
  const email = `nina-nfce-${Date.now()}@exemplo.com.br`;
  const api = await request.newContext({ baseURL: 'http://localhost:3334/v1/' });
  const conta = await (
    await api.post('auth/signup', {
      data: {
        ownerName: 'Nina Dona',
        businessName: `Mercearia ${Date.now()}`,
        email,
        password: 'senha-forte-123',
      },
    })
  ).json();
  const headers = { authorization: `Bearer ${conta.accessToken}` };
  const perfil = await (
    await api.post('fiscal-profiles', {
      headers,
      data: { name: 'Mercearia', cfopInterna: '5102', csosn: '102', cClassTrib: '000001' },
    })
  ).json();
  await api.post('products', {
    headers,
    data: {
      name: 'Arroz 5 kg',
      priceCents: 2890,
      barcodes: ['7891000315507'],
      ncm: '10063021',
      fiscalProfileId: perfil.id,
    },
  });

  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Entrar' }).click();

  // Dados da nota na empresa, com o município da tabela do IBGE.
  await abrirNoMenu(page, 'Empresas e lojas');
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  await page.getByLabel('CNPJ').fill('11.222.333/0001-81');
  await page.getByLabel('UF').selectOption('SP');
  await page.getByLabel('Regime tributário').selectOption({ label: 'Simples Nacional' });
  await page.getByLabel('Inscrição estadual').fill('111.222.333.444');
  await page.getByLabel('Rua').fill('Rua das Flores');
  await page.getByLabel('Número', { exact: true }).fill('100');
  await page.getByLabel('Bairro').fill('Centro');
  await page.getByLabel('Município').fill('campinas');
  await page.getByRole('button', { name: 'Campinas', exact: true }).click();
  await expect(page.getByText('Escolhido: Campinas - SP (IBGE 3509502)')).toBeVisible();
  await page.getByLabel('CEP').fill('13010-000');
  await page.getByRole('button', { name: 'Salvar empresa' }).click();
  await expect(page.getByRole('button', { name: 'Salvar empresa' })).toHaveCount(0);

  // Venda no caixa.
  await page.getByRole('link', { name: 'Abrir o caixa' }).click();
  await page.getByLabel('Novo caixa').fill('Caixa 1');
  await page.getByRole('button', { name: 'Criar e usar este caixa' }).click();
  await expect(page.getByRole('heading', { name: 'Abrir o caixa' })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByLabel('Dinheiro na gaveta para troco (R$)').fill('0');
  await page.getByRole('button', { name: 'Abrir caixa' }).click();
  await expect(page.getByText('Caixa livre')).toBeVisible();
  const campo = page.getByLabel('Bipe o código ou digite o nome do produto');
  await campo.fill('7891000315507');
  await campo.press('Enter');
  await page.getByRole('button', { name: 'Pagar (F10)' }).click();
  await page.getByRole('radio', { name: 'Pix' }).click();
  await page.getByRole('button', { name: 'Adicionar pix' }).click();
  await page.getByRole('button', { name: 'Pagamento recebido' }).click();
  await page.getByRole('button', { name: 'Finalizar venda' }).click();
  await expect(page.getByText('Bipaê! Venda nº 1 concluída.')).toBeVisible();
  await expect(page.getByTestId('sync-status')).not.toContainText('para enviar', {
    timeout: 15_000,
  });

  // Reimpressão sem nota autorizada: sai o comprovante e o caixa avisa o porquê.
  await page.keyboard.press('F11');
  await page.getByRole('button', { name: /Venda nº 1/ }).click();
  await page.getByRole('button', { name: 'Reimprimir' }).click();
  await expect(
    page.getByText(/A NFC-e não foi emitida: falta configurar dados fiscais/),
  ).toBeVisible();

  // Retaguarda: a venda mostra a nota com o motivo.
  await page.goto('/vendas');
  await page.getByRole('row', { name: /Caixa 1 · nº 1/ }).click();
  const nota = page.getByRole('region', { name: 'Nota fiscal' });
  await expect(nota).toContainText('Falta configurar');
  await expect(nota).toContainText('A empresa ainda não tem certificado digital A1 cadastrado.');
  await expect(nota).toContainText('Ambiente de homologação');
  await expect(nota.getByRole('button', { name: 'Tentar de novo' })).toBeVisible();
});
