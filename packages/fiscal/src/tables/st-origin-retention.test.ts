import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { stReferencesFor } from './st-references';
import { ST_ORIGIN_NO_RETENTION, stOriginRetentionFor } from './st-origin-retention';

/** Texto da cláusula primeira do Protocolo ICMS 11/2026, tirado do HTML do CONFAZ guardado. */
function cestClause(): string {
  const html = gunzipSync(
    readFileSync(
      join(__dirname, '../../sources/CONFAZ_Protocolo_ICMS_11-2026_AP_SP_2026-10-28.html.gz'),
    ),
  ).toString('utf8');
  const text = html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');
  const start = text.indexOf('CEST - 17.001.02');
  const end = text.indexOf('destinadas ao Estado do Amap', start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return text.slice(start, end);
}

/** Todos os CEST citados na cláusula, na ordem, e quais deles abrem uma faixa ("X a Y"). */
function citedCodes(clause: string): { codes: string[]; rangeStarts: Set<string> } {
  const codes = clause.match(/17\.\d{3}\.\d{2}/g) ?? [];
  const rangeStarts = new Set<string>();
  for (const m of clause.matchAll(/(17\.\d{3}\.\d{2}) a 17\.\d{3}\.\d{2}/g)) rangeStarts.add(m[1]!);
  return { codes, rangeStarts };
}

describe('retenção da ST na origem: Protocolo ICMS 11/2026 (AP)', () => {
  const rule = ST_ORIGIN_NO_RETENTION.find((r) => r.destUf === 'AP')!;

  it('a lista confere com o texto do CONFAZ guardado, extremo a extremo', () => {
    const { codes } = citedCodes(cestClause());
    // Cada código citado no ato é início ou fim de uma faixa (ou código solto) da nossa lista.
    const ours = rule.cestRanges.flatMap(([from, to]) => (from === to ? [from] : [from, to]));
    expect(ours).toEqual(codes);
  });

  it('as faixas do ato ("X a Y") são faixas na lista, e o resto são códigos soltos', () => {
    const { rangeStarts } = citedCodes(cestClause());
    const ours = new Set(rule.cestRanges.filter(([a, b]) => a !== b).map(([a]) => a));
    expect(ours).toEqual(rangeStarts);
  });

  it('vale desde 01/03/2026 e só para o Amapá', () => {
    expect(stOriginRetentionFor('AP', '1708800', '2026-02-28')).toBeNull();
    expect(stOriginRetentionFor('AP', '1708800', '2026-03-01')).toMatchObject({
      withheldByOrigin: false,
      destUf: 'AP',
      url: expect.stringContaining('pt011_26'),
    });
    expect(stOriginRetentionFor('ap', '17.088.00', '2026-10-28')).not.toBeNull();
    expect(stOriginRetentionFor('SP', '1708800', '2026-10-28')).toBeNull();
  });

  it('casa faixas e códigos soltos, com ou sem pontos, e deixa de fora o resto', () => {
    const d = '2026-10-28';
    expect(stOriginRetentionFor('AP', '17.016.01', d)).not.toBeNull(); // início de faixa
    expect(stOriginRetentionFor('AP', '1701701', d)).not.toBeNull(); // dentro da faixa
    expect(stOriginRetentionFor('AP', '17.018.01', d)).not.toBeNull(); // fim de faixa
    expect(stOriginRetentionFor('AP', '1700102', d)).not.toBeNull(); // código solto
    expect(stOriginRetentionFor('AP', '1700100', d)).toBeNull(); // 17.001.00 não está na lista
    expect(stOriginRetentionFor('AP', '1700101', d)).toBeNull();
    expect(stOriginRetentionFor('AP', '17.016.00', d)).toBeNull(); // logo antes da faixa
    expect(stOriginRetentionFor('AP', '17.118.00', d)).toBeNull(); // depois do último
    expect(stOriginRetentionFor('AP', '2100100', d)).toBeNull(); // outro segmento
    expect(stOriginRetentionFor('AP', '123', d)).toBeNull(); // CEST inválido
  });

  it('D-059: "17.019.03 17.020.01" sem vírgula foi lido como dois códigos; 17.020.00 fica de fora', () => {
    const d = '2026-10-28';
    expect(stOriginRetentionFor('AP', '17.019.03', d)).not.toBeNull();
    expect(stOriginRetentionFor('AP', '17.020.01', d)).not.toBeNull();
    expect(stOriginRetentionFor('AP', '17.020.00', d)).toBeNull();
    expect(stOriginRetentionFor('AP', '17.019.02', d)).toBeNull();
  });

  it('a tabela do Amapá avisa por item, sem tirar o item da lista de ST', () => {
    // Chocolate recheado em tablete: CEST 17.002.02 (na lista do protocolo) e 17.002.00 (fora).
    const itens = stReferencesFor('AP', '1806.31.10', '2026-10-28');
    expect(itens.length).toBeGreaterThan(0);
    const semRetencao = itens.find((i) => i.cest === '1700202' || i.cest === '1700203');
    const comRetencao = itens.find((i) => i.cest === '1700200');
    // Os itens continuam na lista do Anexo III (a ST do AP não mudou).
    expect(comRetencao ?? semRetencao).toBeDefined();
    for (const i of itens) {
      if (stOriginRetentionFor('AP', i.cest, '2026-10-28')) {
        expect(i.originRetention).toMatchObject({ withheldByOrigin: false, destUf: 'AP' });
      } else {
        expect(i.originRetention).toBeUndefined();
      }
    }
    // Antes de 01/03/2026 nenhum item traz o aviso.
    for (const i of stReferencesFor('AP', '1806.31.10', '2026-02-27')) {
      expect(i.originRetention).toBeUndefined();
    }
  });
});
