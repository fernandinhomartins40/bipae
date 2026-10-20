import { expect, test, type Page } from '@playwright/test';
import { abrirNoMenu } from './menu';

/** F1-06: convite de equipe por link, do envio ao aceite. */
test.skip(() => test.info().project.name !== 'web', 'A retaguarda é a mesma nas duas cascas.');

const SENHA = 'senha-forte-123';
const menu = (page: Page, name: string) => abrirNoMenu(page, name);

test('o dono convida por link e a pessoa entra como operadora de caixa', async ({
  page,
  browser,
}) => {
  await page.goto('/criar-conta');
  await page.getByLabel('Seu nome').fill('Olga Dona');
  await page.getByLabel('Nome do negócio').fill(`Quitanda ${Date.now()}`);
  await page.getByLabel('E-mail').fill(`olga-${Date.now()}@exemplo.com.br`);
  await page.getByLabel('Senha').fill(SENHA);
  await page.getByRole('button', { name: 'Criar conta grátis' }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Olga!' })).toBeVisible();

  await menu(page, 'Equipe');
  await page.getByRole('button', { name: 'Convidar por link' }).click();
  await page.getByLabel('Papel').selectOption({ label: 'Operador de caixa' });
  await page.getByRole('button', { name: 'Gerar link do convite' }).click();
  await expect(page.getByText('Convite criado')).toBeVisible();
  const link = await page.getByLabel('Link do convite').inputValue();
  expect(link).toContain('/convite/');
  await page.getByRole('button', { name: 'Concluir' }).click();
  await expect(page.getByRole('heading', { name: 'Convites pendentes' })).toBeVisible();

  // A pessoa abre o link no navegador dela e cria a conta.
  const contexto = await browser.newContext();
  const pessoa = await contexto.newPage();
  await pessoa.goto(link);
  await expect(pessoa.getByRole('heading', { name: 'Você foi convidado!' })).toBeVisible();
  await expect(pessoa.getByText('como Operador de caixa')).toBeVisible();
  await pessoa.getByLabel('Seu nome').fill('Rui Caixa');
  await pessoa.getByLabel('E-mail').fill(`rui-${Date.now()}@exemplo.com.br`);
  await pessoa.getByLabel('Crie uma senha').fill(SENHA);
  await pessoa.getByRole('button', { name: 'Aceitar convite e entrar' }).click();
  await expect(pessoa.getByRole('heading', { name: 'Olá, Rui!' })).toBeVisible();
  // Operador de caixa não gerencia a equipe.
  await expect(
    pessoa
      .getByRole('navigation', { name: 'Menu principal' })
      .getByRole('link', { name: 'Equipe' }),
  ).toHaveCount(0);

  // O link não serve de novo.
  const outro = await browser.newContext();
  const curioso = await outro.newPage();
  await curioso.goto(link);
  await expect(curioso.getByText('Este convite já foi usado.')).toBeVisible();
  await outro.close();
  await contexto.close();

  // Na equipe da dona, o Rui aparece e o convite saiu dos pendentes.
  await page.reload();
  await expect(page.getByRole('row', { name: /Rui Caixa/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Convites pendentes' })).toHaveCount(0);
});
