import { ICMS_GENERAL_RATES, type IcmsGeneralRate } from '../src/tables/icms-uf';

/**
 * Apoio dos testes: desde 16/10/2026 as 27 UFs têm a alíquota geral do ICMS confirmada em fonte
 * oficial (dúvida D-021). Para o caminho "falta configurar" continuar testado, o teste marca uma
 * UF como pendente só enquanto `fn` roda, e devolve a linha como estava.
 */
export function withPendingUf<T>(uf: string, fn: () => T): T {
  const row = ICMS_GENERAL_RATES.find((r) => r.uf === uf) as IcmsGeneralRate | undefined;
  if (!row) throw new Error(`UF desconhecida: ${uf}`);
  const saved = { ...row };
  row.status = 'pendente';
  delete row.rate;
  row.note = `Marcada como pendente pelo teste (D-021).`;
  try {
    return fn();
  } finally {
    for (const key of Object.keys(row) as (keyof IcmsGeneralRate)[]) delete row[key];
    Object.assign(row, saved);
  }
}
