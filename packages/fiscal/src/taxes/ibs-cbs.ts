import { dec, fromCents, percent, round, toCents, type Dec, type RoundingMode } from '../decimal';
import type { TraceStep } from '../engine';
import { classTribStatus, findClassTrib, findCstIbsCbs } from '../tables/class-trib';
import { REFERENCE_RATES, type ReferenceRate } from '../tables/rates';
import { ibsCbsBaseRules, type BaseTax } from '../tables/transition';
import { isValidOn } from '../validity';
import { assertBase, money, step, TaxRuleDataError, UnsupportedTaxSituationError } from './shared';

/**
 * IBS e CBS (Reforma Tributária). A classificação tributária (cClassTrib) vem da tabela oficial e
 * já diz o CST e a redução de alíquota; as alíquotas vêm de uma tabela com vigência; e o que
 * entra ou sai da base, por período, vem das regras de transição. Nada disso é fixo aqui.
 */

/** Falta a alíquota de um período: o cálculo para, com a explicação, em vez de supor um número. */
export class MissingRateError extends Error {
  constructor(
    readonly tax: 'IBS' | 'CBS',
    readonly sphere: ReferenceRate['sphere'],
    readonly date: string,
  ) {
    const which = tax === 'CBS' ? 'da CBS' : `${sphere} do IBS`;
    super(
      `A alíquota ${which} para ${date.slice(0, 4)} ainda não está na tabela do Bipaê. ` +
        'Se ela já foi publicada, atualize a tabela de alíquotas; enquanto isso o cálculo fica bloqueado.',
    );
  }
}

export interface IbsCbsInput {
  /** Código de Classificação Tributária do item (6 dígitos). */
  cClassTrib: string;
  /** Data do fato gerador (AAAA-MM-DD). */
  date: string;
  /**
   * Valor da operação do item em centavos, como vai na nota: produto + frete + seguro + outras
   * despesas − desconto incondicional. Já contém os tributos "por dentro" (ICMS, ISS, PIS e
   * COFINS) e não contém o IPI nem o Imposto Seletivo.
   */
  operationCents: number;
  /** Valor, em centavos, dos outros tributos do item que ajustam a base no período. */
  taxes?: Partial<Record<BaseTax, number>>;
  /** Tabela de alíquotas com vigência. Padrão: as alíquotas de referência oficiais do motor. */
  rates?: readonly ReferenceRate[];
  /** Arredondamento do valor de cada tributo (dúvida D-008): vem da configuração. */
  rounding?: RoundingMode;
}

export interface IbsCbsPart {
  /** Alíquota do ente, em percentual, com quatro casas ("0.1000"). */
  rate: string;
  /** Redução da alíquota dada pela classificação tributária, em percentual. */
  reduction: string;
  /** Alíquota depois da redução. */
  effectiveRate: string;
  amountCents: number;
  /** Norma de onde saiu a alíquota. */
  source: string;
}

export interface IbsCbsResult {
  cst: string;
  cClassTrib: string;
  /** false = a situação não tem IBS/CBS a calcular (isenção, imunidade...): não há grupo de valores. */
  taxed: boolean;
  baseCents: number;
  ibsState: IbsCbsPart | null;
  ibsMunicipal: IbsCbsPart | null;
  cbs: IbsCbsPart | null;
  /** IBS total: parte estadual + parte municipal. */
  ibsAmountCents: number;
  cbsAmountCents: number;
  trace: TraceStep[];
}

const p4 = (value: Dec) => `${value.toFixed(4)}%`;

