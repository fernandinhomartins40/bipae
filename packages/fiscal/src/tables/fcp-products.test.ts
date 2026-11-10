import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { pdfLines } from '../../scripts/pdf-text.mjs';
import { FCP_PRODUCTS, fcpProductsByLaw } from './fcp-products';
import { ICMS_GENERAL_RATES } from './icms-uf';
import { TABLE_SOURCES } from './sources';

/**
 * F3-34: a lista de produtos do FCP de cada UF é copiada da lei guardada em sources/ (acervo
 * ctresb/leis). O teste prova que cada item está no texto da lei, sem depender da formatação
 * (Markdown, quebras de linha, OCR): compara só letras e números, em minúsculas.
 */
const arquivo = (key: keyof typeof TABLE_SOURCES) =>
  readFileSync(fileURLToPath(new URL(`../../sources/${TABLE_SOURCES[key].file}`, import.meta.url)));
// PDF oficial (TO): o texto sai pelo mesmo leitor da geração das tabelas, só nas páginas do artigo
// (o código tributário inteiro tem 172 páginas e abrir tudo é lento com a suíte em paralelo).
const PDF_PAGES: Partial<Record<keyof typeof TABLE_SOURCES, [number, number]>> = { fcpLawTo: [28, 31] };
const leiPdf = async (key: keyof typeof TABLE_SOURCES) =>
  (await pdfLines(arquivo(key), { pages: PDF_PAGES[key] })).join(' ');
const textoDaFonte = (key: keyof typeof TABLE_SOURCES) =>
  TABLE_SOURCES[key].file.endsWith('.pdf') ? leiPdf(key) : Promise.resolve(lei(key));
const lei = (key: keyof typeof TABLE_SOURCES) => {
  const bytes = gunzipSync(arquivo(key));
  let texto: string;
  try {
    texto = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // Páginas antigas das SEFAZ (PE) vêm em windows-1252.
    texto = new TextDecoder('windows-1252').decode(bytes);
  }
  // HTML: as tags (estilos do Word no meio das palavras) e as entidades saem antes de comparar.
  return texto.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"');
};
const soLetras = (texto: string) => texto.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

describe('FCP por produto pela lei da UF (F3-34)', () => {
  it('cobre as UFs lidas no acervo, com fonte guardada e link oficial', () => {
    expect(FCP_PRODUCTS.map((u) => u.uf)).toEqual(['AM', 'ES', 'MG', 'PB', 'PE', 'RN', 'RS', 'SE', 'SP', 'TO']);
    for (const uf of FCP_PRODUCTS) {
      expect(uf.items.length).toBeGreaterThan(0);
      for (const key of uf.sources) expect(TABLE_SOURCES[key].page).toMatch(/^https:\/\//);
    }
  });

  it('cada produto está escrito assim na lei', async () => {
    for (const uf of FCP_PRODUCTS) {
      const texto = soLetras((await Promise.all(uf.sources.map(textoDaFonte))).join(' '));
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
    // PE: desde 01/04/2019 (Lei 16.489/2018) a alínea a é só bebidas alcoólicas; a exceção da
    // aguardente ficou na redação anterior.
    expect(soLetras(lei('fcpLawPe'))).toContain(
      soLetras('a) bebidas alcoólicas; (Lei 16.489/2018 – efeitos a partir de 01.04.2019) Redação anterior'),
    );
    // RN: a LC 776/2024 revogou comunicação (f), gasolina (j) e energia (k).
    expect(lei('fcpLawRn')).toMatch(
      /Revogado pela Lei Complementar Nº 776 DE 27\/12\/2024\):\s*f\) serviços de comunicação/,
    );
    expect(fcpProductsByLaw('RN')!.items.some((i) => /gasolina|comunicação|energia/.test(i.description))).toBe(false);
    // PB: as alíneas n e o (automóveis e motos) foram revogadas pela MP 280/2019.
    const pb = lei('fcpLawPb');
    expect(pb.indexOf('Revogado pela Medida Provisória Nº 280')).toBeLessThan(pb.indexOf('n) automóveis'));
    expect(fcpProductsByLaw('PB')!.items.some((i) => /automóveis|motocicletas/.test(i.description))).toBe(false);
  });

  it('TO: o adicional do FECOEP segue no § 11 do art. 27 (D-060), sem comunicação nem combustíveis', async () => {
    const to = soLetras(await leiPdf('fcpLawTo'));
    expect(to).toContain(
      soLetras('fica acrescida de dois pontos percentuais, cujo produto da arrecadação destina-se a prover de recursos o Fundo Estadual de Combate e Erradicação da Pobreza - FECOEP-TO'),
    );
    expect(to).toContain(soLetras('a) serviço de comunicação;*Declarada Inconstitucional pela ADI nº 7.113'));
    // A Lei 4.174/2023 só acrescentou o § 14 (ad rem); o § 11 que ela redigiu é o da Lei 1.385/2003.
    expect(to).toContain(soLetras('(Acrescentado pela Lei nº 4.174, de 20/06/2023)'));
    expect(fcpProductsByLaw('TO')!.items.some((i) => /comunicação|gasolina|etílico/.test(i.description))).toBe(false);
  });

  it('a alíquota geral do RR (20%) tem a lei identificada', () => {
    expect(soLetras(lei('icmsLawRr'))).toContain(soLetras('20% (vinte por cento) para as demais mercadorias e serviços'));
    expect(ICMS_GENERAL_RATES.find((u) => u.uf === 'RR')).toMatchObject({
      rate: '20',
      url: TABLE_SOURCES.icmsLawRr.page,
    });
  });
});
