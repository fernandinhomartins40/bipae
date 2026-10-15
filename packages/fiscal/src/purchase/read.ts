import { dec, toCents, type Dec } from '../decimal';
import { descendant, find, findAll, parseXml, textOf, type XmlElement } from '../xml-reader';

/**
 * XML de compra (F3-19): a NF-e que o fornecedor emitiu para a empresa. Lê o que a entrada de
 * mercadoria precisa (fornecedor, itens, valores e tributos de cada item) sem confiar em número
 * de ponto flutuante: dinheiro em centavos, quantidade como texto decimal.
 */
export class PurchaseXmlError extends Error {}

export interface PurchaseParty {
  cnpj?: string;
  cpf?: string;
  name: string;
  tradeName?: string;
  ie?: string;
  address?: {
    street: string;
    number: string;
    complement?: string;
    district: string;
    cityCode: string;
    cityName: string;
    uf: string;
    cep?: string;
    phone?: string;
  };
}

export interface PurchaseItem {
  line: number;
  /** Código do produto no fornecedor (cProd). */
  supplierCode: string;
  /** GTIN comercial, quando o fornecedor informou um válido. */
  gtin?: string;
  description: string;
  ncm: string;
  cest?: string;
  cfop: string;
  unit: string;
  /** Quantidade comercial como veio no XML ("12.0000"). */
  quantity: string;
  unitPrice: string;
  totalCents: number;
  discountCents: number;
  freightCents: number;
  insuranceCents: number;
  otherCents: number;
  /** ICMS retido por substituição tributária e FCP-ST: somam ao custo. */
  stCents: number;
  ipiCents: number;
  /**
   * Lotes do item (grupo `rastro`, até 500): número, quantidade como veio no XML, fabricação e
   * validade. Ausente quando o fornecedor não informou.
   */
  lots?: PurchaseLot[];
  /** Tributos destacados, guardados para a apuração de créditos (F4-13). */
  taxes: {
    icms?: { cst: string; baseCents: number; rate?: string; amountCents: number };
    pisCents: number;
    cofinsCents: number;
    ibsCbs?: { cst: string; cClassTrib: string; ibsCents: number; cbsCents: number };
  };
}

export interface PurchaseLot {
  /** nLote */
  code: string;
  /** qLote, como veio no XML ("12.000"). */
  quantity: string;
  /** dFab (AAAA-MM-DD) */
  manufacturedOn: string;
  /** dVal (AAAA-MM-DD) */
  expiresOn: string;
}

export interface PurchaseNfe {
  accessKey: string;
  model: '55';
  number: number;
  series: number;
  issuedAt: string;
  /** Ambiente em que a nota foi emitida: 1 produção, 2 homologação. */
  environment: 'producao' | 'homologacao';
  supplier: PurchaseParty;
  recipient: PurchaseParty;
  items: PurchaseItem[];
  totalCents: number;
  /** Protocolo de autorização, quando o arquivo é o XML autorizado (nfeProc). */
  protocol?: { number: string; receivedAt: string; cStat: string };
}

/** "12.34" → 1234, sem ponto flutuante. */
export function decimalTextToCents(value: string | undefined): number {
  if (value === undefined || value === '') return 0;
  if (!/^-?\d+(\.\d+)?$/.test(value)) throw new PurchaseXmlError(`Valor inválido no XML: ${value}`);
  return toCents(dec(value));
}

const cents = (node: XmlElement | null, path: string) => decimalTextToCents(textOf(node, path));

