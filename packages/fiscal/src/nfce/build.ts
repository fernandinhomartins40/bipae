import { format, fromCents } from '../decimal';
import type { ContributionResult } from '../taxes/contributions';
import type { IbsCbsResult } from '../taxes/ibs-cbs';
import type { IcmsResult } from '../taxes/icms';
import { findPaymentMeans } from '../tables/payment-means';
import { buildAccessKey } from './access-key';
import { el, opt, text, type XmlNode } from './xml';

/**
 * XML da NFC-e (modelo 65, leiaute 4.00 com os grupos da Reforma), a partir dos dados da venda e
 * dos impostos já calculados pelo motor. Sai sem assinatura: a assinatura com o certificado é
 * outra etapa (F3-09). Só homologação (tpAmb = 2): produção exige pedido explícito do dono do
 * projeto (regra 4 do CLAUDE.md), e por isso nem existe opção para isso aqui.
 */
export interface NfceIssuer {
  cnpj: string;
  name: string;
  tradeName?: string;
  /** Inscrição estadual, só dígitos. */
  ie: string;
  crt: 1 | 2 | 3 | 4;
  address: {
    street: string;
    number: string;
    complement?: string;
    district: string;
    /** Código IBGE do município (7 dígitos). */
    cityCode: string;
    cityName: string;
    uf: string;
    cep: string;
    phone?: string;
  };
}

export interface NfceItem {
  code: string;
  /** GTIN (código de barras); null quando o produto não tem. */
  gtin: string | null;
  description: string;
  ncm: string;
  cest?: string | null;
  cfop: string;
  unit: string;
  /** Quantidade em milésimos (como no caixa). */
  quantityMilli: number;
  unitPriceCents: number;
  /** Valor bruto do item (quantidade × preço). */
  grossCents: number;
  discountCents: number;
  /** Origem da mercadoria (0 a 8). */
  origin: string;
  icms: IcmsResult;
  pis?: ContributionResult | null;
  cofins?: ContributionResult | null;
  ibsCbs?: IbsCbsResult | null;
}

export interface NfcePayment {
  /** Código tPag da tabela oficial de meios de pagamento. */
  code: string;
  amountCents: number;
}

export interface NfceInput {
  issuer: NfceIssuer;
  /** Código IBGE da UF do emitente (2 dígitos). */
  cUF: string;
  series: number;
  number: number;
  /** Data e hora da emissão com fuso (AAAA-MM-DDThh:mm:ss-03:00). */
  issuedAt: string;
  /** Código numérico aleatório de 8 dígitos. */
  numericCode: string;
  customer?: { cpf?: string; cnpj?: string; name?: string } | null;
  items: NfceItem[];
  payments: NfcePayment[];
  changeCents?: number;
  additionalInfo?: string;
  /** Versão do sistema emissor (verProc). */
  appVersion: string;
}

export interface NfceDocument {
  accessKey: string;
  /** XML do elemento <NFe>, sem assinatura. */
  xml: string;
  totalCents: number;
}

const NS = 'http://www.portalfiscal.inf.br/nfe';
const money = (cents: number) => format(fromCents(cents), 2);
const req = (name: string, value: string | number) =>
  el(name, typeof value === 'number' ? value : text(value));
const pct4 = (value: string) => Number(value).toFixed(4);
const pct2 = (value: string) => Number(value).toFixed(2);
const qty = (milli: number) => (milli / 1000).toFixed(4);

export class NfceBuildError extends Error {}

function icmsGroup(item: NfceItem): string {
  const r = item.icms;
  const orig = req('orig', item.origin);
  const base = (rate: string | null) => [
    req('modBC', '3'),
    req('vBC', money(r.baseCents)),
    req('pICMS', pct2(rate!)),
    req('vICMS', money(r.amountCents)),
  ];
  const fcp = r.fcp ? [req('pFCP', pct2(r.fcp.rate)), req('vFCP', money(r.fcp.amountCents))] : [];
  let body: XmlNode;
  switch (r.group) {
    case 'ICMS00':
      body = [orig, req('CST', r.cst!), base(r.rate), fcp];
      break;
    case 'ICMS20':
      body = [
        orig,
        req('CST', r.cst!),
        req('modBC', '3'),
        req('pRedBC', pct2(r.baseReduction!)),
        req('vBC', money(r.baseCents)),
        req('pICMS', pct2(r.rate!)),
        req('vICMS', money(r.amountCents)),
      ];
      break;
    case 'ICMS40':
    case 'ICMS60':
      body = [orig, req('CST', r.cst!)];
      break;
    case 'ICMSSN101':
      body = [
        orig,
        req('CSOSN', r.csosn!),
        req('pCredSN', pct2(r.credit!.rate)),
        req('vCredICMSSN', money(r.credit!.amountCents)),
      ];
      break;
    case 'ICMSSN102':
    case 'ICMSSN500':
      body = [orig, req('CSOSN', r.csosn!)];
      break;
    default:
      throw new NfceBuildError(
        `A situação de ICMS ${r.cst ?? r.csosn} (grupo ${r.group}) ainda não é emitida na NFC-e pelo Bipaê.`,
      );
  }
  return el('ICMS', el(r.group, body));
}

