import { expect, request, test } from '@playwright/test';

/**
 * F3-17.c: venda cancelada no caixa antes de a NFC-e sair aparece como "não emitida" na
 * retaguarda, e a tela de inutilização mostra os números sem nota e pede a inutilização. Sem
 * certificado A1 neste ambiente, a resposta da SEFAZ à inutilização é simulada na rota; o envio
 * de verdade é testado na API contra a SEFAZ simulada.
 */
test.skip(() => test.info().project.name !== 'web', 'A retaguarda é a mesma nas duas cascas.');

test('venda cancelada não emite a nota, e os números sem nota são inutilizados', async ({
  page,
}) => {
  const email = `rui-cancela-${Date.now()}@exemplo.com.br`;
  const api = await request.newContext({ baseURL: 'http://localhost:3334/v1/' });
  const conta = await (
    await api.post('auth/signup', {
      data: {
        ownerName: 'Rui Dono',
        businessName: `Quitanda ${Date.now()}`,
        email,
        password: 'senha-forte-123',
      },
    })
  ).json();
  const headers = { authorization: `Bearer ${conta.accessToken}` };
  await api.post('products', {
    headers,
    data: { name: 'Feijão 1 kg', priceCents: 899, barcodes: ['7891000100103'] },
  });

  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Entrar' }).click();

  // Venda no caixa, cancelada logo depois.
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
  await campo.fill('7891000100103');
  await campo.press('Enter');
  await page.getByRole('button', { name: 'Pagar (F10)' }).click();
  await page.getByRole('radio', { name: 'Pix' }).click();
  await page.getByRole('button', { name: 'Adicionar pix' }).click();
  await page.getByRole('button', { name: 'Pagamento recebido' }).click();
  await page.getByRole('button', { name: 'Finalizar venda' }).click();
  await expect(page.getByText('Bipaê! Venda nº 1 concluída.')).toBeVisible();

  await page.keyboard.press('F11');
  await page.getByRole('button', { name: /Venda nº 1/ }).click();
  await page.getByLabel('Motivo').fill('Cliente desistiu');
  await page.getByRole('button', { name: 'Cancelar venda' }).click();
  await expect(page.getByText('Venda cancelada.')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByTestId('sync-status').click();
  await expect(page.getByTestId('sync-status')).not.toContainText('para enviar', {
    timeout: 15_000,
  });

  // Retaguarda: a nota não foi emitida, e a tela diz o porquê.
  await page.goto('/vendas');
  await page.getByRole('row', { name: /Caixa 1 · nº 1/ }).click();
  const nota = page.getByRole('region', { name: 'Nota fiscal' });
  await expect(nota).toContainText('Não emitida (venda cancelada)', { timeout: 15_000 });
  await expect(nota.getByTestId('nfce-voided')).toContainText('Inutilização de números');
  await expect(nota.getByRole('button', { name: 'Tentar de novo' })).toHaveCount(0);

  // Inutilização: nesta conta não há nota transmitida, então não há buraco de verdade.
  await page.goto('/inutilizacao');
  await expect(page.getByText('Nenhum número para inutilizar')).toBeVisible();

  // Com um buraco (resposta simulada), a pessoa escolhe a faixa e pede a inutilização.
  let gaps = [{ model: '65', series: 1, from: 2, to: 3 }];
  await page.route('**/v1/fiscal/inutilizations/gaps*', (route) => route.fulfill({ json: gaps }));
  await page.route('**/v1/fiscal/inutilizations', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON();
    expect(body).toMatchObject({ series: 1, from: 2, to: 3 });
    gaps = [];
    await route.fulfill({
      status: 201,
      json: {
        id: '0192a000-0000-7000-8000-000000000001',
        companyId: body.companyId,
        model: '65',
        series: 1,
        from: 2,
        to: 3,
        year: '26',
        reason: body.reason,
        status: 'registered',
        cStat: '102',
        xMotivo: 'Inutilização de número homologado',
        protocol: '135260000777777',
        help: null,
        createdAt: new Date().toISOString(),
      },
    });
  });
  await page.reload();
  const sem = page.getByRole('region', { name: 'Números sem nota' });
  await expect(sem.getByRole('row', { name: /2 a 3/ })).toBeVisible();
  await sem.getByRole('button', { name: 'Inutilizar' }).click();
  await expect(page.getByLabel('Do número')).toHaveValue('2');
  await expect(page.getByLabel('Até o número')).toHaveValue('3');
  await page.getByRole('button', { name: 'Inutilizar na SEFAZ' }).click();
  await expect(page.getByText('Números inutilizados')).toBeVisible();
  await expect(page.getByText(/protocolo 135260000777777/)).toBeVisible();
  await expect(page.getByText('Nenhum número para inutilizar')).toBeVisible();
});
