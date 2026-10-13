import codes from './data/nfe-codes.json';
import labels from './data/tax-situation-labels.json';

/**
 * Códigos de situação tributária dos tributos atuais e a origem da mercadoria.
 *
 * A lista de códigos e o grupo do XML em que cada um entra saem do schema oficial da NF-e
 * (TABLE_SOURCES.nfeSchema), que é o que a SEFAZ usa para validar. As descrições ficam numa
 * tabela revisada (data/tax-situation-labels.json), porque o texto do schema tem erros de
 * digitação e lacunas; um teste garante que as duas listas têm exatamente os mesmos códigos.
 */
export type TaxSituationKind = 'icms' | 'csosn' | 'pis' | 'cofins' | 'ipi';

export interface TaxSituation {
  code: string;
  description: string;
  /** Grupos do XML que aceitam o código (ex.: CST 40 → ["ICMS40"]; CST 10 → ["ICMS10", "ICMSPart"]). */
  groups: string[];
}

// PIS e COFINS dividem a mesma tabela de CST.
const LABELS: Record<TaxSituationKind, { source: string; labels: Record<string, string> }> = {
  icms: labels.icms,
  csosn: labels.csosn,
  pis: labels.pisCofins,
  cofins: labels.pisCofins,
  ipi: labels.ipi,
};

const build = (kind: TaxSituationKind): TaxSituation[] =>
  codes[kind].map((item) => ({
    code: item.code,
    description: LABELS[kind].labels[item.code] ?? '',
    groups: item.groups,
  }));

export const TAX_SITUATIONS: Readonly<Record<TaxSituationKind, readonly TaxSituation[]>> = {
  icms: build('icms'),
  csosn: build('csosn'),
  pis: build('pis'),
  cofins: build('cofins'),
  ipi: build('ipi'),
};

/** A norma que define a tabela de cada tipo de código. */
export const TAX_SITUATION_SOURCES: Readonly<Record<TaxSituationKind | 'orig', string>> = {
  icms: labels.icms.source,
  csosn: labels.csosn.source,
  pis: labels.pisCofins.source,
  cofins: labels.pisCofins.source,
  ipi: labels.ipi.source,
  orig: labels.orig.source,
};

/** O pacote de schemas de onde os códigos foram tirados. */
export const NFE_SCHEMA_PACKAGE: string = codes.package;

export function findTaxSituation(kind: TaxSituationKind, code: string): TaxSituation | null {
  return TAX_SITUATIONS[kind].find((item) => item.code === code) ?? null;
}

export interface MerchandiseOrigin {
  /** Código de 0 a 8 do campo `orig`. */
  code: string;
  description: string;
}

const originLabels: Record<string, string> = labels.orig.labels;

export const MERCHANDISE_ORIGINS: readonly MerchandiseOrigin[] = codes.orig.map((code) => ({
  code,
  description: originLabels[code] ?? '',
}));

export function findOrigin(code: string | number): MerchandiseOrigin | null {
  return MERCHANDISE_ORIGINS.find((item) => item.code === String(code)) ?? null;
}