function contributionGroup(
  tax: 'PIS' | 'COFINS',
  r: ContributionResult | null | undefined,
): string {
  if (!r) return '';
  const p = tax === 'PIS' ? 'PIS' : 'COFINS';
  let body: XmlNode;
  if (r.group.endsWith('NT')) {
    body = [req('CST', r.cst)];
  } else if (r.group.endsWith('Qtde')) {
    body = [
      req('CST', r.cst),
      req('qBCProd', r.quantity!),
      req(`vAliqProd`, r.amountPerUnit!),
      req(`v${p}`, money(r.amountCents)),
    ];
  } else {
    body = [
      req('CST', r.cst),
      req('vBC', money(r.baseCents)),
      req(`p${p}`, pct2(r.rate ?? '0')),
      req(`v${p}`, money(r.amountCents)),
    ];
  }
  return el(tax, el(r.group, body));
}

function ibsCbsGroup(r: IbsCbsResult | null | undefined): string {
  if (!r) return '';
  const part = (tag: 'IBSUF' | 'IBSMun' | 'CBS', p: NonNullable<IbsCbsResult['cbs']>) =>
    el(`g${tag}`, [
      req(`p${tag}`, pct4(p.rate)),
      Number(p.reduction) > 0
        ? el('gRed', [req('pRedAliq', pct4(p.reduction)), req('pAliqEfet', pct4(p.effectiveRate))])
        : '',
      req(`v${tag}`, money(p.amountCents)),
    ]);
  const values = r.taxed
    ? el('gIBSCBS', [
        req('vBC', money(r.baseCents)),
        part('IBSUF', r.ibsState!),
        part('IBSMun', r.ibsMunicipal!),
        req('vIBS', money(r.ibsAmountCents)),
        part('CBS', r.cbs!),
      ])
    : '';
  return el('IBSCBS', [req('CST', r.cst), req('cClassTrib', r.cClassTrib), values]);
}

