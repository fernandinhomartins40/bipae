import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestApp, signup, type TestApp } from './helpers';

/** F4-03: impostos da venda do produto em % do preço, para formar o preço. */

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

async function conta(regime: string) {
  const dono = await signup(t.app);
  const admin = api(t.app, dono.auth);
  const [empresa] = (await admin.get('/companies')).json();
  await admin.patch(`/companies/${empresa.id}`, {
    legalName: empresa.legalName,
    uf: 'SP',
    taxRegime: regime,
  });
  const perfil = (
    await admin.post('/fiscal-profiles', {
      name: 'Revenda',
      origem: 0,
      cfopInterna: '5102',
      cfopInterestadual: '6102',
      csosn: '102',
      cstIcms: '00',
      cstPisCofins: '01',
      cClassTrib: '000001',
    })
  ).json();
  const produto = (
    await admin.post('/products', {
      name: 'Café 500g',
      priceCents: 1890,
      costCents: 1100,
      ncm: '09012100',
      fiscalProfileId: perfil.id,
    })
  ).json();
  return { admin, produto };
}

describe('formação de preço (F4-03)', () => {
  it('Lucro Presumido em SP: ICMS 18%, PIS 0,65% e COFINS 3% do preço', async () => {
    const { admin, produto } = await conta('presumido');
    const r = await admin.get(`/products/${produto.id}/pricing`);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      costCents: 1100,
      regime: 'Lucro Presumido',
      simples: false,
      taxes: [
        { label: 'ICMS', bp: 1800 },
        { label: 'PIS', bp: 65 },
        { label: 'COFINS', bp: 300 },
      ],
      taxesBp: 2165,
    });
  });

  it('Simples Nacional: tributos no DAS, a pessoa informa a alíquota', async () => {
    const { admin, produto } = await conta('simples');
    const body = (await admin.get(`/products/${produto.id}/pricing`)).json();
    expect(body).toMatchObject({ simples: true, taxesBp: 0 });
    expect(body.notes.join(' ')).toContain('alíquota efetiva do DAS');
  });
});
