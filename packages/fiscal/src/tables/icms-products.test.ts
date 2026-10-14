import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { ICMS_GENERAL_RATES } from './icms-uf';
import { ICMS_PRODUCT_RATES, icmsProductLinesForNcm, icmsProductRates } from './icms-products';
import { TABLE_SOURCES } from './sources';

/** F3-25: alíquotas por mercadoria do Portal Nacional da DIFAL, com data e marcação de defasado. */
const pagina = gunzipSync(
  readFileSync(
    fileURLToPath(new URL(`../../sources/${TABLE_SOURCES.difal.file}`, import.meta.url)),
  ),
).toString('utf8');
const textoDaPagina = pagina.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

describe('alíquotas por mercadoria do Portal da DIFAL (F3-25)', () => {
  it('traz as 27 UFs, cada linha com alíquota e data como o portal publica', () => {
    expect(ICMS_PRODUCT_RATES.map((u) => u.uf)).toEqual(
      [...ICMS_GENERAL_RATES.map((r) => r.uf)].sort(),
    );
    const total = ICMS_PRODUCT_RATES.reduce((s, u) => s + u.items.length, 0);
    expect(total).toBeGreaterThan(800);
    for (const { uf, items } of ICMS_PRODUCT_RATES) {
      expect(items.length, uf).toBeGreaterThan(0);
      for (const item of items) {
        expect(item.description, uf).not.toBe('');
        if (item.updatedAt) expect(item.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        if (item.rate !== null)
          expect(Number(item.rate), `${uf} ${item.description}`).toBeLessThanOrEqual(40);
        // Nada inventado: a alíquota aparece na página oficial guardada.
        expect(textoDaPagina.includes(item.rateText), `${uf}: ${item.rateText}`).toBe(true);
      }
    }
  });

  it('marca o portal defasado onde a alíquota geral não bate com a lei da UF', () => {
    for (const uf of ICMS_PRODUCT_RATES) {
      if (uf.generalMatches === false) {
        expect(
          uf.items.some((i) => i.stale),
          uf.uf,
        ).toBe(true);
        expect(uf.portalGeneralRate).not.toBe(uf.confirmedGeneralRate);
      } else {
        expect(
          uf.items.every((i) => !i.stale),
          uf.uf,
        ).toBe(true);
      }
    }
    // Exemplos já levantados no plano: o portal ainda mostra 18% para o MA (a lei diz 23%).
    expect(icmsProductRates('MA')).toMatchObject({
      portalGeneralRate: '18',
      confirmedGeneralRate: '23',
      generalMatches: false,
    });
    expect(icmsProductRates('SP')).toMatchObject({ portalGeneralRate: '18', generalMatches: true });
    expect(icmsProductRates('SP')!.items.find((i) => i.general)?.stale).toBe(false);
    expect(icmsProductRates('XX')).toBeNull();
  });

  it('acha as linhas pelo NCM do produto', () => {
    const comNcm = ICMS_PRODUCT_RATES.flatMap((u) =>
      u.items.filter((i) => i.ncms?.length).map((i) => ({ uf: u.uf, i })),
    );
    expect(comNcm.length).toBeGreaterThan(0);
    const { uf, i } = comNcm[0]!;
    const ncm = i.ncms![0]!.padEnd(8, '0');
    expect(icmsProductLinesForNcm(uf, ncm)).toContain(i);
    expect(icmsProductLinesForNcm(uf, '00000000')).toEqual([]);
  });
});
