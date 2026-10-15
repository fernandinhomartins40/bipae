import { isValidOn, type Validity } from '../validity';
import type { CompanyRegime } from '../regimes';
import data from './data/ibs-cbs-settlement.json';

/**
 * Regras da apuração do IBS e da CBS (F4-13), por vigência e com a fonte de cada uma:
 * quem apura pelo regime regular, como o crédito é apropriado e o que muda em cada período
 * (em 2026, a fase de teste).
 */
export interface IbsCbsRegimeRule {
  regimes: CompanyRegime[];
  mode: 'regular' | 'simples';
  /** O optante pelo Simples pode escolher apurar o IBS e a CBS pelo regime regular. */
  regularOption?: boolean;
  source: string;
  url: string;
}

export interface IbsCbsPeriodRule {
  id: string;
  validity: Validity;
  paymentWaived: boolean;
  message: string;
  source: string;
  url: string;
}

export const IBS_CBS_REGIME_RULES = data.regimes as IbsCbsRegimeRule[];
export const IBS_CBS_CREDIT_RULE = data.credit;
export const IBS_CBS_PERIOD_RULES = data.periods as IbsCbsPeriodRule[];

export interface IbsCbsTotals {
  /** IBS e CBS destacados nas vendas do período. */
  salesIbsCents: number;
  salesCbsCents: number;
  /** Devoluções de venda no período (estornam o débito). */
  returnsIbsCents: number;
  returnsCbsCents: number;
  /** IBS e CBS destacados nas notas de compra do período. */
  purchasesIbsCents: number;
  purchasesCbsCents: number;
}

export interface IbsCbsBalance {
  debitCents: number;
  creditCents: number;
  /** Débito − crédito; negativo = sobra crédito. */
  balanceCents: number;
  payableCents: number;
  creditLeftCents: number;
}

export type IbsCbsSettlement =
  | { mode: 'falta-configurar'; message: string }
  | { mode: 'simples'; regime: IbsCbsRegimeRule; message: string }
  | {
      mode: 'regular';
      regime: IbsCbsRegimeRule;
      /** IBS e CBS apurados separadamente: crédito de um não paga o outro. */
      ibs: IbsCbsBalance;
      cbs: IbsCbsBalance;
      credit: typeof IBS_CBS_CREDIT_RULE;
      period: IbsCbsPeriodRule | null;
    };

function balance(debit: number, credit: number): IbsCbsBalance {
  const value = debit - credit;
  return {
    debitCents: debit,
    creditCents: credit,
    balanceCents: value,
    payableCents: Math.max(0, value),
    creditLeftCents: Math.max(0, -value),
  };
}

/**
 * Apuração gerencial do mês: débitos das vendas (menos devoluções) contra os créditos
 * destacados nas compras. `date` é o primeiro dia do período (AAAA-MM-DD).
 */
export function settleIbsCbs(input: {
  regime: CompanyRegime | null;
  /** O optante pelo Simples escolheu apurar pelo regime regular (art. 41, § 3º). */
  regularOption: boolean;
  date: string;
  totals: IbsCbsTotals;
}): IbsCbsSettlement {
  if (!input.regime) {
    return {
      mode: 'falta-configurar',
      message: 'Informe o regime tributário da empresa para apurar o IBS e a CBS.',
    };
  }
  const regime = IBS_CBS_REGIME_RULES.find((r) => r.regimes.includes(input.regime!));
  if (!regime) {
    return { mode: 'falta-configurar', message: 'Regime tributário sem regra de apuração.' };
  }
  if (regime.mode === 'simples' && !(regime.regularOption && input.regularOption)) {
    return {
      mode: 'simples',
      regime,
      message:
        'Pelo Simples Nacional, o IBS e a CBS são recolhidos no DAS, junto com os outros tributos. Se a empresa optou por apurá-los pelo regime regular, marque essa opção no cadastro da empresa.',
    };
  }
  const t = input.totals;
  return {
    mode: 'regular',
    regime,
    ibs: balance(t.salesIbsCents - t.returnsIbsCents, t.purchasesIbsCents),
    cbs: balance(t.salesCbsCents - t.returnsCbsCents, t.purchasesCbsCents),
    credit: IBS_CBS_CREDIT_RULE,
    period: IBS_CBS_PERIOD_RULES.find((p) => isValidOn(p.validity, input.date)) ?? null,
  };
}
