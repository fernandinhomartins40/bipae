import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { FCP_PRODUCTS, fcpProductsByLaw } from './fcp-products';
import { ICMS_GENERAL_RATES } from './icms-uf';
import { TABLE_SOURCES } from './sources';

/**
 * F3-34: a lista de produtos do FCP de cada UF é copiada da lei guardada em sources/ (acervo
 * ctresb/leis). O teste prova que cada item está no texto da lei, sem depender da formatação
 * (Markdown, quebras de linha, OCR): compara só letras e números, em minúsculas.
 */
const lei = (key: keyof typeof TABLE_SOURCES) =>
  gunzipSync(
    readFileSync(fileURLToPath(new URL(`../../sources/${TABLE_SOURCES[key].file}`, import.meta.url))),
  ).toString('utf8');
const soLetras = (texto: string) => texto.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

describe('FCP por produto pela lei da UF (F3-34)', () => {
  it('cobre as UFs lidas no acervo, com fonte guardada e link oficial', () => {
    expect(FCP_PRODUCTS.map((u) => u.uf)).toEqual(['AM', 'ES', 'MG', 'RS', 'SE', 'SP']);
    for (const uf of FCP_PRODUCTS) {
      expect(uf.items.length).toBeGreaterThan(0);
      for (const key of uf.sources) expect(TABLE_SOURCES[key].page).toMatch(/^https:\/\//);
    }
  });

  it('cada produto está escrito assim na lei', () => {
    for (const uf of FCP_PRODUCTS) {
      const texto = soLetras(uf.sources.map(lei).join(' '));
      for (const item of uf.items) {
        expect(texto, `${uf.uf}: ${item.description}`).toContain(soLetras(item.description));
      }
    }
  });

  it('o percentual vem da lei: 2 pontos, e o AM reduzido nos veículos e na TV por assinatura', () => {
    expect(soLetras(lei('fcpLawMg'))).toContain(soLetras('com vigência até 31 de dezembro de 2026, o adicional de dois pontos percentuais'));
    expect(fcpProductsByLaw('MG')?.validUntil).toBe('2026-12-31');
    expect(soLetras(lei('fcpLawSp'))).toContain(soLetras('adicional de 2% (dois por cento) na alíquota do ICMS'));
    expect(soLetras(lei('fcpLawRs2024'))).toContain(soLetras('Aplica-se adicional de 2 (dois) pontos percentuais às alíquotas internas'));
    // A Lei 4.519/2017 revogou perfumes (V) e combustíveis, diesel e concentrados (XI a XIII).
    expect(soLetras(lei('fcpLawAm2017'))).toContain(soLetras('os incisos V, XI, XII e XIII do §1.º'));
    const am = fcpProductsByLaw('AM')!;
    expect(am.items.some((i) => /perfume|diesel|combustíve/i.test(i.description))).toBe(false);
    expect(am.items.filter((i) => i.rate === '1.1')).toHaveLength(3);
    expect(fcpProductsByLaw('PE')).toBeNull();
  });

  it('a alíquota geral do RR (20%) tem a lei identificada', () => {
    expect(soLetras(lei('icmsLawRr'))).toContain(soLetras('20% (vinte por cento) para as demais mercadorias e serviços'));
    expect(ICMS_GENERAL_RATES.find((u) => u.uf === 'RR')).toMatchObject({
      rate: '20',
      url: TABLE_SOURCES.icmsLawRr.page,
    });
  });
});
