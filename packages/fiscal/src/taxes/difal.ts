import { dec, fromCents, round, toCents, type RoundingMode } from '../decimal';
import type { TraceStep } from '../engine';
import { icmsGeneralRate, interstateRate } from '../tables/icms-uf';
import { findFcp } from '../tables/rates';
import { assertBase, money, pct, step, TaxRuleDataError } from './shared';

/**
 * Partilha do ICMS na venda interestadual para consumidor final não contribuinte (EC 87/2015,
 * grupo ICMSUFDest da NF-e). Desde 2019 a diferença entre a alíquota interna do destino e a
 * interestadual fica toda com a UF de destino (pICMSInterPart = 100, vICMSUFRemet = 0).
 *
 * - **Base única** (padrão): DIFAL = base × (alíquota interna do destino − interestadual).
 * - **Base dupla** ("por dentro"): a base do destino é refeita com a alíquota interna dele,
 *   (base − ICMS interestadual) ÷ (1 − alíquota interna), e o DIFAL é o ICMS do destino menos o
 *   interestadual. Qual UF exige qual forma é dúvida registrada (D-025): a empresa escolhe com o
 *   contador; o Bipaê não supõe.
 */
export type DifalBaseMode = 'unica' | 'dupla';

export interface DifalInput {
  ufOrigem: string;
  ufDestino: string;
  /** Valor da operação do item (com frete, seguro, outras despesas e IPI, sem desconto). */
  baseCents: number;
  imported?: boolean;
  /** Alíquota interna do destino para o produto; sem ela, usa a geral confirmada da UF. */
  destinationRate?: string;
  /**
   * FCP do destino para o produto (vem da regra do produto). O FCP só vale para os produtos que a
   * lei da UF lista; sem regra, não soma e o resultado avisa (assumption).
   */
  fcpRate?: string;
  baseMode?: DifalBaseMode;
  rounding?: RoundingMode;
}

export interface DifalResult {
  baseCents: number;
  fcpBaseCents: number;
  /** Percentuais com duas casas ("18.00"). */
  destinationRate: string;
  interstateRate: string;
  fcpRate: string;
  sharePercent: '100.00';
  fcpCents: number;
  destinationCents: number;
  originCents: 0;
  baseMode: DifalBaseMode;
  /** Aviso para mostrar junto do cálculo, quando o FCP ficou de fora por falta de regra. */
  assumption: string | null;
  trace: TraceStep[];
}

const two = (value: string) => dec(value).toFixed(2);

/** A partilha do item; erro (com mensagem para a pessoa) quando falta um dado da UF. */
export function calculateDifal(input: DifalInput): DifalResult {
  assertBase(input.baseCents);
  const mode = input.rounding ?? 'half-up';
  const baseMode = input.baseMode ?? 'unica';
  const inter = interstateRate(input.ufOrigem, input.ufDestino, {
    imported: input.imported ?? false,
  });

  let destination = input.destinationRate;
  if (destination === undefined) {
    const general = icmsGeneralRate(input.ufDestino);
    if (general?.status !== 'confirmado') {
      throw new TaxRuleDataError(
        'DIFAL',
        input.ufDestino,
        `a alíquota interna de ${input.ufDestino} ainda não foi confirmada em fonte oficial; informe a do produto com o contador`,
      );
    }
    destination = general.rate!;
  }

  let fcp = input.fcpRate;
  let assumption: string | null = null;
  if (fcp === undefined) {
    fcp = '0';
    const rates = findFcp(input.ufDestino)?.rates ?? [];
    if (rates.some((rate) => dec(rate).gt(0))) {
      assumption = `Sem FCP de ${input.ufDestino}: ele só vale para os produtos que a lei de lá lista. Se este produto estiver na lista, cadastre a regra com o contador.`;
    }
  }

  const destDec = dec(destination);
  const interDec = dec(inter.rate);
  const fcpDec = dec(fcp);
  if (destDec.lt(0) || destDec.gt(100) || fcpDec.lt(0) || fcpDec.gt(100)) {
    throw new TaxRuleDataError('DIFAL', input.ufDestino, 'alíquota fora de 0 a 100%');
  }

  const operation = fromCents(input.baseCents);
  const interstateTax = operation.mul(interDec).div(100);
  let baseCents: number;
  let destinationCents: number;
  const trace: TraceStep[] = [
    step('Alíquota interestadual', pct(interDec), inter.reason),
    step(`Alíquota interna de ${input.ufDestino}`, pct(destDec)),
  ];
  if (baseMode === 'unica') {
    baseCents = input.baseCents;
    const diff = destDec.minus(interDec);
    destinationCents = diff.gt(0) ? toCents(operation.mul(diff).div(100), mode) : 0;
    trace.push(
      step(
        'DIFAL (base única)',
        money(destinationCents),
        `${money(baseCents)} × (${pct(destDec)} − ${pct(interDec)})`,
      ),
    );
  } else {
    if (destDec.gte(100))
      throw new TaxRuleDataError('DIFAL', input.ufDestino, 'alíquota interna inválida');
    const base = round(operation.minus(interstateTax).div(dec(1).minus(destDec.div(100))), 2);
    baseCents = toCents(base, mode);
    const value = base.mul(destDec).div(100).minus(interstateTax);
    destinationCents = value.gt(0) ? toCents(value, mode) : 0;
    trace.push(
      step(
        'Base do destino (base dupla)',
        money(baseCents),
        `(${money(input.baseCents)} − ICMS interestadual) ÷ (1 − ${pct(destDec)})`,
      ),
      step(
        'DIFAL (base dupla)',
        money(destinationCents),
        `base × ${pct(destDec)} − ICMS interestadual`,
      ),
    );
  }
  const fcpCents = toCents(fromCents(baseCents).mul(fcpDec).div(100), mode);
  if (fcpDec.gt(0))
    trace.push(
      step(`FCP de ${input.ufDestino}`, money(fcpCents), `${money(baseCents)} × ${pct(fcpDec)}`),
    );

  return {
    baseCents,
    fcpBaseCents: fcpDec.gt(0) ? baseCents : 0,
    destinationRate: two(destination),
    interstateRate: two(inter.rate),
    fcpRate: two(fcp),
    sharePercent: '100.00',
    fcpCents,
    destinationCents,
    originCents: 0,
    baseMode,
    assumption,
    trace,
  };
}
