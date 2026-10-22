import { decimalTextToCents } from '../purchase/read';
import { find, findAll, parseXml, textOf, type XmlElement } from '../xml-reader';

/**
 * Leitura da NF-e e da NFC-e autorizadas para a EFD ICMS/IPI (F4-14.b). O arquivo é montado a
 * partir do XML que a SEFAZ autorizou, porque é ele que o fisco cruza com a escrituração.
 * Dinheiro em centavos inteiros; alíquota como texto decimal, como está no XML.
 */
export class EfdError extends Error {}

export interface EfdParty {
  cnpj?: string;
  cpf?: string;
  foreignId?: string;
  name: string;
  ie?: string;
  countryCode: string;
  cityCode?: string;
  street?: string;
  number?: string;
  complement?: string;
  district?: string;
}

export interface EfdItem {
  line: number;
  cfop: string;
  /** Origem + CST (3 dígitos) no regime normal; origem + CSOSN (4 dígitos) no Simples (D-038). */
  cstIcms: string;
  /** pICMS como veio ("18.00"); "0" quando o grupo não tem alíquota. */
  icmsRate: string;
  productCents: number;
  discountCents: number;
  freightCents: number;
  insuranceCents: number;
  otherCents: number;
  icmsBaseCents: number;
  /** ICMS próprio mais o FCP (C190, campo 07). */
  icmsCents: number;
  stBaseCents: number;
  /** ICMS-ST mais o FCP-ST (C190, campo 09). */
  stCents: number;
  ipiCents: number;
}

export interface EfdDocument {
  model: '55' | '65';
  accessKey: string;
  series: number;
  number: number;
  /** Data de emissão (AAAA-MM-DD), no fuso de quem emitiu. */
  issuedOn: string;
  /** Data de saída ou de entrada (dhSaiEnt), quando a nota traz. */
  movedOn?: string;
  /** tpNF: 0 entrada, 1 saída. */
  direction: 'in' | 'out';
  /** finNFe: 1 normal, 2 complementar, 3 ajuste, 4 devolução. */
  purpose: string;
  issuerCnpj?: string;
  recipient?: EfdParty;
  /** Indicador de pagamento do C100 (0 à vista, 1 a prazo, 2 outros, 9 sem pagamento). */
  paymentIndicator: '0' | '1' | '2' | '9';
  /** modFrete, mesmo código do IND_FRT do C100 desde 2018. */
  freightMode: string;
  totalCents: number;
  productsCents: number;
  discountCents: number;
  freightCents: number;
  insuranceCents: number;
  otherCents: number;
  items: EfdItem[];
}

const cents = (node: XmlElement | null, path: string) => decimalTextToCents(textOf(node, path));

function readParty(dest: XmlElement | null): EfdParty | undefined {
  if (!dest) return undefined;
  const a = find(dest, 'enderDest');
  const text = (node: XmlElement | null, path: string) => textOf(node, path) || undefined;
  const party: EfdParty = {
    name: textOf(dest, 'xNome') ?? '',
    countryCode: text(a, 'cPais') ?? '1058',
  };
  const fields: [keyof EfdParty, string | undefined][] = [
    ['cnpj', text(dest, 'CNPJ')],
    ['cpf', text(dest, 'CPF')],
    ['foreignId', text(dest, 'idEstrangeiro')],
    ['ie', text(dest, 'IE')],
    ['cityCode', text(a, 'cMun')],
    ['street', text(a, 'xLgr')],
    ['number', text(a, 'nro')],
    ['complement', text(a, 'xCpl')],
    ['district', text(a, 'xBairro')],
  ];
  for (const [key, value] of fields) if (value) Object.assign(party, { [key]: value });
  if (!party.cnpj && !party.cpf && !party.foreignId) return undefined;
  return party;
}

