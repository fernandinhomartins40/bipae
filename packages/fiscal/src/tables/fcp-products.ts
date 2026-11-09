import data from './data/fcp-products.json';
import type { TABLE_SOURCES } from './sources';

/**
 * Produtos que pagam o adicional do fundo de combate à pobreza (FCP), como a lei de cada UF
 * lista (F3-34). Mantida à mão: cada descrição é copiada da lei guardada em `sources/` (acervo
 * ctresb/leis, com o link oficial no manifest), e o teste confere o texto. É **referência** para
 * cadastrar a regra de ICMS, como o Portal da DIFAL; não muda o cálculo sozinha.
 */
export interface FcpProductItem {
  description: string;
  /** Códigos NCM (2 a 8 dígitos) quando a lei os cita. */
  ncms?: string[];
  /** Quando o item tem percentual diferente do da UF. */
  rate?: string;
  note?: string;
}

export interface FcpProductsByUf {
  uf: string;
  fund: string;
  /** Pontos percentuais somados à alíquota do ICMS. */
  rate: string;
  /** Em que operações o adicional incide, nas palavras da lei resumidas. */
  appliesTo: string;
  /** Último dia de vigência quando a lei fixa um prazo (AAAA-MM-DD). */
  validUntil?: string;
  law: string;
  sources: (keyof typeof TABLE_SOURCES)[];
  /** "compilado"/"atualizado": texto com as alterações; "original": como foi publicado. */
  textVersion: 'compilado' | 'atualizado' | 'original';
  note?: string;
  items: FcpProductItem[];
}

export const FCP_PRODUCTS_CHECKED_AT: string = data.checkedAt;
export const FCP_PRODUCTS: readonly FcpProductsByUf[] = data.ufs as FcpProductsByUf[];

export function fcpProductsByLaw(uf: string): FcpProductsByUf | null {
  return FCP_PRODUCTS.find((item) => item.uf === uf) ?? null;
}
