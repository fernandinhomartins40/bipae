import { describe, expect, it } from 'vitest';
import { assertValidity, overlaps } from '../validity';
import {
  CESTS,
  CEST_SEGMENTS,
  cestValidity,
  cestsForNcm,
  findCest,
  findCestSegment,
  normalizeCest,
} from './cest';

const HOJE = '2026-10-13';

describe('tabela de CEST', () => {
  it('traz os 25 segmentos do convênio', () => {
    expect(CEST_SEGMENTS).toHaveLength(25);
    expect(findCestSegment('01')?.name).toBe('Autopeças');
    expect(findCestSegment('03')?.name).toMatch(/^Cervejas, chopes, refrigerantes/);
    expect(findCestSegment('99')).toBeNull();
  });

  it('todo CEST tem sete dígitos, segmento conhecido, descrição e vigência válida', () => {
    expect(CESTS.length).toBeGreaterThan(1000);
    for (const item of CESTS) {
      expect(item.cest).toMatch(/^\d{7}$/);
      expect(item.cest.slice(0, 2), item.cest).toBe(item.segment);
      expect(findCestSegment(item.segment), item.cest).not.toBeNull();
      expect(item.description, item.cest).not.toBe('');
      expect(item.description, item.cest).not.toMatch(/revogad/i);
      assertValidity(cestValidity(item));
      for (const prefixo of item.ncm) expect(prefixo, item.cest).toMatch(/^\d{2,8}$/);
    }
  });

  it('um código só se repete com vigências que não se cruzam', () => {
    const porCodigo = new Map<string, typeof CESTS[number][]>();
    for (const item of CESTS) porCodigo.set(item.cest, [...(porCodigo.get(item.cest) ?? []), item]);
    for (const [codigo, versoes] of porCodigo) {
      for (let i = 0; i < versoes.length; i++) {
        for (let j = i + 1; j < versoes.length; j++) {
          expect(overlaps(cestValidity(versoes[i]!), cestValidity(versoes[j]!)), codigo).toBe(false);
        }
      }
    }
  });

  it('acha o CEST com ou sem pontos', () => {
    expect(normalizeCest(' 03.021.00 ')).toBe('0302100');
    expect(findCest('03.021.00', HOJE)).toMatchObject({
      cest: '0302100',
      segment: '03',
      ncm: ['22030000'],
      description: 'Cerveja em garrafa de vidro retornável',
    });
    expect(findCest('0302100', HOJE)?.item).toBe('21.0');
  });

  it('não devolve código inexistente, revogado ou fora da vigência', () => {
    expect(findCest('9999999', HOJE)).toBeNull();
    // Item 110.0 do Anexo II, revogado pelo Conv. ICMS 165/19.
    expect(findCest('01.110.00', HOJE)).toBeNull();
    expect(findCest('03.021.00', '2018-12-31')).toBeNull();
  });

  it('respeita a troca de redação com data marcada', () => {
    const versoes = CESTS.filter((c) => c.end !== undefined);
    expect(versoes.length).toBeGreaterThan(0);
    for (const antiga of versoes) {
      // No último dia vale a redação antiga; no dia do fim já vale a nova.
      const vespera = new Date(Date.parse(`${antiga.end}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
      expect(findCest(antiga.cest, vespera)?.description, antiga.cest).toBe(antiga.description);
      const nova = findCest(antiga.cest, antiga.end!);
      expect(nova, antiga.cest).not.toBeNull();
      expect(nova!.start, antiga.cest).toBe(antiga.end);
    }
  });

  it('guarda o texto da coluna NCM quando ela não é só código', () => {
    const artigosInfantis = findCest('28.064.00', HOJE)!;
    expect(artigosInfantis.ncmText).toBe('Capítulos 39, 49, 95, 96');
    expect(artigosInfantis.ncm).toEqual(['39', '49', '95', '96']);
    // Item genérico do segmento: sem NCM, vale para qualquer um.
    expect(findCest('01.999.00', HOJE)).toMatchObject({ ncm: [] });
    expect(findCest('01.999.00', HOJE)!.ncmText).toBeUndefined();
  });

  it('sugere os CEST de um NCM, do mais específico para o mais genérico', () => {
    const cerveja = cestsForNcm('2203.00.00', HOJE);
    expect(cerveja.length).toBeGreaterThan(1);
    expect(cerveja.map((c) => c.cest)).toContain('0302100');
    expect(cerveja[0]!.segment).toBe('03');
    // O item de porta a porta que abrange o capítulo 22 inteiro casa também, mas vem por último.
    expect(cerveja.at(-1)).toMatchObject({ cest: '2806300', segment: '28' });
    expect(cerveja.filter((c) => c.segment !== '03').map((c) => c.segment)).toEqual(['28']);

    const queijo = cestsForNcm('04061010', HOJE);
    // O prefixo de 8 dígitos (muçarela) vem antes do genérico "0406" (queijos).
    expect(queijo[0]!.ncm).toContain('04061010');
    expect(queijo.at(-1)!.ncm).toContain('0406');
  });

  it('não sugere nada para NCM incompleto, sem CEST ou antes do convênio', () => {
    expect(cestsForNcm('2203', HOJE)).toEqual([]);
    expect(cestsForNcm('01012100', HOJE)).toEqual([]);
    expect(cestsForNcm('22030000', '2018-12-31')).toEqual([]);
  });
});
