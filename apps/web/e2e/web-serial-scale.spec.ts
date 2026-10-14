import { expect, test } from '@playwright/test';

/**
 * F2-06: balança direto no navegador pela Web Serial. O navegador de teste não tem porta serial
 * de verdade: a página recebe uma porta simulada que responde STX "01250" ETX (1,250 kg).
 */
test.skip(() => test.info().project.name !== 'web', 'Web Serial é do navegador.');

test('escolher a porta da balança e ler o peso sem o Conector', async ({ page }) => {
  await page.addInitScript(() => {
    const reply = [0x02, 0x30, 0x31, 0x32, 0x35, 0x30, 0x03];
    let chosen = false;
    // Como numa porta real: os fluxos nascem ao abrir e a resposta fica guardada até ser lida.
    const makePort = () => {
      const port = {
        readable: null as ReadableStream<Uint8Array> | null,
        writable: null as WritableStream<Uint8Array> | null,
        open: async () => {
          let enqueue: (chunk: Uint8Array) => void = () => undefined;
          port.readable = new ReadableStream<Uint8Array>({
            start(controller) {
              enqueue = (chunk) => controller.enqueue(chunk);
            },
          });
          port.writable = new WritableStream<Uint8Array>({
            write: () => enqueue(Uint8Array.from(reply)),
          });
        },
        close: async () => undefined,
      };
      return port;
    };
    const port = makePort();
    Object.defineProperty(navigator, 'serial', {
      value: {
        getPorts: async () => (chosen ? [port] : []),
        requestPort: async () => {
          chosen = true;
          return port;
        },
      },
    });
  });

  await page.goto('/criar-conta');
  await page.getByLabel('Seu nome').fill('Beto Dono');
  await page.getByLabel('Nome do negócio').fill(`Hortifruti ${Date.now()}`);
  await page.getByLabel('E-mail').fill(`beto-${Date.now()}@exemplo.com.br`);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Criar conta grátis' }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Beto!' })).toBeVisible();

  await page.getByRole('link', { name: 'Periféricos' }).click();
  await expect(page.getByRole('heading', { name: 'Balança neste navegador' })).toBeVisible();
  await page.getByLabel('Velocidade (baud)').selectOption('4800');
  await page.getByRole('button', { name: 'Escolher a porta da balança' }).click();
  await expect(page.getByText('Balança configurada neste navegador.')).toBeVisible();

  await page.getByRole('button', { name: 'Ler balança' }).click();
  await expect(page.getByText('Peso lido: 1,250 kg')).toBeVisible();
});
