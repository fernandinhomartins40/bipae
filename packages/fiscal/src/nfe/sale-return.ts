import type { ContributionResult } from '../taxes/contributions';
import type { IbsCbsPart, IbsCbsResult } from '../taxes/ibs-cbs';
import type { IcmsResult } from '../taxes/icms';
import { findCfop } from '../tables/cfop';
import { nonContributorCfop } from './draft';
import { decimalTextToCents } from '../purchase/read';
import { find, findAll, parseXml, type XmlElement } from '../xml-reader';

/**
 * Devolução de venda (F3-33.h, dúvida D-037): a loja emite a NF-e de entrada da mercadoria que o
 * cliente devolveu, espelhando os impostos da nota original na proporção devolvida.
 *
 * Fontes oficiais:
 * - IBS e CBS: a base e a alíquota são as da operação original (LC 214/2025, art. 12, § 7º, e
 *   art. 17); o fornecedor no regime regular apropria o crédito (art. 47, § 8º).
 * - ICMS: "aplicar-se-ão a mesma base de cálculo e a mesma alíquota constantes no documento fiscal
 *   que acobertou a operação original"; na devolução parcial, "os valores deverão ser proporcionais
 *   aos da Nota Fiscal de origem" (RICMS-SP, art. 452, e Resposta à Consulta 30429/2024, que citam
 *   o Convênio SINIEF s/n de 1970, art. 54, § 3º).
 *
 * O que o leitor ainda não espelha (partilha do DIFAL, IPI) vira pendência com o motivo.
 */

export interface SaleReturnPick {
  /** Número do item na nota original (nItem). */
  item: number;
  /** Quanto volta, em milésimos. */
  quantityMilli: number;
}

/** Item da devolução, pronto para o rascunho da NF-e (impostos já espelhados). */
export interface SaleReturnItem {
  reference: { key: string; item: number };
  code: string;
  gtin: string | null;
  description: string;
  ncm: string;
  cest: string | null;
  unit: string;
  quantityMilli: number;
  unitPriceCents: number;
  grossCents: number;
  discountCents: number;
  /** Frete, seguro e outras despesas da venda, na mesma proporção (estão na base do imposto). */
  freightCents: number;
  insuranceCents: number;
  otherCents: number;
  origin: string;
  /** CFOP de devolução tirado da tabela oficial; null quando a tabela não decide sozinha. */
  cfop: string | null;
  originalCfop: string;
  icms: IcmsResult;
  pis: ContributionResult | null;
  cofins: ContributionResult | null;
  ibsCbs: IbsCbsResult | null;
}

export interface SaleReturnRead {
  key: string;
  /** Destinatário da nota original (quem devolve), quando ela tinha um. */
  recipient: { taxId: string; name: string } | null;
  issuedAt: string;
  items: SaleReturnItem[];
  pending: string[];
}

const text = (node: XmlElement | null | undefined, path: string) => find(node, path)?.text.trim();
const cents = (node: XmlElement | null | undefined, path: string) =>
  decimalTextToCents(text(node, path));
const milli = (value: string | undefined) => Math.round(Number(value ?? '0') * 1000);

/** Parte proporcional, em centavos inteiros, arredondada meio para cima (ADR-0008). */
export function proportional(valueCents: number, part: number, whole: number): number {
  if (whole <= 0) return 0;
  if (part >= whole) return valueCents;
  const scaled = BigInt(valueCents) * BigInt(part) * 2n + BigInt(whole);
  return Number(scaled / (2n * BigInt(whole)));
}

/**
 * CFOP de devolução pela tabela oficial: o código do mesmo grupo (1 ou 2) cujo título "Devolução
 * de venda de…" mais coincide com o da venda. Empate ou nada parecido: null, e a pessoa escolhe.
 */
