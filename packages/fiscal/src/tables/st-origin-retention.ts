/**
 * Quem retém a ST na operação interestadual (F3-26.d.AP, dúvida D-059): protocolos entre UFs
 * dizem que, para certos CEST, o remetente NÃO retém o ICMS-ST nas operações destinadas à UF.
 * A nota chega sem ST e a UF de destino cobra do destinatário pela lista dela. Isto não altera
 * a tabela de ST da UF (`st-references`): só avisa que a retenção não vem na origem.
 *
 * Fonte: texto do CONFAZ guardado em sources/ (`confazPt11Ap`). O teste confere esta lista com
 * o texto do ato, código a código.
 */
export interface StOriginRetentionRule {
  /** UF de destino da mercadoria. */
  destUf: string;
  /** Primeiro dia em que vale (AAAA-MM-DD). */
  validFrom: string;
  act: string;
  url: string;
  note: string;
  /** CEST em que o remetente não retém, como faixas [primeiro, último] (um código tem os dois iguais). */
  cestRanges: readonly (readonly [string, string])[];
}

const one = (cest: string): readonly [string, string] => [cest, cest];

export const ST_ORIGIN_NO_RETENTION: readonly StOriginRetentionRule[] = [
  {
    destUf: 'AP',
    validFrom: '2026-03-01',
    act: 'Protocolo ICMS 11/2026 (Amapá e São Paulo), cláusula primeira (nova redação da cláusula primeira do Protocolo ICMS 114/2011); DOU de 24/02/2026, efeitos desde 01/03/2026',
    url: 'https://www.confaz.fazenda.gov.br/legislacao/protocolos/2026/pt011_26',
    note: 'Nas compras de outro estado com destino ao Amapá, o remetente não retém o ICMS-ST deste CEST: a nota chega sem ST e o Amapá cobra do destinatário. A lista do Anexo III do RICMS-AP não muda.',
    cestRanges: [
      one('17.001.02'),
      one('17.001.03'),
      one('17.002.02'),
      one('17.002.03'),
      one('17.003.01'),
      one('17.005.00'),
      one('17.005.01'),
      one('17.006.01'),
      one('17.010.00'),
      one('17.011.00'),
      ['17.016.01', '17.018.01'],
      one('17.019.01'),
      // O texto traz "17.019.03 17.020.01" sem vírgula: lido como dois códigos (D-059).
      one('17.019.03'),
      one('17.020.01'),
      one('17.021.01'),
      one('17.022.00'),
      ['17.023.01', '17.024.05'],
      one('17.025.01'),
      one('17.025.02'),
      one('17.027.01'),
      ['17.028.00', '17.033.01'],
      ['17.042.00', '17.046.16'],
      ['17.049.00', '17.049.07'],
      one('17.052.00'),
      one('17.053.01'),
      one('17.053.02'),
      one('17.054.01'),
      one('17.054.02'),
      one('17.062.02'),
      one('17.062.03'),
      one('17.064.00'),
      ['17.065.00', '17.074.00'],
      one('17.075.00'),
      one('17.079.08'),
      ['17.083.00', '17.087.02'],
      ['17.088.00', '17.115.00'],
      one('17.116.00'),
      one('17.117.00'),
    ],
  },
];

export interface StOriginRetention {
  /** Falso: o remetente de outra UF não retém a ST deste CEST. */
  withheldByOrigin: false;
  destUf: string;
  validFrom: string;
  act: string;
  url: string;
  note: string;
}

/** "1701602" ou "17.016.02" vira "17.016.02", para comparar com as faixas do ato. */
function cestKey(cest: string): string | null {
  const digits = cest.replace(/\D/g, '');
  if (digits.length !== 7) return null;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
}

/**
 * Em operação interestadual com destino a `destUf`, o remetente deixa de reter a ST deste CEST
 * na data? `null` quando nenhum ato lido diz isso (não significa que retém).
 */
export function stOriginRetentionFor(
  destUf: string,
  cest: string,
  date: string,
): StOriginRetention | null {
  const key = cestKey(cest);
  if (!key) return null;
  for (const rule of ST_ORIGIN_NO_RETENTION) {
    if (rule.destUf !== destUf.toUpperCase() || date < rule.validFrom) continue;
    if (!rule.cestRanges.some(([from, to]) => key >= from && key <= to)) continue;
    return {
      withheldByOrigin: false,
      destUf: rule.destUf,
      validFrom: rule.validFrom,
      act: rule.act,
      url: rule.url,
      note: rule.note,
    };
  }
  return null;
}
