import { describe, expect, it } from 'vitest';
import { findStPautaItem, searchStPauta, ST_PAUTAS, stPautaFor } from './st-pautas';

/** F3-26.f: pauta da ST de bebidas em SP, gerada do texto da Portaria SRE 27/2026. */
describe('pauta da ST de SP (Portaria SRE 27/2026)', () => {
  it('vale de 01/07 a 31/12/2026, com os três anexos', () => {
    const sp = stPautaFor('SP', '2026-10-18')!;
    expect(sp).toMatchObject({ validFrom: '2026-07-01', validTo: '2026-12-31' });
    expect(stPautaFor('SP', '2026-12-31')).not.toBeNull();
    expect(stPautaFor('SP', '2027-01-01')).toBeNull();
    expect(stPautaFor('RJ', '2026-10-18')).toBeNull();
    expect(new Set(sp.items.map((i) => i.annex))).toEqual(new Set(['I', 'II', 'III']));
    expect(sp.items.length).toBeGreaterThan(1500);
    expect(ST_PAUTAS).toHaveLength(1);
  });

  it('o preço de cada marca e embalagem, como publicado', () => {
    const coca = findStPautaItem('SP', '2026-10-18', 'I', '1.1')!;
    expect(coca).toMatchObject({ cest: '0301100', priceCents: 317, tableName: 'Coca Cola' });
    expect(coca.description).toMatch(/GARRAFA DE VIDRO RETORNÁVEL ATÉ 260 ML/);
    // "R$ 5, 82" (com espaço no texto oficial) vira 582.
    expect(findStPautaItem('SP', '2026-10-18', 'I', '3.501')).toMatchObject({ priceCents: 582 });
  });

  it('busca sem acento e filtrada por CEST', () => {
    const skol = searchStPauta('SP', '2026-10-18', 'skol lata 710', { cest: '0302103' });
    expect(skol[0]).toMatchObject({ annex: 'III', priceCents: 600 });
    expect(searchStPauta('SP', '2027-02-01', 'skol')).toEqual([]);
  });

  it('o IVA-ST que vale sem a pauta: 140% na cerveja da indústria, 70% no varejista', () => {
    const iva = stPautaFor('SP', '2026-10-18')!.iva.filter((i) => i.annex === 'III');
    expect(iva.map((i) => i.mva)).toEqual(['140', '70', '115']);
    expect(iva[1]!.who).toMatch(/varejista/);
  });
});