function party(node: XmlElement | null, addressTag: string): PurchaseParty {
  if (!node) throw new PurchaseXmlError('O XML não traz o emitente ou o destinatário.');
  const a = find(node, addressTag);
  const text = (path: string) => textOf(node, path) || undefined;
  return {
    ...(text('CNPJ') && { cnpj: text('CNPJ') }),
    ...(text('CPF') && { cpf: text('CPF') }),
    name: textOf(node, 'xNome') ?? '',
    ...(text('xFant') && { tradeName: text('xFant') }),
    ...(text('IE') && { ie: text('IE') }),
    ...(a && {
      address: {
        street: textOf(a, 'xLgr') ?? '',
        number: textOf(a, 'nro') ?? '',
        ...(textOf(a, 'xCpl') && { complement: textOf(a, 'xCpl') }),
        district: textOf(a, 'xBairro') ?? '',
        cityCode: textOf(a, 'cMun') ?? '',
        cityName: textOf(a, 'xMun') ?? '',
        uf: textOf(a, 'UF') ?? '',
        ...(textOf(a, 'CEP') && { cep: textOf(a, 'CEP') }),
        ...(textOf(a, 'fone') && { phone: textOf(a, 'fone') }),
      },
    }),
  };
}

const GTIN = /^(\d{8}|\d{12,14})$/;

function item(det: XmlElement): PurchaseItem {
  const prod = find(det, 'prod');
  const imposto = find(det, 'imposto');
  const need = (path: string) => {
    const value = textOf(prod, path);
    if (!value) throw new PurchaseXmlError(`Item ${det.attrs.nItem ?? '?'} sem ${path}.`);
    return value;
  };
  const icms = find(imposto, 'ICMS')?.children[0] ?? null;
  const ipi = find(imposto, 'IPI/IPITrib');
  const pis = find(imposto, 'PIS')?.children[0] ?? null;
  const cofins = find(imposto, 'COFINS')?.children[0] ?? null;
  const ibsCbs = find(imposto, 'IBSCBS');
  const gtin = textOf(prod, 'cEAN');
  const lots = findAll(prod, 'rastro').map((r) => ({
    code: textOf(r, 'nLote') ?? '',
    quantity: textOf(r, 'qLote') ?? '0',
    manufacturedOn: textOf(r, 'dFab') ?? '',
    expiresOn: textOf(r, 'dVal') ?? '',
  }));
  const icmsCst = textOf(icms, 'CST') ?? textOf(icms, 'CSOSN');
  return {
    line: Number(det.attrs.nItem ?? 0),
    supplierCode: need('cProd'),
    ...(gtin && GTIN.test(gtin) && { gtin }),
    description: need('xProd'),
    ncm: need('NCM'),
    ...(textOf(prod, 'CEST') && { cest: textOf(prod, 'CEST') }),
    cfop: need('CFOP'),
    unit: need('uCom'),
    quantity: need('qCom'),
    unitPrice: need('vUnCom'),
    totalCents: cents(prod, 'vProd'),
    discountCents: cents(prod, 'vDesc'),
    freightCents: cents(prod, 'vFrete'),
    insuranceCents: cents(prod, 'vSeg'),
    otherCents: cents(prod, 'vOutro'),
    stCents: cents(icms, 'vICMSST') + cents(icms, 'vFCPST'),
    ipiCents: cents(ipi, 'vIPI'),
    ...(lots.length > 0 && { lots }),
    taxes: {
      ...(icms &&
        icmsCst && {
          icms: {
            cst: (textOf(icms, 'orig') ?? '') + icmsCst,
            baseCents: cents(icms, 'vBC'),
            ...(textOf(icms, 'pICMS') && { rate: textOf(icms, 'pICMS') }),
            amountCents: cents(icms, 'vICMS'),
          },
        }),
      pisCents: cents(pis, 'vPIS'),
      cofinsCents: cents(cofins, 'vCOFINS'),
      ...(ibsCbs && {
        ibsCbs: {
          cst: textOf(ibsCbs, 'CST') ?? '',
          cClassTrib: textOf(ibsCbs, 'cClassTrib') ?? '',
          ibsCents: cents(ibsCbs, 'gIBSCBS/vIBS'),
          cbsCents: cents(ibsCbs, 'gIBSCBS/gCBS/vCBS'),
        },
      }),
    },
  };
}

