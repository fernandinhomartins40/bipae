import { COMPANY_REGIMES, type CompanyRegime } from './regimes';
import { calculateSaleItemTaxes, type SaleFiscalProfile } from './sale';
import { ICMS_GENERAL_RATES, type UfRateStatus } from './tables/icms-uf';

/**
 * Matriz de cobertura fiscal (F3-23): para cada UF e cada regime, o motor consegue calcular uma
 * venda comum de revenda? É a mesma conta do teste das 135 combinações, exposta para o painel
 * da equipe Bipaê acompanhar o que ainda falta.
 */
const REVENDA_PADRAO: SaleFiscalProfile = {
  cfopInterna: '5102',
  cfopInterestadual: '6102',
  csosn: '102',
  cstIcms: '00',
  cstPisCofins: '01',
  cClassTrib: '000001',
};

export interface CoverageCell {
  regime: CompanyRegime;
  complete: boolean;
  /** O que falta, em português (vazio quando completo). */
  pending: string[];
}

export interface CoverageRow {
  uf: string;
  rateStatus: UfRateStatus;
  rate: string | null;
  law: string;
  cells: CoverageCell[];
}

export function coverageMatrix(date: string): { rows: CoverageRow[]; complete: number; total: number } {
  const rows = ICMS_GENERAL_RATES.map((uf) => ({
    uf: uf.uf,
    rateStatus: uf.status,
    rate: uf.rate ?? null,
    law: uf.law,
    cells: COMPANY_REGIMES.map((regime) => {
      const taxes = calculateSaleItemTaxes({
        company: { uf: uf.uf, regime: regime.id },
        profile: REVENDA_PADRAO,
        item: { operationCents: 10_000 },
        date,
      });
      return { regime: regime.id, complete: taxes.complete, pending: taxes.pending };
    }),
  }));
  const cells = rows.flatMap((row) => row.cells);
  return { rows, complete: cells.filter((cell) => cell.complete).length, total: cells.length };
}