export function buildNfce(input: NfceInput): NfceDocument {
  if (input.items.length === 0) throw new NfceBuildError('A NFC-e precisa de pelo menos um item.');
  if (input.items.length > 990) throw new NfceBuildError('A NFC-e aceita no máximo 990 itens.');
  const issuedDate = input.issuedAt.slice(0, 10);
  const accessKey = buildAccessKey({
    cUF: input.cUF,
    yearMonth: input.issuedAt.slice(2, 4) + input.issuedAt.slice(5, 7),
    cnpj: input.issuer.cnpj,
    model: '65',
    series: input.series,
    number: input.number,
    emissionType: 1,
    numericCode: input.numericCode,
  });

  // ---------------------------------------------------------------- totais
  const sum = (pick: (item: NfceItem) => number) =>
    input.items.reduce((total, item) => total + pick(item), 0);
  const vProd = sum((i) => i.grossCents);
  const vDesc = sum((i) => i.discountCents);
  const vBC = sum((i) => i.icms.baseCents);
  const vICMS = sum((i) => i.icms.amountCents);
  const vFCP = sum((i) => i.icms.fcp?.amountCents ?? 0);
  const vPIS = sum((i) => i.pis?.amountCents ?? 0);
  const vCOFINS = sum((i) => i.cofins?.amountCents ?? 0);
  // Em 2026 o IBS e a CBS não somam no total da nota (dúvida D-001): vNF é o valor dos produtos.
  const vNF = vProd - vDesc;
  const paid = input.payments.reduce((total, payment) => total + payment.amountCents, 0);
  if (paid - (input.changeCents ?? 0) !== vNF) {
    throw new NfceBuildError('Os pagamentos, descontado o troco, precisam somar o valor da nota.');
  }
  for (const payment of input.payments) {
    if (!findPaymentMeans(payment.code, issuedDate)) {
      throw new NfceBuildError(
        `Meio de pagamento ${payment.code} não existe na tabela oficial em ${issuedDate}.`,
      );
    }
  }
  const taxed = input.items.filter((i) => i.ibsCbs?.taxed);

  const issuer = input.issuer;
  const a = issuer.address;
  const customer = input.customer;
  const xml = el(
    'NFe',
    el(
      'infNFe',
      [
        el('ide', [
          req('cUF', input.cUF),
          req('cNF', input.numericCode),
          req('natOp', 'Venda'),
          req('mod', '65'),
          req('serie', input.series),
          req('nNF', input.number),
          req('dhEmi', input.issuedAt),
          req('tpNF', '1'),
          req('idDest', '1'),
          req('cMunFG', a.cityCode),
          req('tpImp', '4'),
          req('tpEmis', '1'),
          req('cDV', accessKey.slice(-1)),
          req('tpAmb', '2'),
          req('finNFe', '1'),
          req('indFinal', '1'),
          req('indPres', '1'),
          req('procEmi', '0'),
          req('verProc', input.appVersion),
        ]),
        el('emit', [
          req('CNPJ', issuer.cnpj),
          req('xNome', issuer.name),
          opt('xFant', issuer.tradeName),
          el('enderEmit', [
            req('xLgr', a.street),
            req('nro', a.number),
            opt('xCpl', a.complement),
            req('xBairro', a.district),
            req('cMun', a.cityCode),
            req('xMun', a.cityName),
            req('UF', a.uf),
            req('CEP', a.cep),
            req('cPais', '1058'),
            req('xPais', 'Brasil'),
            opt('fone', a.phone),
          ]),
          req('IE', issuer.ie),
          req('CRT', issuer.crt),
        ]),
        customer?.cpf || customer?.cnpj
          ? el('dest', [
              customer.cpf ? req('CPF', customer.cpf) : req('CNPJ', customer.cnpj!),
              opt('xNome', customer.name),
              req('indIEDest', '9'),
            ])
          : '',
        input.items.map((item, index) =>
          el(
            'det',
            [
              el('prod', [
                req('cProd', item.code),
                req('cEAN', item.gtin ?? 'SEM GTIN'),
                req('xProd', item.description),
                req('NCM', item.ncm),
                opt('CEST', item.cest),
                req('CFOP', item.cfop),
                req('uCom', item.unit),
                req('qCom', qty(item.quantityMilli)),
                req('vUnCom', money(item.unitPriceCents)),
                req('vProd', money(item.grossCents)),
                req('cEANTrib', item.gtin ?? 'SEM GTIN'),
                req('uTrib', item.unit),
                req('qTrib', qty(item.quantityMilli)),
                req('vUnTrib', money(item.unitPriceCents)),
                item.discountCents > 0 ? req('vDesc', money(item.discountCents)) : '',
                req('indTot', '1'),
              ]),
              el('imposto', [
                icmsGroup(item),
                contributionGroup('PIS', item.pis),
                contributionGroup('COFINS', item.cofins),
                ibsCbsGroup(item.ibsCbs),
              ]),
            ],
            { nItem: String(index + 1) },
          ),
        ),
        el('total', [
          el('ICMSTot', [
            req('vBC', money(vBC)),
            req('vICMS', money(vICMS)),
            req('vICMSDeson', money(0)),
            req('vFCP', money(vFCP)),
            req('vBCST', money(0)),
            req('vST', money(0)),
            req('vFCPST', money(0)),
            req('vFCPSTRet', money(0)),
            req('vProd', money(vProd)),
            req('vFrete', money(0)),
            req('vSeg', money(0)),
            req('vDesc', money(vDesc)),
            req('vII', money(0)),
            req('vIPI', money(0)),
            req('vIPIDevol', money(0)),
            req('vPIS', money(vPIS)),
            req('vCOFINS', money(vCOFINS)),
            req('vOutro', money(0)),
            req('vNF', money(vNF)),
          ]),
          taxed.length > 0
            ? el('IBSCBSTot', [
                req('vBCIBSCBS', money(taxed.reduce((t, i) => t + i.ibsCbs!.baseCents, 0))),
                el('gIBS', [
                  el('gIBSUF', [
                    req('vDif', money(0)),
                    req('vDevTrib', money(0)),
                    req(
                      'vIBSUF',
                      money(taxed.reduce((t, i) => t + i.ibsCbs!.ibsState!.amountCents, 0)),
                    ),
                  ]),
                  el('gIBSMun', [
                    req('vDif', money(0)),
                    req('vDevTrib', money(0)),
                    req(
                      'vIBSMun',
                      money(taxed.reduce((t, i) => t + i.ibsCbs!.ibsMunicipal!.amountCents, 0)),
                    ),
                  ]),
                  req('vIBS', money(taxed.reduce((t, i) => t + i.ibsCbs!.ibsAmountCents, 0))),
                  req('vCredPres', money(0)),
                  req('vCredPresCondSus', money(0)),
                ]),
                el('gCBS', [
                  req('vDif', money(0)),
                  req('vDevTrib', money(0)),
                  req('vCBS', money(taxed.reduce((t, i) => t + i.ibsCbs!.cbsAmountCents, 0))),
                  req('vCredPres', money(0)),
                  req('vCredPresCondSus', money(0)),
                ]),
              ])
            : '',
        ]),
        el('transp', req('modFrete', '9')),
        el('pag', [
          input.payments.map((payment) =>
            el('detPag', [req('tPag', payment.code), req('vPag', money(payment.amountCents))]),
          ),
          input.changeCents ? req('vTroco', money(input.changeCents)) : '',
        ]),
        input.additionalInfo ? el('infAdic', req('infCpl', input.additionalInfo)) : '',
      ],
      { Id: `NFe${accessKey}`, versao: '4.00' },
    ),
    { xmlns: NS },
  );
  return { accessKey, xml, totalCents: vNF };
}
