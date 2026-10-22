import { dec } from '../decimal';
import { findCfop, isCfopValidOn } from '../tables/cfop';
import { EfdError, type EfdItem } from './read';

/**
 * Nota de compra na EFD ICMS/IPI (F4-14.b.2, dúvida D-039). O C170 vai "sob o enfoque do
 * declarante" (Guia Prático 3.2.2, registro C170, campo 10): o CFOP é o de entrada, e o CST e o
 * crédito dependem da finalidade da compra, que a empresa informa. Aqui ficam só regras, como
 * dados com a fonte; `purchaseLines` apenas as aplica.
 */

/** Finalidade da compra, escolhida pela empresa ao importar a nota. */
export const EFD_PURCHASE_PURPOSES = [
  'resale',
  'industrialization',
  'consumption',
  'fixed_asset',
] as const;
export type EfdPurchasePurpose = (typeof EFD_PURCHASE_PURPOSES)[number];

interface EntryRule {
  /** Três últimos dígitos do CFOP de entrada: sem e com substituição tributária. */
  cfop: { normal: string; st: string };
  /** Tipo do item no 0200 (Guia, registro 0200, campo 07). */
  itemType: string;
  /**
   * Desde quando a entrada dá crédito do ICMS destacado; null quando o crédito não vai no C170
   * (ativo imobilizado: 1/48 por mês pelo CIAP, no bloco G).
   */
  creditFrom: string | null;
  source: string;
}

/**
 * CFOP pelos títulos oficiais (tabela de CFOP do Convênio s/n de 1970): 1102 "Compra para
 * comercialização", 1403 "... sujeita ao regime de substituição tributária", 1101 e 1401
 * (industrialização), 1556 e 1407 (uso ou consumo), 1551 e 1406 (ativo imobilizado).
 * Crédito: LC 87/1996, art. 20 (entradas em geral), art. 20, § 5º (ativo, em 48 parcelas) e
 * art. 33, I, na redação da LC 171/2019 (uso e consumo só a partir de 01/01/2033).
 */
export const EFD_ENTRY_RULES: Readonly<Record<EfdPurchasePurpose, EntryRule>> = {
  resale: {
    cfop: { normal: '102', st: '403' },
    itemType: '00',
    creditFrom: '1996-11-01',
    source: 'LC 87/1996, art. 20',
  },
  industrialization: {
    cfop: { normal: '101', st: '401' },
    itemType: '01',
    creditFrom: '1996-11-01',
    source: 'LC 87/1996, art. 20',
  },
  consumption: {
    cfop: { normal: '556', st: '407' },
    itemType: '07',
    creditFrom: '2033-01-01',
    source: 'LC 87/1996, art. 33, I (redação da LC 171/2019)',
  },
  fixed_asset: {
    cfop: { normal: '551', st: '406' },
    itemType: '08',
    creditFrom: null,
    source: 'LC 87/1996, art. 20, § 5º (CIAP)',
  },
};

/** Primeiro dígito do CFOP: a saída do fornecedor (5, 6, 7) vira a entrada (1, 2, 3). */
const ENTRY_SCOPE: Readonly<Record<string, string>> = { '5': '1', '6': '2', '7': '3' };

/**
 * Item que já veio com o ICMS da substituição tributária: CST 10, 30, 60 e 70 da Tabela B e
 * CSOSN 201, 202, 203 e 500 (Ajuste SINIEF 03/2010 e Convênio s/n de 1970).
 */
const ST_CSTS = new Set(['10', '30', '60', '70', '201', '202', '203', '500']);

/** CST do declarante quando a mercadoria já veio com ST (Guia, C170, exemplo 2: "60"). */
const CST_ST = '60';
/** CST do declarante sem crédito (Guia, C170, exemplo 1, uso e consumo: "90"). */
const CST_WITHOUT_CREDIT = '90';

export interface PurchaseLine {
  item: EfdItem;
  cfop: string;
  /** Origem + CST da Tabela B, sob o enfoque da empresa. */
  cst: string;
  icmsBaseCents: number;
  icmsRate: string;
  icmsCents: number;
  stBaseCents: number;
  stRate: string;
  stCents: number;
  itemType: string;
}

export interface PurchaseContext {
  purpose: EfdPurchasePurpose;
  /** Data da entrada (AAAA-MM-DD): decide a regra de crédito que vale. */
  enteredOn: string;
  /** A empresa é do Simples: não se credita do ICMS (LC 123/2006, art. 23, caput). */
  declarantSimples: boolean;
}

/** Linhas do C170 de uma nota de compra, com CFOP, CST e crédito sob o enfoque da empresa. */
export function purchaseLines(items: EfdItem[], context: PurchaseContext): PurchaseLine[] {
  const rule = EFD_ENTRY_RULES[context.purpose];
  return items.map((item) => {
    const scope = ENTRY_SCOPE[item.cfop.charAt(0)];
    if (!scope) {
      throw new EfdError(`Item ${item.line} da compra com CFOP ${item.cfop}, que não é de saída.`);
    }
    const st = ST_CSTS.has(item.supplierCst) || item.stCents > 0;
    const cfop = scope + (st ? rule.cfop.st : rule.cfop.normal);
    const known = findCfop(cfop);
    if (!known || !isCfopValidOn(known, context.enteredOn)) {
      throw new EfdError(
        `Não há CFOP de entrada ${cfop} para o item ${item.line} da compra. Confira a finalidade da nota.`,
      );
    }
    const credit =
      !st &&
      !context.declarantSimples &&
      rule.creditFrom !== null &&
      context.enteredOn >= rule.creditFrom;
    const simplesSupplier = item.supplierCst.length === 3;
    // Fornecedor do Simples: crédito só no valor do pCredSN, na compra para comercialização ou
    // industrialização (LC 123/2006, art. 23, §§ 1º e 2º).
    const simplesCredit =
      credit &&
      simplesSupplier &&
      item.simplesCreditCents > 0 &&
      (context.purpose === 'resale' || context.purpose === 'industrialization');
    const ownCredit = credit && !simplesSupplier && item.icmsCents > 0;
    const goods =
      item.productCents +
      item.freightCents +
      item.insuranceCents +
      item.otherCents -
      item.discountCents;
    let cst: string;
    if (st) cst = CST_ST;
    else if (ownCredit) cst = item.supplierCst;
    else cst = CST_WITHOUT_CREDIT;
    return {
      item,
      cfop,
      cst: item.origin + cst,
      icmsBaseCents: ownCredit ? item.icmsBaseCents : simplesCredit ? goods : 0,
      icmsRate: ownCredit
        ? item.icmsRate
        : simplesCredit
          ? dec(item.simplesCreditRate ?? '0').toFixed(2)
          : '0',
      icmsCents: ownCredit ? item.icmsCents : simplesCredit ? item.simplesCreditCents : 0,
      stBaseCents: item.stBaseCents,
      stRate: item.stRate ?? '0',
      stCents: item.stCents,
      itemType: rule.itemType,
    };
  });
}
