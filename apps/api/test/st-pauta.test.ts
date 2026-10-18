import { stPautaFor } from '@bipae/fiscal/tables';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestApp, signup, type TestApp } from './helpers';

/** F3-26.f: o produto escolhe o item da pauta da ST; a API confere na tabela oficial. */

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

const hoje = new Date().toISOString().slice(0, 10);
// A pauta de SP tem vigência (hoje, a Portaria SRE 27/2026 até 31/12/2026): os testes valem
// dentro e fora dela.
const vigente = stPautaFor('SP', hoje) !== null;

describe('pauta da ST no produto (F3-26.f)', () => {
  it('busca na pauta de SP; UF sem pauta responde vazia', async () => {
    const dono = await signup(t.app);
    const admin = api(t.app, dono.auth);
    const r = (await admin.get('/fiscal/st-pauta?uf=SP&q=skol%20lata%20710&cest=0302103')).json();
    if (vigente) {
      expect(r.pauta).toMatchObject({ uf: 'SP', validTo: '2026-12-31' });
      expect(r.items[0]).toMatchObject({ annex: 'III', item: '1.2', priceCents: 600 });
    } else {
      expect(r).toEqual({ pauta: null, items: [] });
    }
    expect((await admin.get('/fiscal/st-pauta?uf=RJ&q=skol')).json()).toEqual({
      pauta: null,
      items: [],
    });
    expect((await admin.get('/fiscal/st-pauta?q=skol')).statusCode).toBe(422);
  });

  it('o item da pauta é conferido: existe e é do mesmo CEST do produto', async () => {
    const dono = await signup(t.app);
    const admin = api(t.app, dono.auth);
    const base = { name: 'Cerveja Skol lata 710 ml', priceCents: 700, ncm: '22030000' };
    const ok = await admin.post('/products', {
      ...base,
      cest: '0302103',
      stPauta: { uf: 'SP', annex: 'III', item: '1.2' },
    });
    if (vigente) {
      expect(ok.statusCode).toBe(201);
      expect(ok.json().stPauta).toEqual({ uf: 'SP', annex: 'III', item: '1.2' });
      const outroCest = await admin.post('/products', {
        ...base,
        cest: '0302100',
        stPauta: { uf: 'SP', annex: 'III', item: '1.2' },
      });
      expect(outroCest.statusCode).toBe(400);
      expect(outroCest.json().message).toContain('CEST 0302103');
      // Mudar o nome não exige conferir a pauta de novo.
      const p = ok.json();
      const nome = await admin.put(`/products/${p.id}`, { ...p, name: 'Skol 710' });
      expect(nome.statusCode).toBe(200);
    } else {
      expect(ok.statusCode).toBe(400);
    }
    const inexistente = await admin.post('/products', {
      ...base,
      cest: '0302103',
      stPauta: { uf: 'SP', annex: 'III', item: '99.99' },
    });
    expect(inexistente.statusCode).toBe(400);
    expect(inexistente.json().message).toContain('não está na pauta');
    const formato = await admin.post('/products', {
      ...base,
      stPauta: { uf: 'SP', annex: '3', item: 'x' },
    });
    expect(formato.statusCode).toBe(400);
  });
});