export function returnCfop(saleCfop: string): string | null {
  const sale = findCfop(saleCfop);
  if (!sale || !/^[56]/.test(saleCfop) || !/^Venda de /i.test(sale.title)) return null;
  // Venda a não contribuinte (6.107, 6.108): a tabela não tem devolução própria; vale a da venda
  // comum que corresponde a ela (6.101, 6.102), pela mesma relação usada na emissão.
  if (sale.title.endsWith(', destinada a não contribuinte.')) {
    for (let n = 0; n < 100; n++) {
      const base = `${saleCfop.slice(0, 2)}${String(n).padStart(2, '0')}`;
      if (base !== saleCfop && nonContributorCfop(base) === saleCfop) return returnCfop(base);
    }
    return null;
  }
  const wanted = sale.title.replace(/^Venda de /i, '').toLowerCase();
  const group = saleCfop[0] === '5' ? '1' : '2';
  let best: { code: string; score: number } | null = null;
  let tie = false;
  for (let n = 0; n < 1000; n++) {
    const code = `${group}${String(n).padStart(3, '0')}`;
    const candidate = findCfop(code);
    if (!candidate || !/^Devolução de venda de /i.test(candidate.title)) continue;
    const have = candidate.title.replace(/^Devolução de venda de /i, '').toLowerCase();
    let score = 0;
    while (score < wanted.length && score < have.length && wanted[score] === have[score]) score++;
    if (!best || score > best.score) {
      best = { code, score };
      tie = false;
    } else if (score === best.score) tie = true;
  }
  // Ao menos "produção do estabelecimento" ou "mercadoria adquirida ou recebida de terceiros".
  return best && !tie && best.score >= 20 ? best.code : null;
}

function icmsOf(det: XmlElement, part: number, whole: number): IcmsResult | string {
  const icms = find(det, 'imposto/ICMS');
  const groupNode = icms?.children[0];
  if (!groupNode) return 'a nota original não tem o grupo do ICMS';
  const g = groupNode;
  const p = (v: number) => proportional(v, part, whole);
  const rate = text(g, 'pICMS') ?? null;
  const st = find(g, 'vBCST')
    ? {
        mva: text(g, 'pMVAST') ?? null,
        modBc: (text(g, 'modBCST') === '5' ? '5' : '4') as '4' | '5',
        baseReduction: text(g, 'pRedBCST') ?? null,
        baseCents: p(cents(g, 'vBCST')),
        rate: text(g, 'pICMSST') ?? '0',
        amountCents: p(cents(g, 'vICMSST')),
      }
    : null;
  return {
    cst: text(g, 'CST') ?? null,
    csosn: text(g, 'CSOSN') ?? null,
    group: g.name,
    baseCents: p(cents(g, 'vBC')),
    rate,
    baseReduction: text(g, 'pRedBC') ?? null,
    amountCents: p(cents(g, 'vICMS')),
    deferral: find(g, 'pDif')
      ? {
          rate: text(g, 'pDif')!,
          operationAmountCents: p(cents(g, 'vICMSOp')),
          deferredAmountCents: p(cents(g, 'vICMSDif')),
        }
      : null,
    fcp: find(g, 'pFCP') ? { rate: text(g, 'pFCP')!, amountCents: p(cents(g, 'vFCP')) } : null,
    st,
    credit: find(g, 'pCredSN')
      ? { rate: text(g, 'pCredSN')!, amountCents: p(cents(g, 'vCredICMSSN')) }
      : null,
    trace: [],
  };
}

function contributionOf(
  det: XmlElement,
  tax: 'PIS' | 'COFINS',
  part: number,
  whole: number,
): ContributionResult | null {
  const g = find(det, `imposto/${tax}`)?.children[0];
  if (!g) return null;
  const quantity = text(g, 'qBCProd');
  return {
    tax: tax.toLowerCase() as ContributionResult['tax'],
    cst: text(g, 'CST') ?? '',
    group: g.name,
    baseCents: proportional(cents(g, 'vBC'), part, whole),
    rate: text(g, `p${tax}`) ?? null,
    quantity: quantity ? ((milli(quantity) * (part / whole)) / 1000).toFixed(4) : null,
    amountPerUnit: text(g, 'vAliqProd') ?? null,
    amountCents: proportional(cents(g, `v${tax}`), part, whole),
    trace: [],
  };
}

function ibsCbsOf(det: XmlElement, part: number, whole: number): IbsCbsResult | null {
  const g = find(det, 'imposto/IBSCBS');
  if (!g) return null;
  const values = find(g, 'gIBSCBS');
  const piece = (tag: 'IBSUF' | 'IBSMun' | 'CBS'): IbsCbsPart | null => {
    const node = find(values, `g${tag}`);
    if (!node) return null;
    const rate = text(node, `p${tag}`) ?? '0';
    return {
      rate,
      reduction: text(node, 'gRed/pRedAliq') ?? '0',
      effectiveRate: text(node, 'gRed/pAliqEfet') ?? rate,
      amountCents: proportional(cents(node, `v${tag}`), part, whole),
      source: 'Nota de venda original (LC 214/2025, art. 17)',
    };
  };
  const ibsState = values ? piece('IBSUF') : null;
  const ibsMunicipal = values ? piece('IBSMun') : null;
  const cbs = values ? piece('CBS') : null;
  return {
    cst: text(g, 'CST') ?? '',
    cClassTrib: text(g, 'cClassTrib') ?? '',
    taxed: Boolean(values),
    baseCents: values ? proportional(cents(values, 'vBC'), part, whole) : 0,
    ibsState,
    ibsMunicipal,
    cbs,
    ibsAmountCents: (ibsState?.amountCents ?? 0) + (ibsMunicipal?.amountCents ?? 0),
    cbsAmountCents: cbs?.amountCents ?? 0,
    trace: [],
  };
}

