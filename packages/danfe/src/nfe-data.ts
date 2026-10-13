import { descendant, find, findAll, parseXml, textOf, type XmlElement } from '@bipae/fiscal';

/**
 * O que o DANFE da NF-e mostra, lido do XML da nota (NFe) ou do XML autorizado (nfeProc, que traz
 * o protocolo). Valores ficam no texto do XML ("1234.56"): nada passa por número de ponto
 * flutuante, e o que não está no XML fica de fora.
 */
export interface DanfeAddress {
  street: string;
  district: string;
  cityName: string;
  uf: string;
  cep?: string;
  phone?: string;
}

export interface DanfeItem {
  code: string;
  gtin?: string;
  description: string;
  ncm: string;
  /** Origem + CST (3 dígitos) ou origem + CSOSN (4 dígitos). */
  cst: string;
  cfop: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  total: string;
  discount?: string;
  icmsBase?: string;
  icmsValue?: string;
  icmsRate?: string;
  stBase?: string;
  stValue?: string;
  ipiValue?: string;
  ipiRate?: string;
  /** infAdProd. */
  additional?: string;
  /** Grupo IBSCBS e IS do item (NT 2026.010, item 4.3). */
  reform?: {
    cClassTrib: string;
    base?: string;
    ibsUfRate?: string;
    ibsUf?: string;
    ibsMunRate?: string;
    ibsMun?: string;
    cbsRate?: string;
    cbs?: string;
    isBase?: string;
    isRate?: string;
    is?: string;
  };
}

export interface DanfeNfe {
  accessKey: string;
  number: string;
  series: string;
  issuedAt: string;
  leavesAt?: string;
  /** tpNF: 0 entrada, 1 saída. */
  direction: '0' | '1';
  nature: string;
  environment: 'producao' | 'homologacao';
  emissionType: string;
  protocol?: { number: string; receivedAt: string };
  emitter: {
    name: string;
    tradeName?: string;
    cnpj?: string;
    cpf?: string;
    ie?: string;
    ieSt?: string;
    crt: string;
    address: DanfeAddress;
  };
  recipient?: {
    name: string;
    cnpj?: string;
    cpf?: string;
    foreignId?: string;
    ie?: string;
    address?: DanfeAddress;
  };
  duplicates: { number: string; dueDate: string; value: string }[];
  totals: Record<
    | 'vBC'
    | 'vICMS'
    | 'vBCST'
    | 'vST'
    | 'vProd'
    | 'vFrete'
    | 'vSeg'
    | 'vDesc'
    | 'vOutro'
    | 'vIPI'
    | 'vNF',
    string
  > &
    Partial<Record<'vFCP' | 'vFCPST' | 'vICMSUFDest' | 'vFCPUFDest' | 'vTotTrib', string>>;
  /** Total do IBS/CBS/IS (NT 2026.010, item 4.1): só os campos presentes no XML. */
  reformTotals?: Partial<
    Record<
      | 'vCBS'
      | 'vIBSUF'
      | 'vIBSMun'
      | 'vIS'
      | 'vIBSMono'
      | 'vCBSMono'
      | 'vIBSMonoReten'
      | 'vCBSMonoReten',
      string
    >
  >;
  transport: {
    freightMode: string;
    carrier?: {
      name?: string;
      cnpj?: string;
      cpf?: string;
      ie?: string;
      address?: string;
      cityName?: string;
      uf?: string;
    };
    volumes: {
      quantity?: string;
      species?: string;
      brand?: string;
      numbering?: string;
      grossKg?: string;
      netKg?: string;
    }[];
  };
  items: DanfeItem[];
  fiscalInfo?: string;
  additionalInfo?: string;
}

export class DanfeDataError extends Error {}

function required(node: XmlElement | null, path: string): string {
  const value = textOf(node, path);
  if (value === undefined || value === '')
    throw new DanfeDataError(`O XML da nota não tem ${path}.`);
  return value;
}

function address(node: XmlElement | null): DanfeAddress | undefined {
  if (!node) return undefined;
  const street = [textOf(node, 'xLgr'), textOf(node, 'nro'), textOf(node, 'xCpl')]
    .filter(Boolean)
    .join(', ');
  return {
    street,
    district: textOf(node, 'xBairro') ?? '',
    cityName: textOf(node, 'xMun') ?? '',
    uf: textOf(node, 'UF') ?? '',
    ...(textOf(node, 'CEP') && { cep: textOf(node, 'CEP') }),
    ...(textOf(node, 'fone') && { phone: textOf(node, 'fone') }),
  };
}

