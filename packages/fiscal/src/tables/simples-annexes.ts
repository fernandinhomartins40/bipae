import data from './data/simples-annexes.json';

/**
 * Anexos I a V do Simples Nacional (LC 123/2006, redação da LC 155/2016), gerados do texto
 * compilado do Planalto: as seis faixas de receita bruta em 12 meses, com a alíquota nominal e o
 * valor a deduzir. Servem para achar a alíquota efetiva, que o dono raramente sabe de cabeça.
 */
export type SimplesAnnexId = 'I' | 'II' | 'III' | 'IV' | 'V';

export interface SimplesBracket {
  bracket: number;
  /** Receita bruta em 12 meses até a qual a faixa vale, em centavos. */
  upToCents: number;
  /** Alíquota nominal em %, como "13.50". */
  rate: string;
  deductionCents: number;
}

export interface SimplesAnnex {
  annex: SimplesAnnexId;
  title: string;
  brackets: SimplesBracket[];
}

export const SIMPLES_ANNEXES: readonly SimplesAnnex[] = data.annexes as SimplesAnnex[];
export const SIMPLES_ANNEXES_SOURCE = { act: data.act, url: data.url, validFrom: data.validFrom };

/** "13.50" → 1350 (centésimos de ponto percentual), sem ponto flutuante. */
const hundredths = (rate: string) => {
  const [whole = '0', fraction = ''] = rate.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2));
};

export interface SimplesEffectiveRate {
  /** Alíquota efetiva em %, com 2 casas, como "9.97". */
  rate: string;
  bracket: number;
  nominal: string;
  deductionCents: number;
}

/**
 * Alíquota efetiva do Simples (LC 123/2006, art. 18, § 1º-A): (RBT12 × alíquota nominal − valor a
 * deduzir) ÷ RBT12, com 2 casas e meio para cima. Sem receita nos 12 meses (empresa começando),
 * vale a primeira faixa, em que a efetiva é a própria nominal. Acima do teto do anexo, null.
 */
export function simplesEffectiveRate(
  annex: SimplesAnnexId,
  rbt12Cents: number,
): SimplesEffectiveRate | null {
  const table = SIMPLES_ANNEXES.find((a) => a.annex === annex);
  if (!table) return null;
  const revenue = Math.max(0, Math.round(rbt12Cents));
  const row = table.brackets.find((b) => revenue <= b.upToCents);
  if (!row) return null;
  const nominal = BigInt(hundredths(row.rate));
  let effective = nominal;
  if (revenue > 0) {
    const r = BigInt(revenue);
    const numerator = r * nominal - BigInt(row.deductionCents) * 100n * 100n;
    effective = (2n * numerator + r) / (2n * r);
  }
  const value = Number(effective);
  return {
    rate: `${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`,
    bracket: row.bracket,
    nominal: row.rate,
    deductionCents: row.deductionCents,
  };
}
