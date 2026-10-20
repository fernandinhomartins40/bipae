import { expect, test, type Page } from '@playwright/test';
import { Secret, TOTP } from 'otpauth';
import { abrirNoMenu } from './menu';

/**
 * Super admin panel end to end (web only): 2FA activation, overview, finding a client,
 * suspending and reactivating it (the client sees it live) and a support session.
 */
test.skip(() => test.info().project.name !== 'web', 'O painel é testado na casca web.');

const ADMIN = { email: 'admin-e2e@exemplo.com.br', password: 'senha-forte-123' };
const code = (secret: string) =>
  new TOTP({
    secret: Secret.fromBase32(secret),
    digits: 6,
    period: 30,
    algorithm: 'SHA1',
  }).generate();

async function signup(page: Page, name: string, business: string, email: string) {
  await page.goto('/criar-conta');
  await page.getByLabel('Seu nome').fill(name);
  await page.getByLabel('Nome do negócio').fill(business);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Criar conta grátis' }).click();
  await expect(
    page.getByRole('heading', { name: new RegExp(`Olá, ${name.split(' ')[0]}!`) }),
  ).toBeVisible();
}

test('super admin: 2FA, overview, suspend/reactivate a client and support access', async ({
  browser,
}) => {
  // The Bipaê staff account (first owner via the test-only bootstrap).
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await signup(admin, 'Ana Plataforma', 'Bipaê Matriz', ADMIN.email);

  // A client in a separate browser.
  const clientCtx = await browser.newContext();
  const client = await clientCtx.newPage();
  const business = `Mercearia ${Date.now()}`;
  await signup(client, 'Carlos Cliente', business, `carlos-${Date.now()}@exemplo.com.br`);

  // Panel login → mandatory 2FA activation.
  await admin.goto('/admin');
  await expect(admin.getByRole('heading', { name: 'Painel da plataforma' })).toBeVisible();
  await admin.getByLabel('E-mail').fill(ADMIN.email);
  await admin.getByLabel('Senha').fill(ADMIN.password);
  await admin.getByRole('button', { name: 'Entrar' }).click();
  await expect(
    admin.getByRole('heading', { name: 'Ative a verificação em duas etapas' }),
  ).toBeVisible();
  await expect(admin.getByAltText('Código QR para o aplicativo autenticador')).toBeVisible();
  const secret = (await admin.getByTestId('totp-secret').textContent())!.trim();
  await admin.getByLabel('Código de 6 dígitos').fill(code(secret));
  await admin.getByRole('button', { name: 'Ativar e entrar no painel' }).click();

  // Overview.
  await expect(admin.getByRole('heading', { name: 'Visão geral' })).toBeVisible();
  await expect(admin.getByText('Clientes ativos')).toBeVisible();
  await expect(admin.getByRole('img', { name: /Novos clientes por dia/ })).toBeVisible();

  // Find the client and open the record.
  await admin.getByRole('link', { name: 'Clientes', exact: true }).click();
  await admin.getByLabel('Buscar clientes').fill(business);
  await admin.getByRole('row', { name: new RegExp(business) }).click();
  await expect(admin.getByRole('heading', { name: business })).toBeVisible();
  await expect(admin.getByText('Uso do plano')).toBeVisible();

  // Suspend: the client is blocked on the next screen load.
  await admin.getByRole('button', { name: 'Suspender' }).click();
  await admin.getByLabel('Motivo').fill('Teste automatizado de suspensão');
  await admin.getByRole('dialog').getByRole('button', { name: 'Suspender' }).click();
  await expect(admin.getByText('Suspenso', { exact: true })).toBeVisible();

  await client.goto('/');
  await expect(client.getByText(/Esta conta está suspensa|Entrar/).first()).toBeVisible();

  // Reactivate.
  await admin.getByRole('button', { name: 'Reativar' }).click();
  await admin.getByLabel('Motivo').fill('Regularizado');
  await admin.getByRole('dialog').getByRole('button', { name: 'Reativar' }).click();
  await expect(admin.getByText('Ativo', { exact: true })).toBeVisible();

  // Support access opens the client's system in a new tab, read-only, with a visible banner.
  await admin.getByRole('button', { name: 'Acesso de suporte' }).click();
  await admin.getByLabel('Motivo (fica registrado)').fill('Cliente pediu ajuda');
  const [supportTab] = await Promise.all([
    adminCtx.waitForEvent('page'),
    admin.getByRole('button', { name: 'Abrir como o cliente' }).click(),
  ]);
  await expect(supportTab.getByText('Modo suporte Bipaê · somente leitura')).toBeVisible();
  await expect(supportTab.getByRole('heading', { name: 'Olá, Carlos!' })).toBeVisible();
  expect(supportTab.url()).not.toContain('token=');

  // Everything is in the platform audit.
  await admin.getByRole('link', { name: 'Auditoria' }).click();
  await expect(admin.getByText('Trilha íntegra')).toBeVisible();
  await expect(admin.getByRole('cell', { name: 'tenant.support_session' })).toBeVisible();

  await adminCtx.close();
  await clientCtx.close();
});

test('client: companies and stores, plan usage and limits', async ({ page }) => {
  await signup(
    page,
    'Rita Dona',
    `Loja da Rita ${Date.now()}`,
    `rita-${Date.now()}@exemplo.com.br`,
  );
  await abrirNoMenu(page, 'Minha assinatura');
  await expect(page.getByRole('heading', { name: 'Plano Grátis' })).toBeVisible();
  await expect(page.getByRole('main').getByText('Caixas', { exact: true })).toBeVisible();
  await expect(page.getByRole('main').getByText('0 de 2', { exact: true })).toBeVisible();

  await abrirNoMenu(page, 'Empresas e lojas');
  await expect(page.getByRole('heading', { name: 'Empresas e lojas' })).toBeVisible();
  // The free plan allows one company: the second is refused with a clear message.
  await page.getByRole('button', { name: 'Nova empresa' }).click();
  await page.getByLabel('Razão social').fill('Filial Ltda');
  await page.getByRole('button', { name: 'Salvar empresa' }).click();
  await expect(
    page.getByText('O plano Grátis permite até 1 empresa.', { exact: false }),
  ).toBeVisible();
});
