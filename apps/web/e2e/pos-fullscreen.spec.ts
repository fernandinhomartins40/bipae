import { expect, request, test, type Page } from '@playwright/test';

/**
 * F8-14: o caixa no celular com cara de app. Tela inteira, sem a página rolar: só a lista de
 * itens rola por dentro, e o total com o Pagar ficam sempre à vista. O pagamento também cabe.
 */
test.skip(() => test.info().project.name !== 'web', 'A largura de celular é do navegador.');

/** EAN-8 com dígito verificador, para cada produto ter o seu código. */
function ean8(seed: number): string {
  const body = String(7_891_000 + seed).padStart(7, '0');
  const sum = [...body].reduce((acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 3 : 1), 0);
  return body + String((10 - (sum % 10)) % 10);
}

const PRODUTOS = [
  'Arroz Tipo 1 5kg',
  'Feijão Carioca 1kg',
  'Açúcar Refinado 1kg',
  'Café Torrado 500g',
  'Leite Integral 1L',
  'Óleo de Soja 900ml',
  'Macarrão Espaguete 500g',
  'Farinha de Trigo 1kg',
  'Sal Refinado 1kg',
  'Molho de Tomate 340g',
  'Biscoito Cream Cracker',
  'Sabão em Pó 1kg',
  'Detergente Neutro 500ml',
  'Papel Higiênico 12 rolos',
];

