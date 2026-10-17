import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestApp, signup, type TestApp } from './helpers';

/** F3-26: a MVA (IVA-ST) oficial da UF, como referência para a regra de ICMS. */

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

describe('referências de ST por UF (F3-26)', () => {
  it('SP: leite UHT tem o IVA-ST da Portaria SRE 12/2026; UF sem tabela avisa', async () => {
    const dono = await signup(t.app);
    const admin = api(t.app, dono.auth);
    const sp = (
      await admin.get('/fiscal/st-references?uf=sp&ncm=0401.10.10&date=2026-10-16')
    ).json();
    expect(sp).toMatchObject({ uf: 'SP', covered: true });
    expect(sp.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cest: '1701600',
          mva: '23.06',
          act: expect.stringContaining('Portaria SRE 12/2026'),
        }),
      ]),
    );
    const outra = (await admin.get('/fiscal/st-references?uf=PR&ncm=04011010')).json();
    expect(outra).toEqual({ uf: 'PR', covered: false, items: [] });
    expect((await admin.get('/fiscal/st-references?uf=SP&ncm=abc')).statusCode).toBe(400);
    expect((await api(t.app, {}).get('/fiscal/st-references?uf=SP&ncm=0401')).statusCode).toBe(401);
  });
});
