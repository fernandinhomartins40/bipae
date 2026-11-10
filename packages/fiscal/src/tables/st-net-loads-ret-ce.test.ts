import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { pdfLines } from '../../scripts/pdf-text.mjs';
import { CE_RET_ADJUSTED_LOADS, ST_NET_LOAD_REGIMES } from './st-net-loads';
import { TABLE_SOURCES } from './sources';

/**
 * F3-26.d.CE.h: a tabela ajustada do RET (IN SEFAZ 151/2023 na redação da IN SEFAZ 12/2024) é
 * copiada à mão do Diário Oficial guardado em sources/. O teste lê as páginas da IN 12/2024 e exige,
 * para cada decreto e na ordem do ato, as linhas com os três percentuais (próprio Estado e exterior;
 * N, NE, CO e ES; Sul e Sudeste sem o ES).
 */
const texto = async (key: keyof typeof TABLE_SOURCES, pages: [number, number]) =>
  (
    await pdfLines(
      readFileSync(
        fileURLToPath(new URL(`../../sources/${TABLE_SOURCES[key].file}`, import.meta.url)),
      ),
      { pages },
    )
  )
    .join(' ')
    .replace(/\s+%/g, '%');
const pct = (p: string) => `${p.replace('.', ',')}%`;
const ORIGENS = ['internal', 'n-ne-co-es', 's-se-except-es'] as const;

describe('RET do Ceará: carga ajustada da IN SEFAZ 151/2023 com a IN SEFAZ 12/2024', () => {
  it('cada linha está no Diário Oficial, na ordem do ato', async () => {
    const doe = await texto('stCeRetIn12', [41, 42]);
    let desde = 0;
    for (const regime of CE_RET_ADJUSTED_LOADS.regimes) {
      for (const load of regime.loads) {
        const linha = ORIGENS.map((o) => pct(load.percents[o]!)).join(' ');
        const achou = doe.indexOf(linha, desde);
        expect(achou, `${regime.regime} ${load.goodsClass}: ${linha}`).toBeGreaterThanOrEqual(0);
        desde = achou + linha.length;
      }
    }
  });

  it('a IN 151/2023 guardada é a que a IN 12/2024 corrige', async () => {
    const in151 = await texto('stCeRetIn151', [61, 62]);
    expect(in151).toMatch(/INSTRUÇÃO NORMATIVA N[º°.]+ ?151/);
    const in12 = await texto('stCeRetIn12', [41, 42]);
    expect(in12).toMatch(/Instrução Normativa n[º°.]+ ?151/i);
  });

  it('decretos e classes existem na tabela de carga líquida, e o 31.066 fica de fora', () => {
    for (const regime of CE_RET_ADJUSTED_LOADS.regimes) {
      const base = ST_NET_LOAD_REGIMES.find((r) => r.act === regime.regime);
      expect(base?.specialRegime?.kind, regime.regime).toBe('annex-iii');
      const classes = new Set(base!.versions.flatMap((v) => v.loads.map((l) => l.goodsClass)));
      for (const load of regime.loads) expect(classes.has(load.goodsClass)).toBe(true);
      for (const o of ORIGENS) expect(regime.loads.every((l) => l.percents[o])).toBe(true);
    }
    expect(CE_RET_ADJUSTED_LOADS.regimes.map((r) => r.regime)).toEqual([
      'Decreto 30.519/2011 (CE)',
      'Decreto 31.270/2013 (CE)',
      'Decreto 32.900/2018 (CE)',
    ]);
  });
});
