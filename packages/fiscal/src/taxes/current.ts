import { selectRule, type Rule, type RuleContext } from '../rules';
import { calculateContribution, type ContributionEffect, type ContributionResult } from './contributions';
import { calculateIcms, type IcmsEffect, type IcmsResult } from './icms';
import { calculateIpi, type IpiEffect, type IpiResult } from './ipi';

/** As tabelas de regras dos tributos atuais de uma empresa (ICMS, PIS, COFINS e IPI). */
export interface CurrentTaxRules {
  icms: readonly Rule<IcmsEffect>[];
  pis: readonly Rule<ContributionEffect>[];
  cofins: readonly Rule<ContributionEffect>[];
  ipi: readonly Rule<IpiEffect>[];
}

export interface CurrentTaxItem {
  /** Valor da operação do item em centavos: produto + frete + seguro + outras − desconto. */
  baseCents: number;
  /** Quantidade vendida, para tributo cobrado por unidade. */
  quantity?: string;
}

/** O resultado de um tributo, com a regra que o produziu e a norma que a justifica. */
export type Applied<Result> = Result & { ruleId: string; source: string };

export interface CurrentTaxes {
  /** null = nenhuma regra do tributo se aplica à operação. */
  icms: Applied<IcmsResult> | null;
  pis: Applied<ContributionResult> | null;
  cofins: Applied<ContributionResult> | null;
  ipi: Applied<IpiResult> | null;
}

/**
 * Calcula os tributos atuais de um item: escolhe a regra de cada um em vigor na data do fato
 * gerador e aplica, na ordem em que um depende do outro (o IPI pode entrar na base do ICMS e da
 * ST; o ICMS pode sair da base do PIS e da COFINS).
 */
export function calculateCurrentTaxes(rules: CurrentTaxRules, ctx: RuleContext, item: CurrentTaxItem): CurrentTaxes {
  const withRule = <E, R extends { trace: { label: string; value: string }[] }>(
    rule: Rule<E> | null,
    run: (effect: E) => R,
  ): Applied<R> | null => {
    if (!rule) return null;
    const result = run(rule.effect);
    return {
      ...result,
      trace: [{ label: `Regra ${rule.id}`, value: rule.source }, ...result.trace],
      ruleId: rule.id,
      source: rule.source,
    };
  };

  const ipi = withRule(selectRule(rules.ipi, 'IPI', ctx), (effect) => calculateIpi(effect, { baseCents: item.baseCents }));
  const icms = withRule(selectRule(rules.icms, 'ICMS', ctx), (effect) =>
    calculateIcms(effect, { baseCents: item.baseCents, ipiCents: ipi?.amountCents ?? 0 }),
  );
  const contribution = (tax: 'PIS' | 'COFINS', table: readonly Rule<ContributionEffect>[]) =>
    withRule(selectRule(table, tax, ctx), (effect) =>
      calculateContribution(tax, effect, {
        baseCents: item.baseCents,
        icmsCents: icms?.amountCents ?? 0,
        ...(item.quantity !== undefined && { quantity: item.quantity }),
      }),
    );
  return { icms, pis: contribution('PIS', rules.pis), cofins: contribution('COFINS', rules.cofins), ipi };
}