async function abrirCaixa(page: Page, tamanho: string) {
  const email = `caixa-app-${tamanho}-${Date.now()}@exemplo.com.br`;
  const api = await request.newContext({ baseURL: 'http://localhost:3334/v1/' });
  const conta = await (
    await api.post('auth/signup', {
      data: {
        ownerName: 'Bia Dona',
        businessName: `Mercearia App ${Date.now()}`,
        email,
        password: 'senha-forte-123',
      },
    })
  ).json();
  const codigos: string[] = [];
  for (const [i, name] of PRODUTOS.entries()) {
    const codigo = ean8(i + 1);
    codigos.push(codigo);
    const resposta = await api.post('products', {
      headers: { authorization: `Bearer ${conta.accessToken}` },
      data: { name, priceCents: 390 + i * 115, barcodes: [codigo] },
    });
    expect(resposta.ok(), `produto ${name}`).toBeTruthy();
  }

  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByRole('link', { name: 'Abrir o caixa' }).click();
  await page.getByLabel('Novo caixa').fill('Celular');
  await page.getByRole('button', { name: 'Criar e usar este caixa' }).click();
  await page.getByLabel('Dinheiro na gaveta para troco (R$)').fill('0', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Abrir caixa' }).click();
  await expect(page.getByText('Caixa livre')).toBeVisible();
  return codigos;
}

/** A página inteira não rola, nem para baixo nem para o lado. */
async function paginaSemRolagem(page: Page, onde: string) {
  const medida = await page.evaluate(() => {
    const el = document.scrollingElement ?? document.documentElement;
    return {
      altura: el.scrollHeight,
      largura: el.scrollWidth,
      janelaAltura: window.innerHeight,
      janelaLargura: window.innerWidth,
    };
  });
  expect(medida.altura, `rolagem vertical ${onde}`).toBeLessThanOrEqual(medida.janelaAltura);
  expect(medida.largura, `rolagem lateral ${onde}`).toBeLessThanOrEqual(medida.janelaLargura);
}

for (const viewport of [
  { width: 390, height: 844 },
  { width: 360, height: 640 },
]) {
  const tamanho = `${viewport.width}x${viewport.height}`;

  test(`caixa em tela inteira no celular ${tamanho}: bipa, rola só a lista e paga sem rolar a página`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(viewport);
    const codigos = await abrirCaixa(page, tamanho);

    // Layout de app: sem o rodapé de atalhos do teclado, com o rodapé do total e do Pagar.
    await expect(page.locator('[data-layout="compact"]')).toBeVisible();
    await expect(page.getByRole('contentinfo', { name: 'Atalhos do teclado' })).toHaveCount(0);

    const campo = page.getByLabel('Bipe o código ou digite o nome do produto');
    for (const codigo of codigos) {
      await campo.fill(codigo);
      await campo.press('Enter');
    }
    const barra = page.getByRole('region', { name: 'Total e pagamento' });
    await expect(barra).toContainText(`${codigos.length} itens`);

    // A lista encheu: ela rola por dentro e a página continua parada.
    const lista = page.getByTestId('pdv-items');
    const rolagemDaLista = await lista.evaluate((el) => el.scrollHeight > el.clientHeight);
    expect(rolagemDaLista, 'a lista de itens rola por dentro').toBe(true);
    await paginaSemRolagem(page, 'com a lista cheia');
    // O último item bipado aparece (a lista acompanha a bipada).
    await expect(lista.getByText(PRODUTOS.at(-1)!)).toBeInViewport();

    // O campo de bipar, o total e o Pagar estão inteiros na tela.
    await expect(campo).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId('pdv-total-mobile')).toBeInViewport({ ratio: 1 });
    const pagar = barra.getByRole('button', { name: 'Pagar', exact: true });
    await expect(pagar).toBeInViewport({ ratio: 1 });
    await expect(pagar).toBeEnabled();
    // Alvo de toque confortável (44px ou mais).
    const caixaPagar = (await pagar.boundingBox())!;
    expect(caixaPagar.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: test.info().outputPath(`caixa-${tamanho}.png`) });

    // Ações secundárias na folha que sobe de baixo; o último item bipado está selecionado.
    await barra.getByRole('button', { name: 'Mais ações' }).click();
    const folha = page.getByRole('dialog', { name: 'Ações do caixa' });
    await expect(folha).toBeVisible();
    await expect(folha.getByRole('button', { name: 'Desconto na venda' })).toBeVisible();
    await expect(folha.getByRole('button', { name: 'Tirar item' })).toBeVisible();
    await expect(folha).toBeInViewport({ ratio: 1 });
    await paginaSemRolagem(page, 'com a folha de ações aberta');
    await page.screenshot({ path: test.info().outputPath(`acoes-${tamanho}.png`) });
    await page.keyboard.press('Escape');
    await expect(folha).toHaveCount(0);

    // Pagamento em tela inteira: cabe sem rolar, nem a página nem a janela.
    await pagar.click();
    const pagamento = page.getByRole('dialog', { name: 'Pagamento' });
    await expect(pagamento).toBeVisible();
    await expect(pagamento).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: test.info().outputPath(`pagamento-${tamanho}.png`) });
    const cabe = await pagamento.evaluate((el) => el.scrollHeight <= el.clientHeight);
    expect(cabe, 'o pagamento cabe sem rolar').toBe(true);
    await paginaSemRolagem(page, 'no pagamento');
    await expect(pagamento.getByRole('button', { name: 'Finalizar venda' })).toBeInViewport({
      ratio: 1,
    });

    // Dinheiro com troco: a tela de troco também cabe.
    await pagamento.getByLabel('Valor recebido (R$)').fill('200,00');
    await pagamento.getByRole('button', { name: 'Adicionar dinheiro' }).click();
    await expect(pagamento).toContainText('Troco');
    const cabeComTroco = await pagamento.evaluate((el) => el.scrollHeight <= el.clientHeight);
    expect(cabeComTroco, 'o troco cabe sem rolar').toBe(true);
    const finalizar = pagamento.getByRole('button', { name: 'Finalizar venda' });
    await expect(finalizar).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: test.info().outputPath(`troco-${tamanho}.png`) });
    await finalizar.click();

    await expect(page.getByText(/Bipaê! Venda nº 1 concluída\. Troco: R\$/)).toBeVisible();
    await expect(pagar).toBeDisabled();
    await paginaSemRolagem(page, 'depois da venda');
  });
}