/** Lê a nota de venda (NF-e ou NFC-e, com ou sem o nfeProc) e espelha os itens devolvidos. */
export function readSaleForReturn(xml: string, picks: SaleReturnPick[]): SaleReturnRead {
  const root = parseXml(xml);
  const nfe = root.name === 'nfeProc' ? find(root, 'NFe') : root;
  const inf = find(nfe, 'infNFe');
  if (!inf) throw new Error('O arquivo não é uma NF-e nem uma NFC-e.');
  const key = (inf.attrs.Id ?? '').replace(/^NFe/, '');
  const pending: string[] = [];
  if (text(inf, 'ide/tpNF') !== '1') pending.push('A nota original não é de saída (venda).');
  const dets = findAll(inf, 'det');
  const items: SaleReturnItem[] = [];
  for (const pick of picks) {
    const det = dets.find((d) => d.attrs.nItem === String(pick.item));
    if (!det) {
      pending.push(`O item ${pick.item} não existe na nota original.`);
      continue;
    }
    const prod = find(det, 'prod');
    const label = `Item ${pick.item} (${text(prod, 'xProd') ?? ''})`;
    const whole = milli(text(prod, 'qCom'));
    if (pick.quantityMilli <= 0 || pick.quantityMilli > whole) {
      pending.push(`${label}: a quantidade devolvida passa da quantidade vendida.`);
      continue;
    }
    if (find(det, 'imposto/ICMSUFDest')) {
      pending.push(
        `${label}: a venda teve partilha do ICMS (DIFAL), que a devolução automática ainda não espelha. Emita esta devolução com quem cuida dos seus impostos.`,
      );
      continue;
    }
    if (find(det, 'imposto/IPI/IPITrib')) {
      pending.push(`${label}: a venda teve IPI, que a devolução automática ainda não espelha.`);
      continue;
    }
    const icms = icmsOf(det, pick.quantityMilli, whole);
    if (typeof icms === 'string') {
      pending.push(`${label}: ${icms}.`);
      continue;
    }
    const originalCfop = text(prod, 'CFOP') ?? '';
    const cfop = returnCfop(originalCfop);
    if (!cfop) {
      pending.push(
        `${label}: a tabela oficial não define sozinha o CFOP de devolução para a venda com CFOP ${originalCfop}. Escolha o CFOP no item.`,
      );
    }
    const ean = text(prod, 'cEAN');
    items.push({
      reference: { key, item: pick.item },
      code: text(prod, 'cProd') ?? '',
      gtin: ean && ean !== 'SEM GTIN' ? ean : null,
      description: text(prod, 'xProd') ?? '',
      ncm: text(prod, 'NCM') ?? '',
      cest: text(prod, 'CEST') ?? null,
      unit: text(prod, 'uCom') ?? 'UN',
      quantityMilli: pick.quantityMilli,
      unitPriceCents: cents(prod, 'vUnCom'),
      grossCents: proportional(cents(prod, 'vProd'), pick.quantityMilli, whole),
      discountCents: proportional(cents(prod, 'vDesc'), pick.quantityMilli, whole),
      freightCents: proportional(cents(prod, 'vFrete'), pick.quantityMilli, whole),
      insuranceCents: proportional(cents(prod, 'vSeg'), pick.quantityMilli, whole),
      otherCents: proportional(cents(prod, 'vOutro'), pick.quantityMilli, whole),
      origin: text(find(det, 'imposto/ICMS')?.children[0], 'orig') ?? '0',
      cfop,
      originalCfop,
      icms,
      pis: contributionOf(det, 'PIS', pick.quantityMilli, whole),
      cofins: contributionOf(det, 'COFINS', pick.quantityMilli, whole),
      ibsCbs: ibsCbsOf(det, pick.quantityMilli, whole),
    });
  }
  const dest = find(inf, 'dest');
  const taxId = text(dest, 'CPF') ?? text(dest, 'CNPJ') ?? '';
  return {
    key,
    recipient: taxId ? { taxId, name: text(dest, 'xNome') ?? '' } : null,
    issuedAt: text(inf, 'ide/dhEmi') ?? '',
    items,
    pending,
  };
}