export function calculateIbsCbs(input: IbsCbsInput): IbsCbsResult {
  assertBase(input.operationCents, 'Valor da operação');
  const item = findClassTrib(input.cClassTrib);
  if (!item)
    throw new TaxRuleDataError(
      'IBS/CBS',
      input.cClassTrib,
      'cClassTrib não existe na tabela oficial',
    );
  const status = classTribStatus(item, input.date);
  if (status === 'fora-da-vigencia') {
    throw new TaxRuleDataError(
      'IBS/CBS',
      item.cClassTrib,
      `classificação fora da vigência em ${input.date}`,
    );
  }
  const cst = findCstIbsCbs(item.cst)!;
  const trace: TraceStep[] = [
    step(`CST ${cst.cst}`, cst.description),
    step(`cClassTrib ${item.cClassTrib}`, item.name),
  ];
  const result: IbsCbsResult = {
    cst: cst.cst,
    cClassTrib: item.cClassTrib,
    taxed: false,
    baseCents: 0,
    ibsState: null,
    ibsMunicipal: null,
    cbs: null,
    ibsAmountCents: 0,
    cbsAmountCents: 0,
    trace,
  };

  // A tabela oficial diz quais grupos de valores cada CST exige. Sem grupo nenhum (isenção,
  // imunidade, documento específico), não há o que calcular. O motor calcula o grupo comum do
  // IBS/CBS por alíquota padrão, com ou sem redução; o resto ainda não está disponível.
  const g = cst.groups;
  const special = g.mono || g.creditTransfer || g.presumedCreditZfm || g.accrualAdjustment;
  if (!g.ibsCbs && !special) {
    trace.push(step('Sem IBS e CBS a calcular nesta situação', money(0)));
    return result;
  }
  if (!g.ibsCbs || special || g.deferral || g.baseReducer || item.rateType !== 'Padrão') {
    throw new UnsupportedTaxSituationError('IBS/CBS', `${item.cClassTrib} (CST ${cst.cst})`);
  }

  // ---------------------------------------------------------------- base de cálculo
  let base = fromCents(input.operationCents);
  trace.push(step('Valor da operação', money(input.operationCents)));
  for (const rule of ibsCbsBaseRules(input.date)) {
    const cents = input.taxes?.[rule.tax] ?? 0;
    assertBase(cents, `Valor de ${rule.tax}`);
    if (cents === 0) continue;
    const before = money(toCents(base));
    base = rule.effect === 'exclude' ? base.minus(fromCents(cents)) : base.plus(fromCents(cents));
    if (base.isNegative())
      throw new Error('Os tributos a tirar da base somam mais que o valor da operação');
    trace.push(
      step(
        rule.effect === 'exclude'
          ? `${rule.tax} fora da base (${rule.source})`
          : `${rule.tax} somado à base (${rule.source})`,
        money(toCents(base)),
        `${before} ${rule.effect === 'exclude' ? '−' : '+'} ${money(cents)}`,
      ),
    );
  }
  result.baseCents = toCents(base);
  result.taxed = true;

  // ---------------------------------------------------------------- alíquotas e valores
  const rates = input.rates ?? REFERENCE_RATES;
  const mode = input.rounding ?? 'half-up';
  const part = (
    tax: 'IBS' | 'CBS',
    sphere: ReferenceRate['sphere'],
    label: string,
    reduction: string,
  ): IbsCbsPart => {
    const matches = rates.filter(
      (r) => r.tax === tax && r.sphere === sphere && isValidOn(r.validity, input.date),
    );
    if (matches.length === 0) throw new MissingRateError(tax, sphere, input.date);
    if (matches.length > 1) {
      throw new TaxRuleDataError(
        tax,
        matches.map((m) => m.id).join(', '),
        'mais de uma alíquota em vigor para o mesmo ente',
      );
    }
    const rate = dec(matches[0]!.rate);
    const cut = dec(reduction);
    // NT 2025.002, UB: a alíquota efetiva (pAliqEfet) tem 4 casas, arredondada na última (D-008).
    const effective = round(rate.mul(dec(1).minus(percent(cut))), 4);
    const amountCents = toCents(base.mul(percent(effective)), mode);
    if (cut.isZero()) {
      trace.push(
        step(
          `${label} a ${p4(rate)}`,
          money(amountCents),
          `${money(result.baseCents)} × ${p4(rate)}`,
        ),
      );
    } else {
      trace.push(
        step(
          `${label} a ${p4(rate)} com redução de ${cut.toFixed(2)}%`,
          money(amountCents),
          `${money(result.baseCents)} × ${p4(rate)} × (1 − ${cut.toFixed(2)}%)`,
        ),
      );
    }
    return {
      rate: rate.toFixed(4),
      reduction: cut.toFixed(2),
      effectiveRate: effective.toFixed(4),
      amountCents,
      source: matches[0]!.source,
    };
  };
  result.ibsState = part('IBS', 'estadual', 'IBS estadual', item.pRedIBS);
  result.ibsMunicipal = part('IBS', 'municipal', 'IBS municipal', item.pRedIBS);
  result.cbs = part('CBS', 'federal', 'CBS', item.pRedCBS);
  result.ibsAmountCents = result.ibsState.amountCents + result.ibsMunicipal.amountCents;
  result.cbsAmountCents = result.cbs.amountCents;
  return result;
}