function readItem(det: XmlElement): EfdItem {
  const prod = find(det, 'prod');
  const imposto = find(det, 'imposto');
  const icms = find(imposto, 'ICMS')?.children[0] ?? null;
  const cfop = textOf(prod, 'CFOP');
  const line = Number(det.attrs.nItem ?? 0);
  if (!cfop) throw new EfdError(`Item ${line} da nota sem CFOP.`);
  const cst = textOf(icms, 'CST') ?? textOf(icms, 'CSOSN');
  if (!cst) throw new EfdError(`Item ${line} da nota sem CST ou CSOSN do ICMS.`);
  return {
    line,
    cfop,
    cstIcms: (textOf(icms, 'orig') ?? '0') + cst,
    icmsRate: textOf(icms, 'pICMS') ?? '0',
    productCents: cents(prod, 'vProd'),
    discountCents: cents(prod, 'vDesc'),
    freightCents: cents(prod, 'vFrete'),
    insuranceCents: cents(prod, 'vSeg'),
    otherCents: cents(prod, 'vOutro'),
    icmsBaseCents: cents(icms, 'vBC'),
    icmsCents: cents(icms, 'vICMS') + cents(icms, 'vFCP'),
    stBaseCents: cents(icms, 'vBCST'),
    stCents: cents(icms, 'vICMSST') + cents(icms, 'vFCPST'),
    ipiCents: cents(find(imposto, 'IPI/IPITrib'), 'vIPI'),
  };
}

/** Indicador de pagamento: "sem pagamento" (tPag 90) em tudo vira 9; a prazo em algum vira 1. */
function paymentIndicator(pag: XmlElement | null): EfdDocument['paymentIndicator'] {
  const details = findAll(pag, 'detPag');
  if (details.length > 0 && details.every((d) => textOf(d, 'tPag') === '90')) return '9';
  if (details.some((d) => textOf(d, 'indPag') === '1')) return '1';
  return '0';
}

/** Lê o nfeProc (ou a NFe) autorizado de uma NF-e ou NFC-e. */
export function readEfdDocument(xml: string): EfdDocument {
  let root: XmlElement;
  try {
    root = parseXml(xml);
  } catch {
    throw new EfdError('O XML da nota não pôde ser lido.');
  }
  const nfe = root.name === 'nfeProc' ? find(root, 'NFe') : root.name === 'NFe' ? root : null;
  const inf = find(nfe, 'infNFe');
  if (!inf) throw new EfdError('O arquivo não é o XML de uma NF-e ou NFC-e.');
  const ide = find(inf, 'ide');
  const model = textOf(ide, 'mod');
  if (model !== '55' && model !== '65') throw new EfdError(`Modelo de nota fora da EFD: ${model}.`);
  const total = find(inf, 'total/ICMSTot');
  const issuedAt = textOf(ide, 'dhEmi') ?? '';
  const movedAt = textOf(ide, 'dhSaiEnt');
  const recipient = readParty(find(inf, 'dest'));
  const items = findAll(inf, 'det').map(readItem);
  if (items.length === 0) throw new EfdError('A nota não tem itens.');
  return {
    model,
    accessKey: (inf.attrs.Id ?? '').replace(/^NFe/, ''),
    series: Number(textOf(ide, 'serie')),
    number: Number(textOf(ide, 'nNF')),
    issuedOn: issuedAt.slice(0, 10),
    ...(movedAt && { movedOn: movedAt.slice(0, 10) }),
    direction: textOf(ide, 'tpNF') === '0' ? 'in' : 'out',
    purpose: textOf(ide, 'finNFe') ?? '1',
    ...(textOf(inf, 'emit/CNPJ') && { issuerCnpj: textOf(inf, 'emit/CNPJ') }),
    ...(recipient && { recipient }),
    paymentIndicator: paymentIndicator(find(inf, 'pag')),
    freightMode: textOf(inf, 'transp/modFrete') ?? '9',
    totalCents: cents(total, 'vNF'),
    productsCents: cents(total, 'vProd'),
    discountCents: cents(total, 'vDesc'),
    freightCents: cents(total, 'vFrete'),
    insuranceCents: cents(total, 'vSeg'),
    otherCents: cents(total, 'vOutro'),
    items,
  };
}
