import { dec, fromCents, percent, round, toCents, type Dec, type RoundingMode } from '../decimal';
import type { TraceStep } from '../engine';
import { findTaxSituation } from '../tables/tax-situations';
import {
  assertBase,
  money,
  pct,
  step,
  TaxRuleDataError,
  UnsupportedTaxSituationError,
} from './shared';

/**
 * ICMS dos regimes atuais: regime normal (CST) e Simples Nacional (CSOSN), com substituição
 * tributária básica (MVA). O que cada situação tributária calcula está na tabela ICMS_PARTS; as
 * alíquotas, reduções e MVA vêm da regra, por vigência (ADR-0006).
 */
export interface IcmsEffect {
  /** CST (regime normal) ou CSOSN (Simples Nacional): exatamente um dos dois. */
  cst?: string;
  csosn?: string;
  /**
   * Alíquota do ICMS próprio, em percentual. No Simples Nacional com ST ela não é destacada: só
   * serve para abater do ICMS-ST o imposto que seria devido na operação própria.
   */
  rate?: string;
  /** Redução da base de cálculo, em percentual (CST 20 e 70). */
  baseReduction?: string;
  /** Percentual do imposto que fica diferido (CST 51). */
  deferral?: string;
  /** Alíquota do Fundo de Combate à Pobreza sobre a base do ICMS próprio. */
  fcpRate?: string;
  /** O IPI entra na base do ICMS próprio? Depende da operação; vem da regra, nunca suposto. */
  includeIpiInBase?: boolean;
  /**
   * Substituição tributária: margem de valor agregado e alíquota interna do destino. Com a base
   * pela pauta (`IcmsInput.stPautaCents`), a MVA não é usada e pode faltar.
   */
  st?: { mva?: string; rate: string; baseReduction?: string };
  /** Alíquota de crédito do Simples Nacional (pCredSN), CSOSN 101 e 201. */
  creditRate?: string;
  rounding?: RoundingMode;
}

export interface IcmsInput {
  /** Valor da operação em centavos: produto + frete + seguro + outras despesas − desconto. */
  baseCents: number;
  /** Valor do IPI do item, quando houver: entra na base da ST. */
  ipiCents?: number;
  /**
   * Base da ST pela pauta (F3-26.f): o valor em reais publicado pela UF para a marca e a
   * embalagem, já multiplicado pela quantidade. Quando vem, substitui valor × (1 + MVA).
   */
  stPautaCents?: number;
}

export interface IcmsResult {
  cst: string | null;
  csosn: string | null;
  /** Grupo do XML da nota em que os valores entram ("ICMS00", "ICMSSN102"...). */
  group: string;
  /** Base de cálculo do ICMS próprio (0 quando não há destaque). */
  baseCents: number;
  rate: string | null;
  baseReduction: string | null;
  /** ICMS próprio devido e destacado. */
  amountCents: number;
  /** CST 51: imposto da operação, parte diferida e percentual do diferimento. */
  deferral: { rate: string; operationAmountCents: number; deferredAmountCents: number } | null;
  fcp: { rate: string; amountCents: number } | null;
  st: {
    /** MVA usada; null quando a base é a pauta. */
    mva: string | null;
    /** Modalidade da base da ST na nota (modBCST): 4 = MVA, 5 = pauta. */
    modBc: '4' | '5';
    /** Redução da base da ST, quando a regra traz uma (pRedBCST). */
    baseReduction: string | null;
    baseCents: number;
    rate: string;
    amountCents: number;
  } | null;
  /** Crédito que o Simples Nacional permite ao comprador aproveitar. */
  credit: { rate: string; amountCents: number } | null;
  trace: TraceStep[];
}

// O que cada situação tributária envolve. Situação fora da tabela ainda não é calculada.
interface IcmsParts {
  own?: true;
  reduction?: true;
  deferral?: true;
  st?: true;
  credit?: true;
}

const CST_PARTS: Record<string, IcmsParts> = {
  '00': { own: true },
  '10': { own: true, st: true },
  '20': { own: true, reduction: true },
  '40': {},
  '41': {},
  '50': {},
  '51': { own: true, deferral: true },
  '60': {},
  '70': { own: true, reduction: true, st: true },
};

const CSOSN_PARTS: Record<string, IcmsParts> = {
  '101': { credit: true },
  '102': {},
  '103': {},
  '201': { credit: true, st: true },
  '202': { st: true },
  '203': { st: true },
  '300': {},
  '400': {},
  '500': {},
};

