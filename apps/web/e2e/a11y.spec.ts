import AxeBuilder from '@axe-core/playwright';
import { expect, request, test, type Page } from '@playwright/test';

/**
 * F7-03: acessibilidade (WCAG 2.2 AA) das telas principais, conferida pelo axe-core. Qualquer
 * violação faz o teste falhar, com a lista do que corrigir.
 */
test.skip(() => test.info().project.name !== 'web', 'As telas são as mesmas nas duas cascas.');

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function violations(page: Page, where: string) {
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return result.violations.map(
    (v) =>
      `${where} · ${v.id} (${v.impact}): ${v.help} — ${v.nodes
        .slice(0, 3)
        .map((n) => n.target.join(' '))
        .join(' | ')}`,
  );
}

test('telas sem violações de acessibilidade WCAG 2.2 AA', async ({ page }) => {
  test.setTimeout(300_000);
  const found: string[] = [];

  await page.goto('/entrar');
  await expect(page.getByLabel('E-mail')).toBeVisible();
  found.push(...(await violations(page, 'Entrar')));
  await page.goto('/criar-conta');
  await expect(page.getByLabel('Seu nome')).toBeVisible();
  found.push(...(await violations(page, 'Criar conta')));

  const email = `a11y-${Date.now()}@exemplo.com.br`;
  const api = await request.newContext({ baseURL: 'http://localhost:3334/v1/' });
  const conta = await (
    await api.post('auth/signup', {
      data: {
        ownerName: 'Ana Dona',
        businessName: `Loja ${Date.now()}`,
        email,
        password: 'senha-forte-123',
      },
    })
  ).json();
  const headers = { authorization: `Bearer ${conta.accessToken}` };
  await api.post('products', {
    headers,
    data: { name: 'Café Torrado 500 g', priceCents: 1890, barcodes: ['7891000100103'] },
  });
  await api.post('customers', { headers, data: { name: 'Bruno Reis', taxId: '12345678909' } });

  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Ana!' })).toBeVisible();
  found.push(...(await violations(page, 'Início')));

  const telas: [string, string][] = [
    ['/produtos', 'Produtos'],
    ['/clientes', 'Clientes'],
    ['/compras', 'Compras'],
    ['/vendas', 'Vendas'],
    ['/financeiro', 'Contas a pagar e receber'],
    ['/relatorios', 'Relatórios'],
    ['/relacionamento', 'Relacionamento'],
    ['/assistente', 'Assistente'],
    ['/integracoes', 'Integrações (API)'],
    ['/condicional', 'Condicional'],
    ['/nfe', 'NF-e'],
    ['/ordens-de-servico', 'Ordens de serviço'],
    ['/servicos', 'Serviços'],
    ['/promocoes', 'Promoções'],
    ['/equipe', 'Equipe'],
    ['/empresas', 'Empresas e lojas'],
    ['/configuracoes', 'Configurações'],
    ['/ajuda', 'Ajuda'],
    ['/ajuda/crediario', 'Artigo da ajuda'],
  ];
  for (const [path, nome] of telas) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    found.push(...(await violations(page, nome)));
  }

  // Formulário em gaveta (o cadastro de produto).
  await page.goto('/produtos');
  await page.getByRole('button', { name: 'Novo produto' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  found.push(...(await violations(page, 'Novo produto')));

  // O caixa aberto, com um item.
  await page.goto('/');
  await page.getByRole('link', { name: 'Abrir o caixa' }).click();
  await page.getByLabel('Novo caixa').fill('Caixa 1');
  await page.getByRole('button', { name: 'Criar e usar este caixa' }).click();
  await expect(page.getByRole('heading', { name: 'Abrir o caixa' })).toBeVisible({
    timeout: 15_000,
  });
  found.push(...(await violations(page, 'Abrir o caixa')));
  await page.getByLabel('Dinheiro na gaveta para troco (R$)').fill('0');
  await page.getByRole('button', { name: 'Abrir caixa' }).click();
  const campo = page.getByLabel('Bipe o código ou digite o nome do produto');
  await campo.fill('7891000100103');
  await campo.press('Enter');
  await expect(page.getByTestId('pdv-total')).toHaveText('R$ 18,90');
  found.push(...(await violations(page, 'Caixa')));
  await page.getByRole('button', { name: 'Pagar (F10)' }).click();
  found.push(...(await violations(page, 'Pagamento')));

  console.log(`F7-03: ${found.length} violação(ões)\n${found.join('\n')}`);
  expect(found).toEqual([]);
});

test('o axe acusa o que está errado (prova de que a auditoria funciona)', async ({ page }) => {
  await page.setContent(
    '<html lang="pt-BR"><head><title>x</title></head><body><main><img src="x.png"><button></button></main></body></html>',
  );
  const ids = (await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations.map((v) => v.id);
  expect(ids).toEqual(expect.arrayContaining(['image-alt', 'button-name']));
});

async function entrar(page: Page) {
  const email = `a11y-${Date.now()}-${Math.random()}@exemplo.com.br`;
  const api = await request.newContext({ baseURL: 'http://localhost:3334/v1/' });
  await api.post('auth/signup', {
    data: {
      ownerName: 'Ana Dona',
      businessName: `Loja ${Date.now()}`,
      email,
      password: 'senha-forte-123',
    },
  });
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Ana!' })).toBeVisible();
}

for (const modo of [
  { nome: 'tema escuro', colorScheme: 'dark' as const, viewport: { width: 1280, height: 800 } },
  { nome: 'celular', colorScheme: 'light' as const, viewport: { width: 390, height: 844 } },
]) {
  test(`sem violações no ${modo.nome}`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.emulateMedia({ colorScheme: modo.colorScheme });
    await page.setViewportSize(modo.viewport);
    await entrar(page);
    const found = [...(await violations(page, `Início (${modo.nome})`))];
    for (const path of ['/produtos', '/clientes', '/relatorios', '/financeiro']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      found.push(...(await violations(page, `${path} (${modo.nome})`)));
    }
    console.log(`F7-03 ${modo.nome}: ${found.length}\n${found.join('\n')}`);
    expect(found).toEqual([]);
  });
}

test('teclado: pula o menu, abre e fecha a gaveta e o foco volta', async ({ page }) => {
  await entrar(page);
  // O primeiro Tab da página é o "Pular para o conteúdo" (numa tela sem foco automático).
  await page.goto('/relatorios');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await page.keyboard.press('Tab');
  const pular = page.getByRole('link', { name: 'Pular para o conteúdo' });
  await expect(pular).toBeFocused();
  await expect(pular).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('#conteudo')).toBeFocused();
  // Gaveta: abre com Enter, fecha com Esc e o foco volta para o botão.
  await page.goto('/produtos');
  const novo = page.getByRole('button', { name: 'Novo produto' });
  await novo.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(novo).toBeFocused();
});
