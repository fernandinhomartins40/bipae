import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseApRicms } from '../../scripts/st-ap.mjs';
import {
  legisWebDescriptionDates,
  legisWebNcms,
  legisWebNotes,
  withoutNotes,
} from '../../scripts/st-legisweb.mjs';
import { parseToRicms } from '../../scripts/st-to.mjs';
import { CESTS } from './cest';
import { TABLE_SOURCES } from './sources';
import {
  ST_REFERENCES,
  ST_REFERENCE_UFS,
  ST_SEGMENTS,
  stReferencesFor,
  stStatusFor,
} from './st-references';

/**
 * F3-26.d.TO e F3-26.d.AP: ST do Tocantins (Anexos XXI e XXII do RICMS/TO) e do Amapá (Apêndices II
 * a XXVI do Anexo III do RICMS/AP), no texto consolidado do LegisWeb (cópia de terceiros, fonte
 * de texto de norma aprovada pelo dono em 27/10/2026). Os casos conferem linha a linha com o texto.
 */

const cestNcms = (cest: string) => CESTS.find((c) => c.cest === cest)?.ncm ?? [];
const known = new Set(CESTS.map((c) => c.cest));
const fonte = (chave: 'stToRicms' | 'stApRicms') =>
  gunzipSync(
    readFileSync(
      fileURLToPath(new URL(`../../sources/${TABLE_SOURCES[chave].file}`, import.meta.url)),
    ),
  );
const linhas = (uf: string, cest: string) =>
  ST_REFERENCES.filter((r) => r.uf === uf).flatMap((r) =>
    r.items
      .filter((i) => i.cest === cest)
      .map((i) => ({ ...i, validFrom: r.validFrom, note: r.note })),
  );
const anexo = (uf: string, code: string) =>
  ST_SEGMENTS.find((s) => s.uf === uf)!.annexes.find((a) => a.annex === code)!;

describe('leitor do LegisWeb', () => {
  it('lê a nota de alteração com a data do decreto e a de efeitos', () => {
    expect(
      legisWebNotes(
        '(Redação do item dada pelo Decreto Nº 3762 DE 18/03/2025, efeitos a partir de 01/05/2025):',
      ),
    ).toEqual([
      expect.objectContaining({
        kind: 'redacao',
        decree: 'Decreto 3.762/2025',
        decreeDate: '2025-03-18',
        effectDate: '2025-05-01',
      }),
    ]);
    expect(legisWebNotes('(Revogado pelo Decreto Nº 6996 DE 07/08/2025):')[0]).toMatchObject({
      kind: 'revogado',
      effectDate: null,
    });
    expect(
      legisWebNotes(
        '(Excluído do regime, nas operações internas, pelo Decreto Nº 6996 DE 07/08/2025):',
      )[0]!.kind,
    ).toBe('excluido');
  });

  it('tira as notas do texto da célula e entende datas da descrição', () => {
    expect(
      withoutNotes(
        'Nafta, exceto petroquímica (Item acrescentado pelo Decreto Nº 9332 DE 30/10/2025).',
      ),
    ).toBe('Nafta, exceto petroquímica.');
    expect(legisWebDescriptionDates('Farinha (vigência até 30.09. 2016).')).toEqual({
      from: null,
      until: '2016-09-30',
    });
    expect(legisWebDescriptionDates('Lata (efeitos a partir de 01.06.2021)').from).toBe(
      '2021-06-01',
    );
  });

  it('NCM: pontos, capítulos, códigos colados e o que não dá para ler', () => {
    expect(legisWebNcms('3815.12.10 | 3815.12.90').ncms).toEqual(['38151210', '38151290']);
    expect(legisWebNcms('Capítulos 61, 62 e 64').ncms).toEqual(['61', '62', '64']);
    expect(legisWebNcms('1602.311602.32').ncms).toEqual(['160231', '160232']);
    expect(legisWebNcms('1101.0010').ncms).toEqual(['11010010']);
    // "204" perdeu o zero da posição 02.04: não se corrige à mão.
    expect(legisWebNcms('204')).toEqual({ ncms: [], invalid: ['204'] });
  });
});

