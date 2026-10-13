import { dec, format, fromCents, percent, round, toCents, type RoundingMode } from './decimal';
import { selectRule, type Rule, type RuleContext } from './rules';

/**
 * Cálculo genérico de um tributo "base × alíquota", com redução de base e explicação passo a
 * passo. Os tributos com regra própria (ICMS-ST, monofásico, IBS/CBS por ente...) entram nas
 * tarefas F3-04 e F3-05 usando estas mesmas peças.
 */

/** Efeito de uma regra de alíquota. Percentuais como texto, do jeito que estão na norma. */
export interface RateEffect {
  /** Alíquota em percentual ("18", "0.9"). */
  rate: string;
  /** Redução da base de cálculo em percentual ("33.33"). */
  baseReduction?: string;
  /** Código de situação tributária que acompanha a regra (CST, CSOSN...). */
  cst?: string;
  /** O valor do tributo soma no total do documento? (dúvida D-001: vem da tabela, por vigência) */
  includedInTotal?: boolean;
  /** Exigido pela SEFAZ nesta vigência ou só informativo (ex.: IBS/CBS em 2026). */
  requirement?: 'required' | 'informative';
  /** Arredondamento do valor do tributo (dúvida D-008); padrão meia para cima. */
  rounding?: RoundingMode;
}

/** Um passo da explicação: o que foi feito, com que conta, e quanto deu. */
export interface TraceStep {
  label: string;
  formula?: string;
  value: string;
}

export interface TaxResult {
  tax: string;
  ruleId: string;
  source: string;
  cst: string | null;
  /** Base de cálculo depois da redução, em centavos. */
  baseCents: number;
  /** Alíquota em percentual, como texto ("18.00"). */
  rate: string;
  amountCents: number;
  includedInTotal: boolean;
  requirement: 'required' | 'informative';
  /** Explicação do cálculo, na ordem em que aconteceu. */
  trace: TraceStep[];
}

const brl = (cents: number) => format(fromCents(cents), 2);

/** Aplica o efeito de uma regra de alíquota a uma base em centavos. */
export function applyRate(baseCents: number, effect: RateEffect): { baseCents: number; amountCents: number; trace: TraceStep[] } {
  if (!Number.isSafeInteger(baseCents) || baseCents < 0) {
    throw new Error(`Base de cálculo inválida: ${baseCents}`);
  }
  const rate = dec(effect.rate);
  if (rate.isNegative()) throw new Error(`Alíquota negativa: ${effect.rate}`);
  const trace: TraceStep[] = [{ label: 'Base de cálculo', value: brl(baseCents) }];

  let base = fromCents(baseCents);
  if (effect.baseReduction !== undefined) {
    const reduction = dec(effect.baseReduction);
    if (reduction.isNegative() || reduction.greaterThan(100)) {
      throw new Error(`Redução de base fora de 0 a 100%: ${effect.baseReduction}`);
    }
    const reduced = round(base.mul(dec(1).minus(percent(reduction))), 2);
    trace.push({
      label: `Redução de ${format(reduction, 2)}% na base`,
      formula: `${format(base, 2)} × (1 − ${format(reduction, 2)}%)`,
      value: format(reduced, 2),
    });
    base = reduced;
  }

  const amountCents = toCents(base.mul(percent(rate)), effect.rounding ?? 'half-up');
  trace.push({
    label: `Alíquota de ${format(rate, 2)}%`,
    formula: `${format(base, 2)} × ${format(rate, 2)}%`,
    value: brl(amountCents),
  });
  return { baseCents: toCents(base), amountCents, trace };
}

/**
 * Calcula um tributo para a operação: escolhe a regra em vigor na data do fato gerador e a
 * aplica. Devolve null quando não há regra (o tributo não se aplica àquela operação).
 */
export function calculateTax(
  rules: readonly Rule<RateEffect>[],
  tax: string,
  ctx: RuleContext,
  baseCents: number,
): TaxResult | null {
  const rule = selectRule(rules, tax, ctx);
  if (!rule) return null;
  const applied = applyRate(baseCents, rule.effect);
  return {
    tax,
    ruleId: rule.id,
    source: rule.source,
    cst: rule.effect.cst ?? null,
    baseCents: applied.baseCents,
    rate: format(dec(rule.effect.rate), 2),
    amountCents: applied.amountCents,
    includedInTotal: rule.effect.includedInTotal ?? true,
    requirement: rule.effect.requirement ?? 'required',
    trace: [
      { label: `Regra ${rule.id}`, value: rule.source },
      ...applied.trace,
    ],
  };
}
