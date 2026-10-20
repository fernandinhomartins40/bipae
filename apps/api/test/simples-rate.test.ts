import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestApp, signup, type TestApp } from './helpers';

/** F5-13.h: a tela calcula o percentual do Simples da NFS-e para quem não sabe o número. */

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

describe('alíquota efetiva do Simples (LC 123/2006, art. 18, § 1º-A)', () => {
  it('lista os anexos e calcula pelo anexo e pelo faturamento de 12 meses', async () => {
    const admin = api(t.app, (await signup(t.app)).auth);
    const lista = (await admin.get('/fiscal/simples-rate')).json();
    expect(lista.result).toBeNull();
    expect(lista.annexes.map((a: { annex: string }) => a.annex)).toEqual([
      'I',
      'II',
      'III',
      'IV',
      'V',
    ]);
    expect(lista.source.url).toBe('https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm');

    const r = (await admin.get('/fiscal/simples-rate?annex=III&rbt12Cents=50000000')).json();
    expect(r.result).toEqual({
      rate: '9.97',
      bracket: 3,
      nominal: '13.50',
      deductionCents: 1_764_000,
    });
    // Empresa começando: primeira faixa.
    const inicio = (await admin.get('/fiscal/simples-rate?annex=III&rbt12Cents=0')).json();
    expect(inicio.result.rate).toBe('6.00');
  });

  it('anexo inválido ou faturamento acima do teto explicam o que fazer', async () => {
    const admin = api(t.app, (await signup(t.app)).auth);
    const anexo = await admin.get('/fiscal/simples-rate?annex=IX&rbt12Cents=0');
    expect(anexo.statusCode).toBe(422);
    expect(anexo.json().message).toBe('Escolha o anexo do Simples (I a V).');
    const teto = await admin.get('/fiscal/simples-rate?annex=III&rbt12Cents=500000000');
    expect(teto.json().message).toContain('passa do teto do Simples Nacional');
    const texto = await admin.get('/fiscal/simples-rate?annex=III&rbt12Cents=abc');
    expect(texto.json().message).toBe('Informe o faturamento dos últimos 12 meses.');
  });
});