export function readPurchaseNfe(xml: string): PurchaseNfe {
  let root: XmlElement;
  try {
    root = parseXml(xml);
  } catch {
    throw new PurchaseXmlError('O arquivo não é um XML válido.');
  }
  const nfe = root.name === 'nfeProc' ? find(root, 'NFe') : root.name === 'NFe' ? root : null;
  const inf = find(nfe, 'infNFe');
  if (!inf) throw new PurchaseXmlError('O arquivo não é o XML de uma NF-e.');
  const ide = find(inf, 'ide');
  if (textOf(ide, 'mod') !== '55') {
    throw new PurchaseXmlError('Só a NF-e (modelo 55) dá entrada de compra; cupom e NFC-e não.');
  }
  const accessKey = (inf.attrs.Id ?? '').replace(/^NFe/, '');
  if (!/^[0-9A-Z]{44}$/.test(accessKey))
    throw new PurchaseXmlError('Chave de acesso inválida no XML.');
  const infProt = root.name === 'nfeProc' ? descendant(find(root, 'protNFe'), 'infProt') : null;
  const items = findAll(inf, 'det').map(item);
  if (items.length === 0) throw new PurchaseXmlError('A nota não tem itens.');
  return {
    accessKey,
    model: '55',
    number: Number(textOf(ide, 'nNF')),
    series: Number(textOf(ide, 'serie')),
    issuedAt: textOf(ide, 'dhEmi') ?? textOf(ide, 'dEmi') ?? '',
    environment: textOf(ide, 'tpAmb') === '1' ? 'producao' : 'homologacao',
    supplier: party(find(inf, 'emit'), 'enderEmit'),
    recipient: party(find(inf, 'dest'), 'enderDest'),
    items,
    totalCents: cents(inf, 'total/ICMSTot/vNF'),
    ...(infProt &&
      textOf(infProt, 'nProt') && {
        protocol: {
          number: textOf(infProt, 'nProt')!,
          receivedAt: textOf(infProt, 'dhRecbto') ?? '',
          cStat: textOf(infProt, 'cStat') ?? '',
        },
      }),
  };
}

/**
 * Quantidade que entra no estoque, em milésimos: a quantidade comercial vezes o fator de
 * conversão (uma caixa com 12 unidades tem fator 12).
 */
export function purchaseStockMilli(item: PurchaseItem, factor: string | number = 1): number {
  const total = dec(item.quantity).mul(dec(factor)).mul(1000);
  if (total.lte(0)) throw new PurchaseXmlError(`Quantidade inválida no item ${item.line}.`);
  return total.toDecimalPlaces(0).toNumber();
}

/**
 * Quantidade de um lote em unidades de estoque (milésimos). O leiaute não diz a unidade do
 * `qLote`; o Bipaê usa a unidade comercial do item, com o mesmo fator do estoque (dúvida D-028).
 */
export function purchaseLotMilli(lot: PurchaseLot, factor: string | number = 1): number {
  const total = dec(lot.quantity).mul(dec(factor)).mul(1000);
  return total.lte(0) ? 0 : total.toDecimalPlaces(0).toNumber();
}

/**
 * Custo de aquisição de cada unidade de estoque, em centavos: produto menos desconto, mais frete,
 * seguro, outras despesas, ICMS-ST e IPI, dividido pela quantidade em unidades de estoque. Os
 * créditos de ICMS, PIS, COFINS, IBS e CBS não são abatidos aqui (dúvida D-024).
 */
export function purchaseUnitCostCents(item: PurchaseItem, factor: string | number = 1): number {
  const total: Dec = dec(
    item.totalCents -
      item.discountCents +
      item.freightCents +
      item.insuranceCents +
      item.otherCents +
      item.stCents +
      item.ipiCents,
  ).div(100);
  const units = dec(item.quantity).mul(dec(factor));
  if (units.lte(0)) throw new PurchaseXmlError(`Quantidade inválida no item ${item.line}.`);
  return toCents(total.div(units));
}
