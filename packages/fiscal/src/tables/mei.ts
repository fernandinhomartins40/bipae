import data from './data/mei-rules.json';

/**
 * Regras da nota do MEI (CRT 4), transcritas da NT 2024.001 v1.20 com o número de cada regra de
 * validação (ver `source`). Fora delas a SEFAZ rejeita a nota (rejeições 782 e 337): o Bipaê
 * confere antes, com a explicação em português.
 */
export const MEI_RULES = data;

export interface MeiItemCheck {
  model: '55' | '65';
  csosn: string | null | undefined;
  cfop: string;
  /** Nota de devolução (finNFe = 4). */
  isReturn?: boolean;
  /** Operação com o exterior (idDest = 3): as regras do MEI não se aplicam. */
  exterior?: boolean;
}

/** O problema do item na nota do MEI, ou null se está dentro das regras. */
export function meiItemProblem(check: MeiItemCheck): string | null {
  if (check.exterior) return null;
  const allowedCsosn: string[] = MEI_RULES.csosn[check.model];
  if (!check.csosn || !allowedCsosn.includes(check.csosn)) {
    return `O MEI só usa o CSOSN ${allowedCsosn.join(', ')} na ${check.model === '65' ? 'NFC-e' : 'NF-e'} (está ${check.csosn ?? 'sem CSOSN'}).`;
  }
  if (check.model === '65') {
    return MEI_RULES.cfop65.includes(check.cfop)
      ? null
      : `Na NFC-e o MEI só usa o CFOP 5102 (está ${check.cfop}).`;
  }
  if (check.isReturn && !MEI_RULES.cfopReturn.includes(check.cfop)) {
    return `Na devolução o MEI só usa os CFOP ${MEI_RULES.cfopReturn.join(', ')} (está ${check.cfop}).`;
  }
  const byCsosn = MEI_RULES.cfopByCsosn55 as Record<string, string[]>;
  const allowedCfop = byCsosn[check.csosn];
  if (allowedCfop && !allowedCfop.includes(check.cfop)) {
    return `Com o CSOSN ${check.csosn}, o MEI só usa os CFOP ${allowedCfop.join(', ')} (está ${check.cfop}).`;
  }
  return null;
}
