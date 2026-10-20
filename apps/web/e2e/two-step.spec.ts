import { expect, test } from '@playwright/test';
import { Secret, TOTP } from 'otpauth';
import { abrirNoMenu } from './menu';

/** F1-01: verificação em duas etapas opcional, ativada pelo próprio usuário nas Configurações. */
test.skip(() => test.info().project.name !== 'web', 'O fluxo de login é o mesmo nas duas cascas.');

const code = (secret: string) =>
  new TOTP({
    secret: Secret.fromBase32(secret),
    digits: 6,
    period: 30,
    algorithm: 'SHA1',
  }).generate();

test('ativar a verificação em duas etapas e entrar com o código do app', async ({ page }) => {
  const email = `dona-2fa-${Date.now()}@exemplo.com.br`;
  await page.goto('/criar-conta');
  await page.getByLabel('Seu nome').fill('Marta Dona');
  await page.getByLabel('Nome do negócio').fill(`Empório ${Date.now()}`);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Criar conta grátis' }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Marta!' })).toBeVisible();

  await abrirNoMenu(page, 'Configurações');
  await expect(page.getByText('Recomendado para quem é dono ou gerente.')).toBeVisible();
  await page.getByRole('button', { name: 'Ativar verificação em duas etapas' }).click();
  await expect(page.getByAltText('Código QR para o aplicativo autenticador')).toBeVisible();
  const secret = (await page.getByTestId('totp-secret').textContent())!.trim();
  await page.getByLabel('Código de 6 dígitos').fill('000000');
  await page.getByRole('button', { name: 'Ativar', exact: true }).click();
  await expect(page.getByText('Código incorreto')).toBeVisible();
  await page.getByLabel('Código de 6 dígitos').fill(code(secret));
  await page.getByRole('button', { name: 'Ativar', exact: true }).click();
  await expect(
    page.getByText('Pronto! A partir de agora o Bipaê pede o código ao entrar.'),
  ).toBeVisible();
  await expect(page.getByText('Ativa', { exact: true })).toBeVisible();

  // Sai e entra de novo: agora pede o código.
  await page.getByRole('button', { name: 'Sair' }).first().click();
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText('Sua conta tem verificação em duas etapas.')).toBeVisible();
  await page.getByLabel('Código de 6 dígitos').fill(code(secret));
  await page.getByRole('button', { name: 'Confirmar e entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Marta!' })).toBeVisible();
});