/** Só as chaves com valor: o DANFE não mostra campo que não existe no XML. */
function present<K extends string>(
  node: XmlElement | null,
  keys: readonly K[],
): Partial<Record<K, string>> {
  const out: Partial<Record<K, string>> = {};
  for (const key of keys) {
    const value = textOf(node, key);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** Alíquota a mostrar: a efetiva quando há redução (gRed), senão a vigente (NT 2026.010, 4.3). */
const rateOf = (group: XmlElement | null, tag: string) =>
  textOf(group, 'gRed/pAliqEfet') ?? textOf(group, tag);

function item(det: XmlElement): DanfeItem {
  const prod = find(det, 'prod');
  const imposto = find(det, 'imposto');
  const icms = find(imposto, 'ICMS')?.children[0] ?? null;
  const origin = textOf(icms, 'orig') ?? '';
  const cst = textOf(icms, 'CST') ?? textOf(icms, 'CSOSN') ?? '';
  const ipiTrib = find(imposto, 'IPI/IPITrib');
  const ibsCbs = find(imposto, 'IBSCBS');
  const values = find(ibsCbs, 'gIBSCBS');
  const is = find(imposto, 'IS');
  const gtin = textOf(prod, 'cEAN');
  return {
    code: required(prod, 'cProd'),
    ...(gtin && gtin !== 'SEM GTIN' && { gtin }),
    description: required(prod, 'xProd'),
    ncm: required(prod, 'NCM'),
    cst: origin + cst,
    cfop: required(prod, 'CFOP'),
    unit: required(prod, 'uCom'),
    quantity: required(prod, 'qCom'),
    unitPrice: required(prod, 'vUnCom'),
    total: required(prod, 'vProd'),
    ...(textOf(prod, 'vDesc') !== undefined && { discount: textOf(prod, 'vDesc') }),
    ...(textOf(icms, 'vBC') !== undefined && { icmsBase: textOf(icms, 'vBC') }),
    ...(textOf(icms, 'vICMS') !== undefined && { icmsValue: textOf(icms, 'vICMS') }),
    ...(textOf(icms, 'pICMS') !== undefined && { icmsRate: textOf(icms, 'pICMS') }),
    ...(textOf(icms, 'vBCST') !== undefined && { stBase: textOf(icms, 'vBCST') }),
    ...(textOf(icms, 'vICMSST') !== undefined && { stValue: textOf(icms, 'vICMSST') }),
    ...(ipiTrib && { ipiValue: textOf(ipiTrib, 'vIPI'), ipiRate: textOf(ipiTrib, 'pIPI') }),
    ...(textOf(det, 'infAdProd') && { additional: textOf(det, 'infAdProd') }),
    ...(ibsCbs && {
      reform: {
        cClassTrib: required(ibsCbs, 'cClassTrib'),
        ...(values && {
          base: textOf(values, 'vBC'),
          ibsUfRate: rateOf(find(values, 'gIBSUF'), 'pIBSUF'),
          ibsUf: textOf(values, 'gIBSUF/vIBSUF'),
          ibsMunRate: rateOf(find(values, 'gIBSMun'), 'pIBSMun'),
          ibsMun: textOf(values, 'gIBSMun/vIBSMun'),
          cbsRate: rateOf(find(values, 'gCBS'), 'pCBS'),
          cbs: textOf(values, 'gCBS/vCBS'),
        }),
        ...(is && {
          isBase: textOf(is, 'vBCIS'),
          isRate: textOf(is, 'pIS'),
          is: textOf(is, 'vIS'),
        }),
      },
    }),
  };
}

export function readNfe(xml: string): DanfeNfe {
  const root = parseXml(xml);
  const nfe = root.name === 'nfeProc' ? find(root, 'NFe') : root.name === 'NFe' ? root : null;
  const inf = find(nfe, 'infNFe');
  if (!inf) throw new DanfeDataError('O arquivo não é o XML de uma NF-e.');
  const ide = find(inf, 'ide');
  if (textOf(ide, 'mod') !== '55')
    throw new DanfeDataError('O DANFE em folha A4 é da NF-e modelo 55.');
  const accessKey = (inf.attrs.Id ?? '').replace(/^NFe/, '');
  if (!/^[0-9A-Z]{44}$/.test(accessKey))
    throw new DanfeDataError('Chave de acesso inválida no XML.');
  const prot = descendant(root.name === 'nfeProc' ? find(root, 'protNFe') : null, 'infProt');
  const emit = find(inf, 'emit');
  const dest = find(inf, 'dest');
  const transp = find(inf, 'transp');
  const transporta = find(transp, 'transporta');
  const icmsTot = find(inf, 'total/ICMSTot');
  const reformTot = find(inf, 'total/IBSCBSTot');
  const isTot = find(inf, 'total/ISTot');
  const reformTotals = reformTot
    ? {
        ...(textOf(reformTot, 'gCBS/vCBS') !== undefined && {
          vCBS: textOf(reformTot, 'gCBS/vCBS'),
        }),
        ...(textOf(reformTot, 'gIBS/gIBSUF/vIBSUF') !== undefined && {
          vIBSUF: textOf(reformTot, 'gIBS/gIBSUF/vIBSUF'),
        }),
        ...(textOf(reformTot, 'gIBS/gIBSMun/vIBSMun') !== undefined && {
          vIBSMun: textOf(reformTot, 'gIBS/gIBSMun/vIBSMun'),
        }),
        ...present(find(reformTot, 'gMono'), [
          'vIBSMono',
          'vCBSMono',
          'vIBSMonoReten',
          'vCBSMonoReten',
        ] as const),
        ...(textOf(isTot, 'vIS') !== undefined && { vIS: textOf(isTot, 'vIS') }),
      }
    : undefined;
  return {
    accessKey,
    number: required(ide, 'nNF'),
    series: required(ide, 'serie'),
    issuedAt: required(ide, 'dhEmi'),
    ...(textOf(ide, 'dhSaiEnt') && { leavesAt: textOf(ide, 'dhSaiEnt') }),
    direction: required(ide, 'tpNF') === '0' ? '0' : '1',
    nature: required(ide, 'natOp'),
    environment: required(ide, 'tpAmb') === '1' ? 'producao' : 'homologacao',
    emissionType: required(ide, 'tpEmis'),
    ...(prot &&
      textOf(prot, 'nProt') && {
        protocol: { number: required(prot, 'nProt'), receivedAt: required(prot, 'dhRecbto') },
      }),
    emitter: {
      name: required(emit, 'xNome'),
      ...(textOf(emit, 'CNPJ') && { cnpj: textOf(emit, 'CNPJ') }),
      ...(textOf(emit, 'CPF') && { cpf: textOf(emit, 'CPF') }),
      ...(textOf(emit, 'xFant') && { tradeName: textOf(emit, 'xFant') }),
      ...(textOf(emit, 'IE') && { ie: textOf(emit, 'IE') }),
      ...(textOf(emit, 'IEST') && { ieSt: textOf(emit, 'IEST') }),
      crt: required(emit, 'CRT'),
      address: address(find(emit, 'enderEmit'))!,
    },
    ...(dest && {
      recipient: {
        name: textOf(dest, 'xNome') ?? '',
        ...(textOf(dest, 'CNPJ') && { cnpj: textOf(dest, 'CNPJ') }),
        ...(textOf(dest, 'CPF') && { cpf: textOf(dest, 'CPF') }),
        ...(textOf(dest, 'idEstrangeiro') && { foreignId: textOf(dest, 'idEstrangeiro') }),
        ...(textOf(dest, 'IE') && { ie: textOf(dest, 'IE') }),
        ...(find(dest, 'enderDest') && { address: address(find(dest, 'enderDest')) }),
      },
    }),
    duplicates: findAll(find(inf, 'cobr'), 'dup').map((d) => ({
      number: textOf(d, 'nDup') ?? '',
      dueDate: textOf(d, 'dVenc') ?? '',
      value: required(d, 'vDup'),
    })),
    totals: {
      vBC: required(icmsTot, 'vBC'),
      vICMS: required(icmsTot, 'vICMS'),
      vBCST: required(icmsTot, 'vBCST'),
      vST: required(icmsTot, 'vST'),
      vProd: required(icmsTot, 'vProd'),
      vFrete: required(icmsTot, 'vFrete'),
      vSeg: required(icmsTot, 'vSeg'),
      vDesc: required(icmsTot, 'vDesc'),
      vOutro: required(icmsTot, 'vOutro'),
      vIPI: required(icmsTot, 'vIPI'),
      vNF: required(icmsTot, 'vNF'),
      ...present(icmsTot, ['vFCP', 'vFCPST', 'vICMSUFDest', 'vFCPUFDest', 'vTotTrib'] as const),
    },
    ...(reformTotals && { reformTotals }),
    transport: {
      freightMode: required(transp, 'modFrete'),
      ...(transporta && {
        carrier: {
          ...(textOf(transporta, 'xNome') && { name: textOf(transporta, 'xNome') }),
          ...(textOf(transporta, 'CNPJ') && { cnpj: textOf(transporta, 'CNPJ') }),
          ...(textOf(transporta, 'CPF') && { cpf: textOf(transporta, 'CPF') }),
          ...(textOf(transporta, 'IE') && { ie: textOf(transporta, 'IE') }),
          ...(textOf(transporta, 'xEnder') && { address: textOf(transporta, 'xEnder') }),
          ...(textOf(transporta, 'xMun') && { cityName: textOf(transporta, 'xMun') }),
          ...(textOf(transporta, 'UF') && { uf: textOf(transporta, 'UF') }),
        },
      }),
      volumes: findAll(transp, 'vol').map((v) => {
        const p = present(v, ['qVol', 'esp', 'marca', 'nVol', 'pesoB', 'pesoL'] as const);
        return {
          ...(p.qVol && { quantity: p.qVol }),
          ...(p.esp && { species: p.esp }),
          ...(p.marca && { brand: p.marca }),
          ...(p.nVol && { numbering: p.nVol }),
          ...(p.pesoB && { grossKg: p.pesoB }),
          ...(p.pesoL && { netKg: p.pesoL }),
        };
      }),
    },
    items: findAll(inf, 'det').map(item),
    ...(textOf(inf, 'infAdic/infAdFisco') && { fiscalInfo: textOf(inf, 'infAdic/infAdFisco') }),
    ...(textOf(inf, 'infAdic/infCpl') && { additionalInfo: textOf(inf, 'infAdic/infCpl') }),
  };
}
