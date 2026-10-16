import data from './data/purchase-cost-credits.json';

/**
 * Tributos da compra que a empresa recupera como crédito e que, por isso, saem do custo do
 * estoque (dúvida D-024): RIR/2018, art. 301, § 3º, e NBC TG 16, item 11. O IPI e o ICMS-ST não
 * estão aqui: o varejista não os recupera, e eles ficam no custo.
 */
export type RecoverableTax = 'icms' | 'pis' | 'cofins';

export interface PurchaseCostCredits {
  regime: string;
  recoverable: RecoverableTax[];
  note: string;
}

export const PURCHASE_COST_CREDITS: readonly PurchaseCostCredits[] =
  data.regimes as PurchaseCostCredits[];

export const PURCHASE_COST_CREDITS_SOURCE: string = data.source;

/** Os tributos recuperáveis do regime; sem regime informado, nenhum (custo cheio). */
export function recoverableTaxes(regime: string | null | undefined): RecoverableTax[] {
  return PURCHASE_COST_CREDITS.find((r) => r.regime === regime)?.recoverable ?? [];
}
