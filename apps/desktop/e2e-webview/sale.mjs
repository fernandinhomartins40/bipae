// F2-10: E2E dentro do WebView real do Bipaê Desktop (tauri-driver + WebDriver).
// Abre o app compilado, entra na conta, abre o caixa e faz uma venda com o banco SQLite nativo
// (Rust), e confere que a venda chegou ao servidor. Roda na CI (Windows e Linux).
//
// Uso: node apps/desktop/e2e-webview/sale.mjs <caminho do executável>
// Precisa de: tauri-driver no PATH (e o driver nativo: msedgedriver no Windows,
// WebKitWebDriver no Linux) e a API em http://localhost:3333.
import { spawn } from 'node:child_process';
import { Builder, By, Key, until } from 'selenium-webdriver';

const app = process.argv[2];
if (!app) throw new Error('Informe o caminho do executável do Bipaê Desktop.');
const API = process.env.BIPAE_API ?? 'http://localhost:3333/v1';
const TIMEOUT = 30_000;

async function api(path, body, token) {
  const res = await fetch(`${API}/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      'content-type': 'application/json',
      ...(token && { authorization: `Bearer ${token}` }),
    },
    ...(body && { body: JSON.stringify(body) }),
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

// Conta e produto pela API, para o teste focar no app.
const email = `webview-${Date.now()}@exemplo.com.br`;
const password = 'senha-forte-123';
const conta = await api('auth/signup', {
  ownerName: 'Duda Dona',
  businessName: `Loja WebView ${Date.now()}`,
  email,
  password,
});
await api(
  'products',
  { name: 'Café Torrado 500 g', priceCents: 1890, barcodes: ['7891000100103'] },
  conta.accessToken,
);

const driverProcess = spawn('tauri-driver', [], { stdio: ['ignore', 'inherit', 'inherit'] });
await new Promise((r) => setTimeout(r, 2000));

const driver = await new Builder()
  .usingServer('http://127.0.0.1:4444/')
  .withCapabilities({ browserName: 'wry', 'tauri:options': { application: app } })
  .build();

/** O campo pelo texto do rótulo (o "for" do label aponta para o id do campo). */
async function field(label) {
  const el = await driver.wait(
    until.elementLocated(By.xpath(`//label[normalize-space(.)=${JSON.stringify(label)}]`)),
    TIMEOUT,
  );
  return driver.findElement(By.id(await el.getAttribute('for')));
}
async function button(text) {
  const el = await driver.wait(
    until.elementLocated(
      By.xpath(
        `//button[normalize-space(.)=${JSON.stringify(text)} or @aria-label=${JSON.stringify(text)}]`,
      ),
    ),
    TIMEOUT,
  );
  await driver.wait(until.elementIsEnabled(el), TIMEOUT);
  return el;
}
async function text(content) {
  return driver.wait(
    until.elementLocated(By.xpath(`//*[contains(normalize-space(.), ${JSON.stringify(content)})]`)),
    TIMEOUT,
  );
}

let ok = false;
try {
  await (await field('E-mail')).sendKeys(email);
  await (await field('Senha')).sendKeys(password);
  await (await button('Entrar')).click();
  await text('Olá, Duda!');
  console.log('· entrou na conta');

  const caixa = await driver.wait(
    until.elementLocated(By.xpath("//a[normalize-space(.)='Abrir o caixa']")),
    TIMEOUT,
  );
  await caixa.click();
  await (await field('Novo caixa')).sendKeys('Caixa WebView');
  await (await button('Criar e usar este caixa')).click();
  await (await field('Dinheiro na gaveta para troco (R$)')).sendKeys('0');
  await (await button('Abrir caixa')).click();
  console.log('· caixa aberto (banco SQLite nativo)');

  const bipar = await field('Bipe o código ou digite o nome do produto');
  await bipar.sendKeys('7891000100103', Key.ENTER);
  await text('R$ 18,90');
  await (await button('Pagar (F10)')).click();
  const pix = await driver.wait(
    until.elementLocated(
      By.xpath("//label[normalize-space(.)='Pix'] | //*[@role='radio'][normalize-space(.)='Pix']"),
    ),
    TIMEOUT,
  );
  await pix.click();
  await (await button('Adicionar pix')).click();
  await (await button('Pagamento recebido')).click();
  await (await button('Finalizar venda')).click();
  await text('Bipaê! Venda nº 1 concluída.');
  console.log('· venda concluída no app');

  // A venda sobe sozinha; o servidor precisa recebê-la.
  const fim = Date.now() + 60_000;
  for (;;) {
    const vendas = await api('sales', undefined, conta.accessToken);
    const lista = vendas.items ?? vendas;
    if (lista.length === 1 && lista[0].totalCents === 1890) break;
    if (Date.now() > fim) throw new Error('A venda não chegou ao servidor em 60 s.');
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log('· venda recebida pelo servidor');
  ok = true;
} catch (error) {
  console.error(`F2-10 falhou: ${error.message}`);
  try {
    const src = await driver.getPageSource();
    console.error(src.slice(0, 3000));
  } catch {
    // sem página para mostrar
  }
} finally {
  await driver.quit().catch(() => undefined);
  driverProcess.kill();
}
process.exit(ok ? 0 : 1);
