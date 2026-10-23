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
    expect(sp.status).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cest: '1701600', annex: 'XVI', inSt: true }),
      ]),
    );
    // Limpeza saiu da ST em SP em 01/08/2026.
    const limpeza = (
      await admin.get('/fiscal/st-references?uf=SP&ncm=28289011&date=2026-10-16')
    ).json();
    expect(limpeza.status).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          inSt: false,
          excludedFrom: '2026-08-01',
          excludedBy: 'Portaria SRE 20/2026',
        }),
      ]),
    );
    // Roraima não publica lista própria de CEST e MVA (segue os convênios e protocolos).
    const outra = (await admin.get('/fiscal/st-references?uf=RR&ncm=04011010')).json();
    expect(outra).toEqual({ uf: 'RR', covered: false, items: [], listed: false, status: [] });
    // Paraná (F3-26.c): leite UHT com a MVA da Resolução SEFA 571/2019.
    const pr = (await admin.get('/fiscal/st-references?uf=PR&ncm=04011010&date=2026-10-17')).json();
    expect(pr).toMatchObject({ uf: 'PR', covered: true, listed: true });
    expect(pr.items[0]).toMatchObject({ cest: '1701600', mva: '14.22' });
    expect((await admin.get('/fiscal/st-references?uf=SP&ncm=abc')).statusCode).toBe(400);
    // cBenef (F3-27.b): o que a tabela oficial do PR diz do código.
    const cb = (await admin.get('/fiscal/cbenef?uf=PR&code=PR810205&date=2026-10-17')).json();
    expect(cb).toMatchObject({
      uf: 'PR',
      covered: true,
      valid: true,
      entry: { csts: ['30', '40'] },
    });
    expect((await admin.get('/fiscal/cbenef?uf=PR')).statusCode).toBe(400);
    expect((await api(t.app, {}).get('/fiscal/st-references?uf=SP&ncm=0401')).statusCode).toBe(401);
  });

  it('CE: carga líquida pela CNAE do comprador (F3-26.d.CE.b), com a tabela da data', async () => {
    const dono = await signup(t.app);
    const admin = api(t.app, dono.auth);
    // Medicamento (NCM 3004.90.99, CEST do segmento 13): entra o decreto dos farmacêuticos.
    const remedio = (
      await admin.get('/fiscal/st-net-loads?uf=ce&ncm=3004.90.99&date=2026-10-23')
    ).json();
    expect(remedio).toMatchObject({ uf: 'CE', covered: true });
    expect(remedio.regimes.map((r: { act: string }) => r.act)).toContain(
      'Decreto 36.617/2025 (CE)',
    );
    const farma = remedio.regimes.find(
      (r: { act: string }) => r.act === 'Decreto 36.617/2025 (CE)',
    );
    expect(farma).toMatchObject({ mva: '33.05', version: { validFrom: '2025-06-01' } });
    // Sem CEST do segmento 13 (pneu): só os decretos que valem para as mercadorias do comprador.
    const pneu = (
      await admin.get('/fiscal/st-net-loads?uf=CE&ncm=40111000&date=2026-10-23')
    ).json();
    expect(pneu.regimes).toHaveLength(5);
    expect((await admin.get('/fiscal/st-net-loads?uf=SP&ncm=40111000')).json()).toMatchObject({
      covered: false,
      regimes: [],
    });
    expect((await admin.get('/fiscal/st-net-loads?uf=C')).statusCode).toBe(400);
    expect(farma.outputNote).toBe(
      'ICMS retido por substituição tributária - Decreto nº 36.617/2025',
    );

    // Classes da mercadoria da CNAE principal da empresa, para o cadastro do produto (F3-26.d.CE.c).
    const vestuario = (await admin.get('/fiscal/st-net-load-classes?uf=CE&cnae=4781-4/00')).json();
    expect(vestuario).toMatchObject({
      status: 'choose-class',
      regime: { act: 'Decreto 34.256/2021 (CE)' },
    });
    expect(vestuario.classes.map((c: { goodsClass: string }) => c.goodsClass)).toContain('rate-20');
    const fora = (await admin.get('/fiscal/st-net-load-classes?uf=CE&cnae=4711302')).json();
    expect(fora).toMatchObject({ status: 'not-listed', regime: null, classes: [] });
    expect(fora.message).toMatch(/vale a ST comum/);
    expect((await admin.get('/fiscal/st-net-load-classes?uf=CE')).statusCode).toBe(400);
  });
});