function percentage(value: string, what: string, code: string, max = 100): Dec {
  const parsed = dec(value);
  if (parsed.isNegative() || parsed.greaterThan(max)) {
    throw new TaxRuleDataError('ICMS', code, `${what} fora de 0 a ${max}%: ${value}`);
  }
  return parsed;
}

export function calculateIcms(effect: IcmsEffect, input: IcmsInput): IcmsResult {
  assertBase(input.baseCents);
  const ipiCents = input.ipiCents ?? 0;
  assertBase(ipiCents, 'Valor do IPI');
  if ((effect.cst === undefined) === (effect.csosn === undefined)) {
    throw new TaxRuleDataError('ICMS', 'sem código', 'informe CST ou CSOSN, e só um dos dois');
  }
  const simples = effect.csosn !== undefined;
  const code = (effect.csosn ?? effect.cst)!;
  const situation = findTaxSituation(simples ? 'csosn' : 'icms', code);
  const parts = (simples ? CSOSN_PARTS : CST_PARTS)[code];
  if (!situation) throw new TaxRuleDataError('ICMS', code, 'código não existe na tabela oficial');
  if (!parts) throw new UnsupportedTaxSituationError('ICMS', code);

  const need = (value: string | undefined, what: string): string => {
    if (value === undefined) throw new TaxRuleDataError('ICMS', code, `falta ${what}`);
    return value;
  };
  const mode = effect.rounding ?? 'half-up';
  const trace: TraceStep[] = [
    step(`${simples ? 'CSOSN' : 'CST'} ${code}`, situation.description),
    step('Valor da operação', money(input.baseCents)),
  ];

  // ---------------------------------------------------------------- ICMS próprio
  let ownBase = fromCents(input.baseCents);
  if (effect.includeIpiInBase && ipiCents > 0) {
    ownBase = ownBase.plus(fromCents(ipiCents));
    trace.push(
      step(
        'IPI somado à base',
        money(toCents(ownBase)),
        `${money(input.baseCents)} + ${money(ipiCents)}`,
      ),
    );
  }
  let baseReduction: Dec | null = null;
  if (parts.reduction) {
    baseReduction = percentage(
      need(effect.baseReduction, 'a redução da base de cálculo'),
      'redução',
      code,
    );
    const reduced = round(ownBase.mul(dec(1).minus(percent(baseReduction))), 2);
    trace.push(
      step(
        `Redução de ${pct(baseReduction)} na base`,
        money(toCents(reduced)),
        `${money(toCents(ownBase))} × (1 − ${pct(baseReduction)})`,
      ),
    );
    ownBase = reduced;
  }

  let rate: Dec | null = null;
  let amountCents = 0;
  let baseCents = 0;
  let deferral: IcmsResult['deferral'] = null;
  let fcp: IcmsResult['fcp'] = null;
  if (parts.own) {
    rate = percentage(need(effect.rate, 'a alíquota'), 'alíquota', code);
    baseCents = toCents(ownBase);
    amountCents = toCents(ownBase.mul(percent(rate)), mode);
    trace.push(
      step(`ICMS a ${pct(rate)}`, money(amountCents), `${money(baseCents)} × ${pct(rate)}`),
    );
    if (parts.deferral) {
      const share = percentage(
        need(effect.deferral, 'o percentual do diferimento'),
        'diferimento',
        code,
      );
      const deferred = toCents(fromCents(amountCents).mul(percent(share)), mode);
      deferral = {
        rate: share.toFixed(2),
        operationAmountCents: amountCents,
        deferredAmountCents: deferred,
      };
      trace.push(
        step(
          `Diferimento de ${pct(share)}`,
          money(deferred),
          `${money(amountCents)} × ${pct(share)}`,
        ),
      );
      amountCents -= deferred;
      trace.push(
        step(
          'ICMS devido',
          money(amountCents),
          `${money(deferral.operationAmountCents)} − ${money(deferred)}`,
        ),
      );
    }
    if (effect.fcpRate !== undefined) {
      const fcpRate = percentage(effect.fcpRate, 'FCP', code);
      const fcpAmount = toCents(ownBase.mul(percent(fcpRate)), mode);
      fcp = { rate: fcpRate.toFixed(2), amountCents: fcpAmount };
      trace.push(
        step(`FCP a ${pct(fcpRate)}`, money(fcpAmount), `${money(baseCents)} × ${pct(fcpRate)}`),
      );
    }
  } else if (!parts.st && !parts.credit) {
    trace.push(step('Sem ICMS a destacar nesta situação', money(0)));
  }

  // ---------------------------------------------------------------- substituição tributária
  let st: IcmsResult['st'] = null;
  if (parts.st) {
    const rule = effect.st;
    if (!rule)
      throw new TaxRuleDataError(
        'ICMS',
        code,
        'faltam os dados da substituição tributária (MVA e alíquota)',
      );
    const pauta = input.stPautaCents;
    if (pauta !== undefined && (!Number.isInteger(pauta) || pauta < 0)) {
      throw new TaxRuleDataError('ICMS', code, 'o valor da pauta da ST precisa ser em centavos');
    }
    const mva =
      pauta === undefined ? percentage(need(rule.mva, 'a MVA da ST'), 'MVA', code, 1000) : null;
    const stRate = percentage(rule.rate, 'alíquota da ST', code);
    // No Simples o ICMS próprio não é destacado, mas é abatido como se fosse devido.
    let ownForSt = amountCents;
    if (!parts.own) {
      const ownRate = percentage(
        need(effect.rate, 'a alíquota para abater do ICMS-ST'),
        'alíquota',
        code,
      );
      rate = ownRate;
      ownForSt = toCents(ownBase.mul(percent(ownRate)), mode);
      trace.push(
        step(
          `ICMS próprio a abater (${pct(ownRate)}, não destacado)`,
          money(ownForSt),
          `${money(toCents(ownBase))} × ${pct(ownRate)}`,
        ),
      );
    }
    const withIpi = fromCents(input.baseCents).plus(fromCents(ipiCents));
    let stBase: Dec;
    if (mva === null) {
      stBase = fromCents(pauta!);
      trace.push(step('Base da ST pela pauta da UF', money(pauta!), 'valor da pauta × quantidade'));
    } else {
      stBase = round(withIpi.mul(dec(1).plus(percent(mva))), 2);
      trace.push(
        step(
          `Base da ST com MVA de ${pct(mva)}`,
          money(toCents(stBase)),
          ipiCents > 0
            ? `(${money(input.baseCents)} + ${money(ipiCents)} de IPI) × (1 + ${pct(mva)})`
            : `${money(input.baseCents)} × (1 + ${pct(mva)})`,
        ),
      );
    }
    let stReduction: Dec | null = null;
    if (rule.baseReduction !== undefined) {
      stReduction = percentage(rule.baseReduction, 'redução da base da ST', code);
      const reduced = round(stBase.mul(dec(1).minus(percent(stReduction))), 2);
      trace.push(
        step(
          `Redução de ${pct(stReduction)} na base da ST`,
          money(toCents(reduced)),
          `${money(toCents(stBase))} × (1 − ${pct(stReduction)})`,
        ),
      );
      stBase = reduced;
    }
    const gross = toCents(stBase.mul(percent(stRate)), mode);
    const stAmount = Math.max(0, gross - ownForSt);
    st = {
      mva: mva === null ? null : mva.toFixed(2),
      modBc: mva === null ? '5' : '4',
      baseReduction: stReduction ? stReduction.toFixed(2) : null,
      baseCents: toCents(stBase),
      rate: stRate.toFixed(2),
      amountCents: stAmount,
    };
    trace.push(
      step(
        `ICMS-ST a ${pct(stRate)}`,
        money(stAmount),
        `${money(st.baseCents)} × ${pct(stRate)} − ${money(ownForSt)} de ICMS próprio`,
      ),
    );
  }

  // ---------------------------------------------------------------- crédito do Simples Nacional
  let credit: IcmsResult['credit'] = null;
  if (parts.credit) {
    const creditRate = percentage(
      need(effect.creditRate, 'a alíquota de crédito do Simples Nacional'),
      'crédito',
      code,
    );
    const creditAmount = toCents(fromCents(input.baseCents).mul(percent(creditRate)), mode);
    credit = { rate: creditRate.toFixed(2), amountCents: creditAmount };
    trace.push(
      step(
        `Crédito de ICMS permitido ao comprador (${pct(creditRate)})`,
        money(creditAmount),
        `${money(input.baseCents)} × ${pct(creditRate)}`,
      ),
    );
  }

  return {
    cst: effect.cst ?? null,
    csosn: effect.csosn ?? null,
    group: situation.groups[0]!,
    baseCents,
    rate: rate ? rate.toFixed(2) : null,
    baseReduction: baseReduction ? baseReduction.toFixed(2) : null,
    amountCents,
    deferral,
    fcp,
    st,
    credit,
    trace,
  };
}
