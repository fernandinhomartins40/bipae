import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { ST_REFERENCES, ST_REFERENCE_UFS, ST_SEGMENT_UFS, stReferencesFor } from './st-references';

/** F3-26.d.RR: ST de Roraima por seção e NCM, com o percentual do artigo do RICMS/RR. */

const pacote = (caminho: string) => fileURLToPath(new URL(`../../${caminho}`, import.meta.url));
const hoje = '2026-10-27';
const rr = ST_REFERENCES.filter((r) => r.uf === 'RR');
/** MVAs do NCM em Roraima, só da seção do artigo indicado. */
const mvas = (ncm: string, artigo = '', data = hoje) =>
  stReferencesFor('RR', ncm, data)
    .filter((m) => m.act.includes(artigo))
    .map((m) => m.mva);

describe('substituição tributária de Roraima (RICMS/RR, F3-26.d.RR)', () => {
  it('não usa CEST: as linhas vão por seção e NCM, e o estado fica fora da lista de segmentos', () => {
    expect(ST_REFERENCE_UFS).toContain('RR');
    // Sem a lista do Convênio ICMS 142/18, não há "o que saiu da ST" por CEST.
    expect(ST_SEGMENT_UFS).not.toContain('RR');
    expect(rr.length).toBeGreaterThanOrEqual(15);
    for (const ref of rr) {
      expect(ref.segment).toBe('');
      expect(ref.source).toBe('stRrRicms');
      expect(ref.act).toMatch(/^RICMS\/RR \(Decreto 4\.335-E\/2001\)/);
      expect(ref.url).toMatch(/^https:\/\/www\.sefaz\.rr\.gov\.br\//);
      expect(ref.validFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(ref.validTo).toBeNull();
      for (const item of ref.items) {
        expect(item.cest, item.item).toBe('');
        expect(item.mva, item.item).toMatch(/^\d{1,3}(\.\d{1,2})?$/);
        expect(item.ncms.length, item.item).toBeGreaterThan(0);
        for (const n of item.ncms) expect(n, item.item).toMatch(/^\d{2,8}$/);
      }
    }
  });

  it('cigarros: 50% na falta de preço sugerido, desde o Decreto 26.028/18 (data aproximada na nota)', () => {
    expect(mvas('24022000')).toEqual(['50']);
    expect(mvas('24031100')).toEqual(['50']);
    expect(mvas('24022000', '', '2018-12-30')).toEqual([]);
    const nota = stReferencesFor('RR', '24022000', hoje)[0]!.note;
    expect(nota).toMatch(/Decreto 26\.028 não consta do texto/);
  });

  it('bebidas: o percentual depende do produto e da embalagem, como diz o art. 768 (Decreto 35.559-E/2024)', () => {
    // Refrigerante (2202): garrafa de 600 ml ou mais 40%, pré/post-mix 100%, demais casos 70% (distribuidor)
    // e 140% para o industrial.
    expect(new Set(mvas('22021000', 'arts. 767 e 768'))).toEqual(
      new Set(['40', '100', '70', '140']),
    );
    expect(mvas('22021000', 'arts. 767 e 768', '2024-02-25')).toEqual([]);
    // Água (2201): 70, 100 ou 170 conforme a embalagem, igual para qualquer origem.
    expect(new Set(mvas('22011000'))).toEqual(new Set(['70', '100', '170']));
    // Cerveja e chope (2203): 115% (chope do atacadista), 70% (cerveja do atacadista) e 140% (industrial).
    expect(new Set(mvas('22030000'))).toEqual(new Set(['115', '70', '140']));
    // O xarope do pré-mix (2106.90.10) acompanha o refrigerante; a posição 2106 também está nos
    // preparados para sorvete em máquina (328%).
    expect(new Set(mvas('21069010'))).toEqual(new Set(['100', '140', '328']));
    // Gelo não tem percentual na redação vigente do art. 768: a nota avisa.
    expect(stReferencesFor('RR', '22021000', hoje)[0]!.note).toMatch(/Gelo/);
  });

  it('veículos: 30% pela tabela de NBM/SH do art. 769 e 34% nas motos (posição 8711), com as vigências dos decretos', () => {
    expect(mvas('87032100')).toEqual(['30']);
    expect(mvas('87032100', '', '2013-10-15')).toEqual([]);
    expect(mvas('87042110')).toEqual(['30']);
    expect(mvas('87112000')).toEqual(['34']);
    expect(mvas('87112000', '', '2013-11-13')).toEqual([]);
    // A exceção (caminhão de peso em carga máxima superior a 3,9 t) está na descrição, não no NCM.
    expect(stReferencesFor('RR', '87042110', hoje)[0]!.description).toMatch(/Exceção: Caminhão/);
  });

  it('pneus, cimento, rações e sorvetes: o percentual do artigo na posição da NCM', () => {
    expect(new Set(mvas('40111000'))).toEqual(new Set(['42', '32', '60', '45']));
    expect(mvas('40131000')).toEqual(['45']);
    expect(mvas('40129090')).toEqual(['45']);
    expect(mvas('25232910')).toEqual(['20']);
    expect(mvas('23091000')).toEqual(['46']);
    expect(mvas('21050010')).toEqual(['70']);
    // 1901 está nos preparados para sorvete (328%) e na mistura de farinha de trigo (1901.20.00: 76,48%).
    expect(new Set(mvas('19012000'))).toEqual(new Set(['328', '76.48']));
    expect(mvas('21050010', '', '2011-09-08')).toEqual([]);
  });

  it('farinha de trigo: massas pela margem dos derivados; o trigo e a farinha sem NCM no texto ficam de fora', () => {
    expect(mvas('19021100')).toEqual(['50']);
    expect(mvas('19023000')).toEqual(['50']);
    expect(mvas('19024000')).toEqual([]);
    // O art. 788 dá 94,12% ao trigo em grão e 76,48% à farinha, mas o texto não traz o NCM deles.
    expect(mvas('11010010')).toEqual([]);
    expect(mvas('10019900')).toEqual([]);
    expect(stReferencesFor('RR', '19021100', hoje)[0]!.note).toMatch(/antecipado/);
  });

  it('farmacêuticos e perfumes: 30% pelo quadro do art. 798 e pelo Capítulo 33', () => {
    expect(mvas('30049099')).toEqual(['30']);
    expect(mvas('30021500')).toEqual(['30']);
    // Dentifrício: no quadro dos farmacêuticos (item X) e no Capítulo 33, com a mesma MVA.
    expect(mvas('33061000')).toEqual(['30', '30']);
    expect(mvas('33030010')).toEqual(['30']);
    expect(mvas('30049099', '', '2019-09-22')).toEqual([]);
  });

  it('tintas: 35% nos itens I a IX e 50% nos corantes, com a exceção do NCM do próprio quadro', () => {
    expect(mvas('32091000')).toEqual(['35']);
    expect(mvas('32041100')).toEqual(['50']);
    // 3206.11.19 (pigmento de dióxido de titânio) sai do item IV (35%) e fica no item X (corantes, 50%).
    expect(mvas('32061119')).toEqual(['50']);
    expect(new Set(mvas('32061200'))).toEqual(new Set(['35', '50']));
    // 2710.11.30 sai do item II, mas o item III lista a posição 2710 inteira.
    expect(stReferencesFor('RR', '27101130', hoje).map((m) => m.item)).toEqual(['825 III']);
  });

  it('lâminas, lâmpadas, telhas, celulares: a MVA do quadro de cada artigo', () => {
    const lampadas = 'arts. 838 e 839';
    expect(mvas('82122010', lampadas)).toEqual(['30']);
    expect(mvas('85391000', lampadas)).toEqual(['60.03']);
    // LED: o Decreto 28.036-E/2019 tirou o 8543.70.99 e deu redação própria ao item 5.
    expect(mvas('85395000', 'Decreto 28.036')).toEqual(['63.67']);
    expect(mvas('85395000', 'Decreto 26.414')).toEqual(['60.03']);
    expect(mvas('85395000', 'Decreto 28.036', '2019-11-24')).toEqual([]);
    expect(mvas('85041000', lampadas)).toEqual(['53.13']);
    expect(mvas('85365000', lampadas)).toEqual(['102.31']);
    expect(mvas('68111000', 'arts. 839-B')).toEqual(['30']);
    expect(mvas('85171231', 'art. 839-T')).toEqual(['25']);
    expect(mvas('85171231', 'art. 839-T', '2020-02-29')).toEqual([]);
    expect(mvas('85235200', 'art. 839-T')).toEqual(['25']);
  });

  it('autopeças: quadro do art. 839-E com as duas MVAs do art. 839-F, § 2º (36,56% e 71,78%)', () => {
    const pecas = 'arts. 839-E';
    expect(new Set(mvas('84099190', pecas))).toEqual(new Set(['36.56', '71.78']));
    expect(new Set(mvas('87089990', pecas))).toEqual(new Set(['36.56', '71.78']));
    // O item 125 ("outras peças") não tem NCM e não entra.
    expect(mvas('87199999', pecas)).toEqual([]);
    // Obras moldadas de ferro (7325) menos 7325.91.00 (bola de moagem).
    expect(mvas('73259100', pecas)).toEqual([]);
    expect(new Set(mvas('73259900', pecas))).toEqual(new Set(['36.56', '71.78']));
    expect(mvas('87089990', pecas, '2015-03-23')).toEqual([]);
  });

  it('materiais de construção: 35% sobre a lista do § 1º, II, com as exceções por NCM e por descrição', () => {
    const obra = 'art. 839-Q';
    expect(mvas('25221000', obra)).toEqual(['35']);
    expect(mvas('39173900', obra)).toEqual(['35']);
    // 3917.32.21 e 3917.32.51 saem do item de tubos de plástico.
    expect(mvas('39173221', obra)).toEqual([]);
    expect(mvas('39173251', obra)).toEqual([]);
    expect(mvas('72081000', obra)).toEqual(['35']);
    expect(mvas('85361090', obra)).toEqual(['35']);
    // 8536.50.90 sai do item 8536.
    expect(mvas('85365090', obra)).toEqual([]);
    // A exceção em palavras (telhas e caixas d'água) está na descrição.
    expect(stReferencesFor('RR', '68101100', hoje)[0]!.description).toMatch(/exceto telhas/);
    expect(mvas('25221000', obra, '2019-03-31')).toEqual([]);
  });

  it('o que não tem NCM no texto, ou não é MVA, não vira linha: frango, óleo, bebidas alcoólicas, combustíveis', () => {
    expect(mvas('02071100')).toEqual([]);
    expect(mvas('15079011')).toEqual([]);
    expect(mvas('22083020')).toEqual([]);
    expect(mvas('27111100')).toEqual([]);
  });
});

describe('Maranhão: tabelas conferidas contra o texto do RICMS/MA no LegisWeb (F3-26.d.MA.c)', () => {
  const html = gunzipSync(
    readFileSync(
      pacote('sources/LegisWeb_MA_RICMS_Decreto_19714-2003_Anexos_4_2026-10-27.html.gz'),
    ),
  ).toString('utf8');
  const text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');
  /** Trecho do anexo: do último "ANEXO 4.n" (os primeiros são o sumário) até o título do próximo. */
  const annex = (n: string) => {
    const re = new RegExp(`ANEXO ${n.replace('.', '\\.')}(?![\\d.])`, 'g');
    const at = [...text.matchAll(re)].at(-1)?.index;
    if (at === undefined) throw new Error(`Anexo ${n} não achado`);
    const next = text.slice(at + 12).search(/ANEXO 4\.\d+/);
    return text.slice(at, next < 0 ? undefined : at + 12 + next);
  };
  const lines = (n: string) =>
    ST_REFERENCES.filter((r) => r.uf === 'MA' && r.act.endsWith(`Anexo ${n}`)).flatMap(
      (r) => r.items,
    );
  const pt = (mva: string) => mva.replace('.', ',');
  const cestMask = (cest: string) => `${cest.slice(0, 2)}.${cest.slice(2, 5)}.${cest.slice(5)}`;

  it('o texto do LegisWeb traz os anexos de ST de 4.5 a 4.48', () => {
    for (const n of [
      '4.5',
      '4.13',
      '4.16',
      '4.17',
      '4.19',
      '4.38',
      '4.45',
      '4.46',
      '4.47',
      '4.48',
    ]) {
      expect(annex(n).length, n).toBeGreaterThan(300);
    }
  });

  it.each(['4.5', '4.13', '4.16', '4.17', '4.19', '4.38', '4.45', '4.46'])(
    'Anexo %s: cada CEST da tabela está no texto, e a MVA também',
    (n) => {
      const body = annex(n);
      const items = lines(n);
      expect(items.length, n).toBeGreaterThan(0);
      for (const item of items) {
        if (item.cest) expect(body, `${n} CEST ${item.cest}`).toContain(cestMask(item.cest));
        expect(body, `${n} MVA ${item.mva}`).toMatch(
          new RegExp(`(?<![\\d,.])${pt(item.mva).replace('.', '\\.')}(?![\\d])`),
        );
      }
    },
  );

  it('medicamentos (4.17): as três MVAs por lista do texto', () => {
    const body = annex('4.17');
    for (const v of ['33,05', '38,24', '41,34']) expect(body).toContain(v);
    expect(new Set(lines('4.17').map((i) => i.mva))).toEqual(new Set(['33.05', '38.24', '41.34']));
  });

  it('nafta (4.47): MVA por fórmula da alíquota "ad rem", sem percentual fixo: fica "falta configurar"', () => {
    const body = annex('4.47');
    expect(body).toContain('2710.12.49');
    expect(body).toContain('06.019.00');
    expect(body).toContain('ad rem');
    expect(ST_REFERENCES.filter((r) => r.uf === 'MA').flatMap((r) => r.items)).not.toContainEqual(
      expect.objectContaining({ cest: '0601900' }),
    );
  });

  it('os anexos revogados ficam de fora da tabela', () => {
    for (const n of ['4.7', '4.9', '4.10', '4.18', '4.29', '4.32', '4.34', '4.43', '4.44']) {
      expect(lines(n), n).toEqual([]);
    }
  });
});