describe('Tocantins: Anexos XXI e XXII do RICMS/TO (F3-26.d.TO)', () => {
  const to = ST_REFERENCES.filter((r) => r.uf === 'TO');

  it('a tabela vem do texto do LegisWeb, com CEST do Convênio e MVA por linha', () => {
    expect(ST_REFERENCE_UFS).toContain('TO');
    expect(TABLE_SOURCES.stToRicms.page).toBe('https://www.legisweb.com.br/legislacao/?id=171145');
    expect(to.flatMap((r) => r.items).length).toBeGreaterThan(550);
    for (const ref of to) {
      expect(ref.validTo).toBeNull();
      for (const item of ref.items) {
        expect(known.has(item.cest), item.cest).toBe(true);
        expect(item.mva, item.item).toMatch(/^\d{1,3}(\.\d{1,4})?$/);
        for (const n of item.ncms) expect(n, item.item).toMatch(/^\d{2,8}$/);
      }
    }
  });

  it('vigência por linha: a mamadeira do Decreto 6.791/2024 vale desde 21/05/2024', () => {
    const antes = stReferencesFor('TO', '39233090', '2024-05-20').map((m) => m.cest);
    expect(antes).not.toContain('2803300');
    const depois = stReferencesFor('TO', '39233090', '2024-05-21').find(
      (m) => m.cest === '2803300',
    );
    expect(depois).toMatchObject({ item: '15.38', mva: '40', description: 'Mamadeiras' });
    // Antes do anexo (Decreto 5.581, de 14/02/2017) não há tabela.
    expect(stReferencesFor('TO', '40111000', '2017-02-13')).toEqual([]);
    expect(
      stReferencesFor('TO', '40111000', '2017-02-14').map((m) => [m.cest, m.mva]),
    ).toContainEqual(['1600100', '42']);
  });

  it('item 16.12 (mamadeiras, CEST 20.063.00) saiu da ST pelo Decreto 6.996/2025', () => {
    expect(linhas('TO', '2006300')).toEqual([]);
    const em = (data: string) =>
      stStatusFor('TO', '39233090', data, cestNcms).filter((s) => s.annex === 'XXI.16');
    expect(em('2025-08-06')[0]).toMatchObject({ cest: '2006300', inSt: true });
    expect(em('2025-08-07')[0]).toMatchObject({
      inSt: false,
      excludedFrom: '2025-08-07',
      excludedBy: 'Decreto 6.996/2025',
    });
    // A seção de sorvetes saiu no mesmo decreto.
    expect(anexo('TO', 'XXI.9').cests[0]).toMatchObject({
      cest: '2300100',
      excludedFrom: '2025-08-07',
    });
    expect(to.some((r) => r.items.some((i) => i.cest === '2300100'))).toBe(false);
  });

  it('o quadro de MVA do texto vale para as linhas da tabela antes dele', () => {
    // Medicamentos de referência: lista positiva, negativa e neutra, cada uma com a sua MVA.
    expect(['1300100', '1300101', '1300102'].map((cest) => linhas('TO', cest)[0]!.mva)).toEqual([
      '38.24',
      '33.05',
      '41.34',
    ]);
    expect(linhas('TO', '1600100')[0]).toMatchObject({ item: '2.1', mva: '42' });
    expect(linhas('TO', '2400100')[0]!.mva).toBe('35');
    // Açúcar: a MVA depende do tipo (cristal 15%, refinado 10%, outros 20%).
    expect(linhas('TO', '1710100')[0]!.mva).toBe('15');
    expect(linhas('TO', '1709900')[0]!.mva).toBe('10');
    expect(linhas('TO', '1710300')[0]!.mva).toBe('20');
  });

  it('farinha de trigo: 60% até 5 kg e 150% acima, pela embalagem da descrição', () => {
    expect(linhas('TO', '1704400')[0]!.mva).toBe('60');
    expect(linhas('TO', '1704403')[0]!.mva).toBe('150');
    // Sem embalagem na descrição (mistura de trigo e centeio): falta configurar.
    expect(linhas('TO', '1704500')).toEqual([]);
  });

  it('duas colunas ou dois quadros viram duas linhas rotuladas', () => {
    const agua = linhas('TO', '0300300');
    expect(agua.map((i) => i.mva)).toEqual(['100', '140']);
    expect(agua[0]!.description).toMatch(/distribuidor, depósito ou atacadista/);
    expect(agua[1]!.description).toMatch(/indústria, importador, arrematante ou engarrafador/);
    const catalisador = linhas('TO', '0100100');
    expect(catalisador.map((i) => i.mva)).toEqual(['36.56', '71.78']);
    expect(catalisador[0]!.description).toMatch(/1º quadro.*não diz qual/);
  });

  it('exclusão parcial do Decreto 6.996/2025 fica na descrição, sem tirar a linha', () => {
    const cerveja = linhas('TO', '0302100')[0]!;
    expect(cerveja.description).toMatch(
      /excluído da ST nas saídas internas de fabricante estabelecido no TO desde 07\/08\/2025, Decreto 6\.996\/2025/,
    );
  });

  it('Anexo XXII (veículos): item reaberto pelo Decreto 7.219/2026 mantém o início de 01/01/2026', () => {
    expect(stReferencesFor('TO', '87044100', '2025-12-31').map((m) => m.cest)).not.toContain(
      '2503000',
    );
    expect(
      stReferencesFor('TO', '87044100', '2026-01-01').find((m) => m.cest === '2503000'),
    ).toMatchObject({ mva: '30' });
    expect(linhas('TO', '2600100')[0]).toMatchObject({ mva: '34', validFrom: '2026-08-14' });
  });

  it('lâmpada de LED (6.5): redação do Decreto 7.062/2025 e MVA da própria linha', () => {
    expect(linhas('TO', '0900500')[0]).toMatchObject({ mva: '63.67', validFrom: '2025-12-23' });
  });

  it('o que o texto não fecha vai para a lista de pendências e não vira regra', () => {
    const { pending } = parseToRicms(fonte('stToRicms'), known);
    const texto = pending.map((p) => p.message).join('\n');
    expect(texto).toContain('CEST "17.081.00 | 17.080.00"'); // dois CEST na mesma linha
    expect(texto).toContain('CEST "03.012.0"'); // CEST cortado
    expect(texto).toContain('NCM "204"'); // posição sem o zero
    expect(texto).toMatch(/13\.33\.1 .*não é farinha/); // conserva na tabela da farinha
    expect(linhas('TO', '1708500')).toEqual([]);
    // O 13.33.1 (na tabela da farinha) fica sem MVA; o 13.39.2 do mesmo CEST, em aves, tem a dele.
    expect(linhas('TO', '1707901').map((i) => i.item)).toEqual(['13.39.2']);
  });
});

