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
  /**
   * NCM que o ato tira das posições acima ("3917, exceto 3917.32.21"): o produto cujo NCM começa
   * por um deles não entra no item.
   */
  exceptNcms?: string[];
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
      if (item.exceptNcms?.some((n) => code.startsWith(n))) continue;
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

/** Um anexo (segmento) de ST da UF, com os CEST e o que saiu da ST. */
export interface StSegment {
  annex: string;
  name: string;
  cests: {
    cest: string;
    /** NCM do CEST como a UF escreve, quando ela publica (senão vale o Convênio ICMS 142/18). */
    ncms?: string[];
    excludedFrom?: string | null;
    excludedBy?: string | null;
  }[];
  excludedFrom?: string;
  excludedBy?: string;
  /** Base de cálculo própria do segmento (ex.: pauta em reais por marca, nas bebidas de SP). */
  base?: StBase;
}

export interface StBase {
  kind: 'pauta';
  act: string;
  url: string;
  validFrom: string;
  validTo: string;
  note: string;
}

export interface StUfSegments {
  uf: string;
  act: string;
  source: string;
  url: string;
  annexes: StSegment[];
}

export const ST_SEGMENTS: readonly StUfSegments[] = (data as { segments: StUfSegments[] }).segments;

export interface StStatus {
  uf: string;
  annex: string;
  segmentName: string;
  cest: string;
  /** Está na ST na data? */
  inSt: boolean;
  /** Quando saiu da ST (o anexo inteiro ou só o item) e por qual ato. */
  excludedFrom: string | null;
  excludedBy: string | null;
  act: string;
  url: string;
  /** Base própria do segmento na data (só quando vale nela). */
  base: StBase | null;
}

/**
 * Situação do NCM na ST da UF, pelos CEST dos anexos que a SEFAZ publica (o NCM de cada CEST vem
 * do Convênio ICMS 142/18). Vazio quando a UF não tem a lista no Bipaê ou o NCM não aparece nela.
 */
export function stStatusFor(
  uf: string,
  ncm: string,
  date: string,
  cestNcms: (cest: string) => readonly string[],
): StStatus[] {
  const code = ncm.replace(/\D/g, '');
  const result: StStatus[] = [];
  for (const block of ST_SEGMENTS) {
    if (block.uf !== uf.toUpperCase()) continue;
    for (const annex of block.annexes) {
      for (const item of annex.cests) {
        if (!(item.ncms ?? cestNcms(item.cest)).some((n) => code.startsWith(n))) continue;
        const from = annex.excludedFrom ?? item.excludedFrom ?? null;
        const by = annex.excludedBy ?? item.excludedBy ?? null;
        result.push({
          uf: block.uf,
          annex: annex.annex,
          segmentName: annex.name,
          cest: item.cest,
          inSt: !from || date < from,
          excludedFrom: from,
          excludedBy: by,
          act: block.act,
          url: block.url,
          base:
            annex.base && date >= annex.base.validFrom && date <= annex.base.validTo
              ? annex.base
              : null,
        });
      }
    }
  }
  return result;
}

/** UFs que já têm a lista de mercadorias em ST no Bipaê. */
export const ST_SEGMENT_UFS: readonly string[] = ST_SEGMENTS.map((s) => s.uf);
