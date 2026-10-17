import data from './data/st-references.json';

/**
 * Substituição tributária por UF (F3-26): a MVA (IVA-ST) que cada SEFAZ publica, por CEST e NCM,
 * gerada dos atos oficiais guardados em sources/. É referência para a regra de ICMS da empresa,
 * não regra do motor: a empresa confere o produto (a descrição do CEST tem exceções e limites de
 * embalagem) e confirma antes de usar.
 */
export interface StReferenceItem {
  item: string;
  cest: string;
  /** Posições de NCM do item (2 a 8 dígitos; o produto entra se o NCM dele começar por uma). */
  ncms: string[];
  ncmText: string;
  description: string;
  /** IVA-ST (MVA original) em percentual, como texto decimal ("72.41"). */
  mva: string;
}

export interface StReference {
  uf: string;
  segment: string;
  segmentName: string;
  act: string;
  source: string;
  url: string;
  validFrom: string;
  validTo: string | null;
  note: string;
  items: StReferenceItem[];
}

export const ST_REFERENCES: readonly StReference[] = data.references as StReference[];

/** UFs que já têm a tabela oficial de ST no Bipaê. */
export const ST_REFERENCE_UFS: readonly string[] = [...new Set(ST_REFERENCES.map((r) => r.uf))];

export interface StReferenceMatch extends StReferenceItem {
  uf: string;
  segmentName: string;
  act: string;
  url: string;
  validFrom: string;
  validTo: string | null;
  note: string;
}

/** Itens da tabela oficial da UF que valem para o NCM na data (o mais específico primeiro). */
export function stReferencesFor(uf: string, ncm: string, date: string): StReferenceMatch[] {
  const code = ncm.replace(/\D/g, '');
  const found: StReferenceMatch[] = [];
  for (const ref of ST_REFERENCES) {
    if (ref.uf !== uf.toUpperCase() || date < ref.validFrom) continue;
    if (ref.validTo && date > ref.validTo) continue;
    for (const item of ref.items) {
      if (!item.ncms.some((n) => code.startsWith(n))) continue;
      found.push({
        ...item,
        uf: ref.uf,
        segmentName: ref.segmentName,
        act: ref.act,
        url: ref.url,
        validFrom: ref.validFrom,
        validTo: ref.validTo,
        note: ref.note,
      });
    }
  }
  const depth = (m: StReferenceMatch) =>
    Math.max(...m.ncms.filter((n) => code.startsWith(n)).map((n) => n.length));
  return found.sort((a, b) => depth(b) - depth(a));
}