describe('Amapá: Apêndices II a XXVI do Anexo III do RICMS/AP (F3-26.d.AP)', () => {
  const ap = ST_REFERENCES.filter((r) => r.uf === 'AP');

  it('a tabela vem do texto do LegisWeb, com CEST do Convênio e MVA original', () => {
    expect(ST_REFERENCE_UFS).toContain('AP');
    expect(TABLE_SOURCES.stApRicms.page).toBe('https://www.legisweb.com.br/legislacao/?id=244693');
    expect(ap.flatMap((r) => r.items).length).toBeGreaterThan(1000);
    for (const ref of ap) {
      expect(ref.validTo).toBeNull();
      for (const item of ref.items) {
        expect(known.has(item.cest), item.cest).toBe(true);
        expect(item.mva, item.item).toMatch(/^\d{1,3}(\.\d{1,4})?$/);
        for (const n of item.ncms) expect(n, item.item).toMatch(/^\d{2,8}$/);
      }
    }
  });

  it('vigência por linha: água mineral com a redação do Decreto 3.762/2025, desde 01/05/2025', () => {
    expect(stReferencesFor('AP', '22011000', '2025-04-30').map((m) => m.cest)).not.toContain(
      '0300300',
    );
    expect(
      stReferencesFor('AP', '22011000', '2025-05-01').find((m) => m.cest === '0300300'),
    ).toMatchObject({ item: '3.0', mva: '100' });
    // Chocolate: item de 23/02/2024 (Decreto 1.682).
    expect(stReferencesFor('AP', '18063210', '2024-02-22').map((m) => m.cest)).not.toContain(
      '1700300',
    );
    expect(
      stReferencesFor('AP', '18063210', '2024-02-23').find((m) => m.cest === '1700300'),
    ).toMatchObject({ mva: '39' });
    // O mesmo apêndice tem linhas com datas diferentes, em referências separadas.
    expect(
      new Set(ap.filter((r) => r.segment === '17').map((r) => r.validFrom)).size,
    ).toBeGreaterThan(2);
  });

  it('linha sem nota vale desde o Anexo III atual (Decreto 5.097, de 28/12/2017)', () => {
    expect(linhas('AP', '0500100')[0]).toMatchObject({ mva: '20', validFrom: '2017-12-28' });
    expect(stReferencesFor('AP', '2523', '2017-12-27')).toEqual([]);
    expect(linhas('AP', '1706203')[0]!.mva).toBe('15');
  });

  it('autopeças e porta a porta têm duas MVAs, uma por coluna', () => {
    const catalisador = linhas('AP', '0100100');
    expect(catalisador.map((i) => [i.mva, i.description])).toEqual([
      ['71.78', expect.stringMatching(/MVA para regra geral/)],
      ['36.56', expect.stringMatching(/MVA para índice fidelidade/)],
    ]);
    const perfume = linhas('AP', '2800100');
    expect(perfume.map((i) => i.mva)).toEqual(['262.1', '49.64']);
    expect(perfume[0]!.description).toMatch(/saída da indústria/);
    expect(perfume[1]!.description).toMatch(/saída do atacado/);
  });

  it('item revogado sai da ST com a data e o decreto (água do Decreto 4.909/2021)', () => {
    expect(anexo('AP', 'IV').cests.find((c) => c.cest === '0300100')).toMatchObject({
      excludedFrom: '2021-12-30',
      excludedBy: 'Decreto 4.909/2021',
    });
    expect(linhas('AP', '0300100')).toEqual([]);
    const status = stStatusFor('AP', '22011000', '2022-01-01', cestNcms).find(
      (s) => s.cest === '0300100',
    );
    expect(status).toMatchObject({ annex: 'IV', inSt: false, excludedBy: 'Decreto 4.909/2021' });
  });

  it('nafta (Decreto 9.332/2025) está na lista, sem MVA: combustível vai por preço', () => {
    expect(anexo('AP', 'VII').cests).toContainEqual({ cest: '0601900', ncms: ['2710'] });
    expect(linhas('AP', '0601900')).toEqual([]);
    expect(linhas('AP', '0600200')).toEqual([]);
  });

  it('veículos: só as linhas com MVA no texto entram; as demais ficam como "falta configurar"', () => {
    expect(linhas('AP', '2503000')[0]).toMatchObject({ mva: '30' });
    expect(linhas('AP', '2500300')).toEqual([]);
    expect(anexo('AP', 'XXIV').cests.some((c) => c.cest === '2500300')).toBe(true);
    expect(linhas('AP', '2600100')[0]).toMatchObject({ mva: '34' });
  });

  it('alimentos avisam do Protocolo ICMS 11/2026, que o texto lido não incorpora', () => {
    const alimentos = ap.filter((r) => r.segment === '17');
    expect(alimentos.length).toBeGreaterThan(0);
    for (const r of alimentos) expect(r.note).toMatch(/Protocolo ICMS 11\/2026/);
    expect(
      ap.filter((r) => r.segment !== '17').every((r) => !/Protocolo ICMS 11\/2026/.test(r.note)),
    ).toBe(true);
  });

  it('o que o texto não fecha vai para a lista de pendências', () => {
    const { pending } = parseApRicms(fonte('stApRicms'), known);
    const texto = pending.map((p) => p.message).join('\n');
    expect(texto).toContain('CEST "1901.90.90"'); // NCM escrito na coluna do CEST
    expect(texto).toContain('CEST "17.046.14 |"');
    expect(texto).toContain('NCM "008.13 | 009.09"');
  });
});
