/**
 * Demo data: a small neighborhood market ready to use.
 * Runs through the real API (validation, RLS, audit), so seeded data obeys every rule.
 * Idempotent: does nothing if the demo account already exists.
 *
 * Products, people and companies are fictitious; GTINs, CPFs and CNPJs only have valid check digits.
 */
import { cnpjCheckDigits, completeGtin, cpfCheckDigits } from '@bipae/domain';
import { createApp } from './app';
import { loadConfig } from './config';
import { sql } from 'drizzle-orm';
import { asPlatform, openDatabase } from './db/client';
import { migrate } from './db/migrate';

export const DEMO = {
  ownerEmail: 'demo@bipae.com.br',
  cashierEmail: 'caixa@bipae.com.br',
  password: 'bipae123',
};

const PRODUCTS: [name: string, priceCents: number, unit?: string, ncm?: string][] = [
  ['Arroz Tipo 1 5kg', 2890, 'UN', '10063021'],
  ['Feijão Carioca 1kg', 899, 'UN', '07133399'],
  ['Açúcar Refinado 1kg', 549, 'UN', '17019900'],
  ['Café Torrado e Moído 500g', 1890, 'UN', '09012100'],
  ['Óleo de Soja 900ml', 799, 'UN', '15079011'],
  ['Leite Integral UHT 1L', 549, 'UN', '04012010'],
  ['Macarrão Espaguete 500g', 469, 'UN', '19021900'],
  ['Farinha de Trigo 1kg', 589, 'UN', '11010010'],
  ['Sal Refinado 1kg', 299, 'UN', '25010020'],
  ['Molho de Tomate 340g', 329, 'UN', '21032010'],
  ['Biscoito Recheado 130g', 349, 'UN', '19053100'],
  ['Refrigerante Cola 2L', 999, 'UN', '22021000'],
  ['Água Mineral 1,5L', 299, 'UN', '22011000'],
  ['Cerveja Lata 350ml', 449, 'UN', '22030000'],
  ['Suco de Laranja 1L', 899, 'UN', '20091200'],
  ['Sabão em Pó 1kg', 1490, 'UN', '34025000'],
  ['Detergente Líquido 500ml', 279, 'UN', '34025000'],
  ['Papel Higiênico 12 rolos', 2190, 'UN', '48181000'],
  ['Creme Dental 90g', 499, 'UN', '33061000'],
  ['Sabonete 85g', 249, 'UN', '34011190'],
  ['Pão Francês', 1599, 'KG', '19059090'],
  ['Banana Prata', 699, 'KG', '08039000'],
  ['Tomate', 899, 'KG', '07020000'],
  ['Batata', 549, 'KG', '07019000'],
  ['Queijo Muçarela Fatiado', 5490, 'KG', '04061010'],
  ['Presunto Fatiado', 3990, 'KG', '16024900'],
  ['Ovos Brancos Dúzia', 1290, 'DZ', '04072100'],
  ['Manteiga 200g', 1190, 'UN', '04051000'],
  ['Iogurte Natural 170g', 349, 'UN', '04032000'],
  ['Chocolate ao Leite 90g', 699, 'UN', '18063210'],
];

const CUSTOMERS = [
  'Maria Aparecida',
  'José Carlos',
  'Ana Paula',
  'Francisco Lima',
  'Juliana Rocha',
];
const SUPPLIERS = ['Distribuidora Boa Compra', 'Laticínios Vale Verde', 'Hortifruti Central'];

function fakeCpf(seed: number) {
  const base = String(100000000 + seed * 7919).slice(0, 9);
  return base + cpfCheckDigits(base);
}

function fakeCnpj(seed: number) {
  const base = String(10000000 + seed * 104729).slice(0, 8) + '0001';
  return base + cnpjCheckDigits(base);
}

export async function seed(url: string) {
  const config = loadConfig({ ...process.env, DATABASE_URL: url, NODE_ENV: 'test' });
  const database = await openDatabase(url);
  await migrate(database);
  const app = await createApp({ ...config, LOGIN_RATE_LIMIT_PER_MINUTE: 1000 }, database);
  const call = async (
    method: 'GET' | 'POST',
    path: string,
    token: string | null,
    payload?: object,
  ) => {
    const res = await app.inject({
      method,
      url: `/v1${path}`,
      ...(token && { headers: { authorization: `Bearer ${token}` } }),
      ...(payload && { payload }),
    });
    if (res.statusCode >= 400) throw new Error(`${method} ${path}: ${res.statusCode} ${res.body}`);
    return res.json();
  };

  try {
    const existing = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: DEMO.ownerEmail, password: DEMO.password },
    });
    if (existing.statusCode === 200) {
      console.log('Dados de demonstração já existem.');
      return;
    }

    const owner = await call('POST', '/auth/signup', null, {
      ownerName: 'Rafael Demonstração',
      email: DEMO.ownerEmail,
      password: DEMO.password,
      businessName: 'Mercadinho Bipaê (demo)',
      taxId: fakeCnpj(1),
    });
    const token = owner.accessToken as string;
    // The demo market shows several registers and users: it runs on the Profissional plan.
    await asPlatform(database.db, (tx) =>
      tx.execute(sql`update tenants set plan_id = 'profissional' where id = ${owner.me.tenant.id}`),
    );

    const roles = (await call('GET', '/roles', token)) as { id: string; systemKey: string }[];
    await call('POST', '/members', token, {
      name: 'Juliana Operadora',
      email: DEMO.cashierEmail,
      password: DEMO.password,
      roleId: roles.find((r) => r.systemKey === 'cashier')!.id,
    });

    for (const [index, [name, priceCents, unit = 'UN', ncm]] of PRODUCTS.entries()) {
      const weighable = unit === 'KG';
      await call('POST', '/products', token, {
        name,
        priceCents,
        costCents: Math.round(priceCents * 0.7),
        unit,
        ncm,
        isWeighable: weighable,
        sku: `P${String(index + 1).padStart(4, '0')}`,
        // Weighables use in-store codes printed by the scale; others get a fictitious GTIN-13.
        barcodes: weighable
          ? []
          : [completeGtin(`789${String(4500000 + index * 37).padStart(9, '0')}`)],
      });
    }

    for (const [i, name] of CUSTOMERS.entries()) {
      await call('POST', '/customers', token, {
        name,
        taxId: fakeCpf(i + 1),
        phone: `1199${String(1000000 + i * 1111).slice(0, 7)}`,
        marketingConsent: i % 2 === 0,
      });
    }
    for (const [i, name] of SUPPLIERS.entries()) {
      await call('POST', '/suppliers', token, { name, taxId: fakeCnpj(i + 10) });
    }

    const [store] = (await call('GET', '/stores', token)) as { id: string }[];
    await call('POST', '/terminals', token, {
      storeId: store!.id,
      name: 'Caixa 1 (balcão)',
      platform: 'desktop',
    });
    await call('POST', '/terminals', token, {
      storeId: store!.id,
      name: 'Caixa 2 (tablet)',
      platform: 'web',
    });

    console.log(`Demonstração criada. Entre com ${DEMO.ownerEmail} / ${DEMO.password}`);
    console.log(`Operadora de caixa: ${DEMO.cashierEmail} / ${DEMO.password}`);
  } finally {
    await app.close();
    await database.close();
  }
}
