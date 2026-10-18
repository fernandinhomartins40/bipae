import data from './data/nfse-services.json';

/**
 * Lista nacional de serviços da NFS-e (F5-13.a), gerada do Anexo B oficial do Sistema Nacional
 * NFS-e: o código de tributação nacional (cTribNac, 6 dígitos: item, subitem e desdobro da lista
 * da LC 116/2003) e a descrição. Origem e data em TABLE_SOURCES.nfseAnexoB.
 */
export interface NfseService {
  /** cTribNac: 6 dígitos (ex.: 140101). */
  code: string;
  /** Item da lista (2 dígitos) e subitem (II.SS). */
  item: string;
  subitem: string;
  description: string;
  /**
   * Onde o ISSQN incide (Anexo I, LC 116/2003, art. 3º): no estabelecimento do prestador, no local
   * da prestação ou no estabelecimento do tomador.
   */
  incidence: 'prestador' | 'prestacao' | 'tomador' | null;
  /** Grupo que a DPS exige para o serviço: obra (construção civil) ou atvEvento (eventos). */
  requiredGroup: 'obra' | 'atvEvento' | null;
}

export const NFSE_SERVICES = data.codes as readonly NfseService[];
const groups = data.groups as Record<string, string>;
const byCode = new Map(NFSE_SERVICES.map((s) => [s.code, s]));

export function findNfseService(code: string): NfseService | null {
  return byCode.get(code.replace(/\D/g, '').padStart(6, '0')) ?? null;
}

/** Descrição do item ("14") ou do subitem ("14.01") da lista. */
export function nfseServiceGroup(key: string): string | null {
  return groups[key] ?? null;
}

const fold = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Busca por código (com ou sem pontos) ou por palavras da descrição. */
export function searchNfseServices(query: string, limit = 20): NfseService[] {
  const digits = query.replace(/\D/g, '');
  const words = fold(query)
    .split(/\s+/)
    .filter((w) => w.length > 1 && !/^\d+$/.test(w));
  // Código: "14.01" ou "1401" acham o subitem; o zero da frente é opcional ("10101" = 010101).
  const prefixes = digits.length >= 2 ? [digits, `0${digits}`] : [];
  return NFSE_SERVICES.filter(
    (s) =>
      prefixes.some((p) => s.code.startsWith(p)) ||
      (words.length > 0 && words.every((w) => fold(s.description).includes(w))),
  ).slice(0, limit);
}
