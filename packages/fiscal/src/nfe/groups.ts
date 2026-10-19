import { format, fromCents } from '../decimal';
import type { ContributionResult } from '../taxes/contributions';
import type { DifalResult } from '../taxes/difal';
import type { IbsCbsResult } from '../taxes/ibs-cbs';
import type { IcmsResult } from '../taxes/icms';
import type { IpiResult } from '../taxes/ipi';
import { meiItemProblem } from '../tables/mei';
import { findPaymentMeans } from '../tables/payment-means';
import { el, opt, text, type XmlNode } from '../nfce/xml';

/**
 * Partes do XML comuns à NF-e (modelo 55) e à NFC-e (modelo 65), leiaute 4.00 com os grupos da
 * Reforma: emitente, itens com seus impostos, totais e pagamentos. Os valores vêm já calculados
 * pelo motor; aqui só se escreve o que o schema pede, na ordem dele.
 */
export interface NfeIssuer {
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

export interface NfeItem {
  code: string;
  /** GTIN (código de barras); null quando o produto não tem. */
  gtin: string | null;
  description: string;
  ncm: string;
  cest?: string | null;
  /** Código de benefício fiscal da UF (cBenef), quando a regra de ICMS da empresa traz um. */
  benefitCode?: string | null;
  cfop: string;
  unit: string;
  /** Quantidade em milésimos (como no caixa). */
  quantityMilli: number;
  unitPriceCents: number;
  /** Valor bruto do item (quantidade × preço). */
  grossCents: number;
  discountCents: number;
  /** Frete, seguro e outras despesas rateados no item (NF-e). */
  freightCents?: number;
  insuranceCents?: number;
  otherCents?: number;
  /** Origem da mercadoria (0 a 8). */
  origin: string;
  icms: IcmsResult;
  /** IPI e o código de enquadramento legal (cEnq), que vem da regra fiscal. */
  ipi?: { result: IpiResult; legalFramework: string } | null;
  pis?: ContributionResult | null;
  cofins?: ContributionResult | null;
  ibsCbs?: IbsCbsResult | null;
  /** Partilha do ICMS (EC 87/2015): venda interestadual a consumidor final não contribuinte. */
  difal?: DifalResult | null;
  /** Pedido de compra do cliente (xPed) e o item dele (nItemPed). */
  order?: { number: string; item?: string };
  /**
   * Item da nota devolvida (grupo DFeReferenciado, NT 2025.002-RTC v1.52): a chave de acesso e o
   * número do item (nItem) na nota original. Na devolução ele substitui o NFref (regra VC02-14).
   */
  reference?: { key: string; item: number };
}

export interface NfePayment {
  /** Código tPag da tabela oficial de meios de pagamento. */
  code: string;
  amountCents: number;
  /** Descrição do meio de pagamento; obrigatória com o código 99 (outros). */
  description?: string;
  /**
   * Grupo de cartões: tpIntegra 1 (integrado ao sistema, TEF) ou 2 (não integrado, ex.: POS) e o
   * código de autorização, quando houver.
   */
  card?: { integration: '1' | '2'; authorizationCode?: string };
}

export class NfeBuildError extends Error {}

/** Regras da nota do MEI (CRT 4, NT 2024.001): CSOSN e CFOP permitidos, antes de ir à SEFAZ. */
export function assertMeiItems(
  issuer: NfeIssuer,
  items: NfeItem[],
  model: '55' | '65',
  options: { isReturn?: boolean; exterior?: boolean } = {},
): void {
  if (issuer.crt !== 4) return;
  items.forEach((item, index) => {
    const problem = meiItemProblem({ model, csosn: item.icms.csosn, cfop: item.cfop, ...options });
    if (problem) throw new NfeBuildError(`Item ${index + 1}: ${problem}`);
  });
}

export const money = (cents: number) => format(fromCents(cents), 2);
export const req = (name: string, value: string | number) =>
  el(name, typeof value === 'number' ? value : text(value));
const pct4 = (value: string) => Number(value).toFixed(4);
const pct2 = (value: string) => Number(value).toFixed(2);
const qty = (milli: number) => (milli / 1000).toFixed(4);

/** Base pelo valor da operação (modBC 3); a ST vai pela MVA (modBCST 4) ou pela pauta (5). */
const MOD_BC_VALOR_OPERACAO = '3';

function icmsGroup(item: NfeItem, model: '55' | '65'): string {
  const r = item.icms;
  const orig = req('orig', item.origin);
  const own = [
    req('modBC', MOD_BC_VALOR_OPERACAO),
    r.baseReduction ? req('pRedBC', pct2(r.baseReduction)) : '',
    req('vBC', money(r.baseCents)),
    req('pICMS', pct2(r.rate!)),
    req('vICMS', money(r.amountCents)),
  ];
  // O ICMS00 traz só alíquota e valor do FCP; os demais grupos trazem também a base.
  const fcp = (withBase: boolean) =>
    r.fcp
      ? [
          withBase ? req('vBCFCP', money(r.baseCents)) : '',
          req('pFCP', pct2(r.fcp.rate)),
          req('vFCP', money(r.fcp.amountCents)),
        ]
      : [];
  const st = r.st
    ? [
        req('modBCST', r.st.modBc),
        r.st.mva !== null ? req('pMVAST', pct2(r.st.mva)) : '',
        r.st.baseReduction ? req('pRedBCST', pct2(r.st.baseReduction)) : '',
        req('vBCST', money(r.st.baseCents)),
        req('pICMSST', pct2(r.st.rate)),
        req('vICMSST', money(r.st.amountCents)),
      ]
    : [];
  const credit = r.credit
    ? [req('pCredSN', pct2(r.credit.rate)), req('vCredICMSSN', money(r.credit.amountCents))]
    : [];
  let body: XmlNode;
  switch (r.group) {
    case 'ICMS00':
      body = [orig, req('CST', r.cst!), own, fcp(false)];
      break;
    case 'ICMS10':
    case 'ICMS70':
      body = [orig, req('CST', r.cst!), own, fcp(true), st];
      break;
    case 'ICMS20':
      body = [orig, req('CST', r.cst!), own, fcp(true)];
      break;
    case 'ICMS40':
    case 'ICMS60':
      body = [orig, req('CST', r.cst!)];
      break;
    case 'ICMS51':
      body = [
        orig,
        req('CST', r.cst!),
        req('modBC', MOD_BC_VALOR_OPERACAO),
        req('vBC', money(r.baseCents)),
        req('pICMS', pct2(r.rate!)),
        req('vICMSOp', money(r.deferral!.operationAmountCents)),
        req('pDif', pct4(r.deferral!.rate)),
        req('vICMSDif', money(r.deferral!.deferredAmountCents)),
        req('vICMS', money(r.amountCents)),
        fcp(true),
      ];
      break;
    case 'ICMSSN101':
      body = [orig, req('CSOSN', r.csosn!), credit];
      break;
    case 'ICMSSN102':
    case 'ICMSSN500':
      body = [orig, req('CSOSN', r.csosn!)];
      break;
    case 'ICMSSN201':
      body = [orig, req('CSOSN', r.csosn!), st, credit];
      break;
    case 'ICMSSN202':
      body = [orig, req('CSOSN', r.csosn!), st];
      break;
    default:
      throw new NfeBuildError(
        `A situação de ICMS ${r.cst ?? r.csosn} (grupo ${r.group}) ainda não é emitida na ${model === '65' ? 'NFC-e' : 'NF-e'} pelo Bipaê.`,
      );
  }
  return el('ICMS', el(r.group, body));
}

function ipiGroup(ipi: NfeItem['ipi']): string {
  if (!ipi) return '';
  if (!/^\d{3}$/.test(ipi.legalFramework)) {
    throw new NfeBuildError(`Código de enquadramento do IPI inválido: ${ipi.legalFramework}.`);
  }
  const r = ipi.result;
  const body =
    r.group === 'IPITrib'
      ? el('IPITrib', [
          req('CST', r.cst),
          req('vBC', money(r.baseCents)),
          req('pIPI', pct2(r.rate!)),
          req('vIPI', money(r.amountCents)),
        ])
      : el('IPINT', req('CST', r.cst));
  return el('IPI', [req('cEnq', ipi.legalFramework), body]);
}

function contributionGroup(
  tax: 'PIS' | 'COFINS',
  r: ContributionResult | null | undefined,
): string {
  if (!r) return '';
  let body: XmlNode;
  if (r.group.endsWith('NT')) {
    body = [req('CST', r.cst)];
  } else if (r.group.endsWith('Qtde')) {
    body = [
      req('CST', r.cst),
      req('qBCProd', r.quantity!),
      req('vAliqProd', r.amountPerUnit!),
      req(`v${tax}`, money(r.amountCents)),
    ];
  } else {
    body = [
      req('CST', r.cst),
      req('vBC', money(r.baseCents)),
      req(`p${tax}`, pct2(r.rate ?? '0')),
      req(`v${tax}`, money(r.amountCents)),
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

const optMoney = (name: string, cents: number | undefined) =>
  cents && cents > 0 ? req(name, money(cents)) : '';

export function detGroup(item: NfeItem, index: number, model: '55' | '65'): string {
  return el(
    'det',
    [
      el('prod', [
        req('cProd', item.code),
        req('cEAN', item.gtin ?? 'SEM GTIN'),
        req('xProd', item.description),
        req('NCM', item.ncm),
        opt('CEST', item.cest),
        opt('cBenef', item.benefitCode),
        req('CFOP', item.cfop),
        req('uCom', item.unit),
        req('qCom', qty(item.quantityMilli)),
        req('vUnCom', money(item.unitPriceCents)),
        req('vProd', money(item.grossCents)),
        req('cEANTrib', item.gtin ?? 'SEM GTIN'),
        req('uTrib', item.unit),
        req('qTrib', qty(item.quantityMilli)),
        req('vUnTrib', money(item.unitPriceCents)),
        optMoney('vFrete', item.freightCents),
        optMoney('vSeg', item.insuranceCents),
        optMoney('vDesc', item.discountCents),
        optMoney('vOutro', item.otherCents),
        req('indTot', '1'),
        opt('xPed', item.order?.number),
        opt('nItemPed', item.order?.item),
      ]),
      el('imposto', [
        icmsGroup(item, model),
        ipiGroup(item.ipi),
        contributionGroup('PIS', item.pis),
        contributionGroup('COFINS', item.cofins),
        difalGroup(item.difal),
        ibsCbsGroup(item.ibsCbs),
      ]),
      item.reference
        ? el('DFeReferenciado', [
            req('chaveAcesso', item.reference.key),
            req('nItem', String(item.reference.item)),
          ])
        : '',
    ],
    { nItem: String(index + 1) },
  );
}

/** Grupo ICMSUFDest (partilha do ICMS), na ordem do leiaute. */
function difalGroup(d: DifalResult | null | undefined): string {
  if (!d) return '';
  const fcp = d.fcpCents > 0;
  return el('ICMSUFDest', [
    req('vBCUFDest', money(d.baseCents)),
    fcp ? req('vBCFCPUFDest', money(d.fcpBaseCents)) : '',
    fcp ? req('pFCPUFDest', d.fcpRate) : '',
    req('pICMSUFDest', d.destinationRate),
    req('pICMSInter', d.interstateRate),
    req('pICMSInterPart', d.sharePercent),
    fcp ? req('vFCPUFDest', money(d.fcpCents)) : '',
    req('vICMSUFDest', money(d.destinationCents)),
    req('vICMSUFRemet', money(d.originCents)),
  ]);
}

export interface NfeTotals {
  vProd: number;
  vDesc: number;
  vFrete: number;
  vSeg: number;
  vOutro: number;
  vBC: number;
  vICMS: number;
  vFCP: number;
  vBCST: number;
  vST: number;
  vIPI: number;
  vPIS: number;
  vCOFINS: number;
  vFCPUFDest: number;
  vICMSUFDest: number;
  vICMSUFRemet: number;
  vNF: number;
}

export function computeTotals(items: NfeItem[]): NfeTotals {
  const sum = (pick: (item: NfeItem) => number | undefined) =>
    items.reduce((total, item) => total + (pick(item) ?? 0), 0);
  const t = {
    vProd: sum((i) => i.grossCents),
    vDesc: sum((i) => i.discountCents),
    vFrete: sum((i) => i.freightCents),
    vSeg: sum((i) => i.insuranceCents),
    vOutro: sum((i) => i.otherCents),
    vBC: sum((i) => i.icms.baseCents),
    vICMS: sum((i) => i.icms.amountCents),
    vFCP: sum((i) => i.icms.fcp?.amountCents),
    vBCST: sum((i) => i.icms.st?.baseCents),
    vST: sum((i) => i.icms.st?.amountCents),
    vIPI: sum((i) => i.ipi?.result.amountCents),
    vPIS: sum((i) => i.pis?.amountCents),
    vCOFINS: sum((i) => i.cofins?.amountCents),
    vFCPUFDest: sum((i) => i.difal?.fcpCents),
    vICMSUFDest: sum((i) => i.difal?.destinationCents),
    vICMSUFRemet: sum((i) => i.difal?.originCents),
  };
  // Fórmula do vNF no Manual de Orientação do Contribuinte. Em 2026 o IBS e a CBS não somam no
  // total da nota (dúvida D-001).
  const vNF = t.vProd - t.vDesc + t.vST + t.vFrete + t.vSeg + t.vOutro + t.vIPI;
  return { ...t, vNF };
}

export function totalGroup(items: NfeItem[], t: NfeTotals): string {
  const taxed = items.filter((i) => i.ibsCbs?.taxed);
  const sumIbsCbs = (pick: (r: IbsCbsResult) => number) =>
    money(taxed.reduce((total, i) => total + pick(i.ibsCbs!), 0));
  return el('total', [
    el('ICMSTot', [
      req('vBC', money(t.vBC)),
      req('vICMS', money(t.vICMS)),
      req('vICMSDeson', money(0)),
      ...(items.some((i) => i.difal)
        ? [
            req('vFCPUFDest', money(t.vFCPUFDest)),
            req('vICMSUFDest', money(t.vICMSUFDest)),
            req('vICMSUFRemet', money(t.vICMSUFRemet)),
          ]
        : []),
      req('vFCP', money(t.vFCP)),
      req('vBCST', money(t.vBCST)),
      req('vST', money(t.vST)),
      req('vFCPST', money(0)),
      req('vFCPSTRet', money(0)),
      req('vProd', money(t.vProd)),
      req('vFrete', money(t.vFrete)),
      req('vSeg', money(t.vSeg)),
      req('vDesc', money(t.vDesc)),
      req('vII', money(0)),
      req('vIPI', money(t.vIPI)),
      req('vIPIDevol', money(0)),
      req('vPIS', money(t.vPIS)),
      req('vCOFINS', money(t.vCOFINS)),
      req('vOutro', money(t.vOutro)),
      req('vNF', money(t.vNF)),
    ]),
    taxed.length > 0
      ? el('IBSCBSTot', [
          req(
            'vBCIBSCBS',
            sumIbsCbs((r) => r.baseCents),
          ),
          el('gIBS', [
            el('gIBSUF', [
              req('vDif', money(0)),
              req('vDevTrib', money(0)),
              req(
                'vIBSUF',
                sumIbsCbs((r) => r.ibsState!.amountCents),
              ),
            ]),
            el('gIBSMun', [
              req('vDif', money(0)),
              req('vDevTrib', money(0)),
              req(
                'vIBSMun',
                sumIbsCbs((r) => r.ibsMunicipal!.amountCents),
              ),
            ]),
            req(
              'vIBS',
              sumIbsCbs((r) => r.ibsAmountCents),
            ),
            req('vCredPres', money(0)),
            req('vCredPresCondSus', money(0)),
          ]),
          el('gCBS', [
            req('vDif', money(0)),
            req('vDevTrib', money(0)),
            req(
              'vCBS',
              sumIbsCbs((r) => r.cbsAmountCents),
            ),
            req('vCredPres', money(0)),
            req('vCredPresCondSus', money(0)),
          ]),
        ])
      : '',
  ]);
}

export function emitGroup(issuer: NfeIssuer): string {
  const a = issuer.address;
  return el('emit', [
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
  ]);
}

/** Código tPag de "sem pagamento" (nota sem cobrança, como devolução ou remessa). */
const SEM_PAGAMENTO = '90';
const OUTROS = '99';

/**
 * Grupo de pagamento, conferido contra a tabela oficial e contra o valor da nota: os pagamentos,
 * descontado o troco, somam o vNF. "Sem pagamento" vem sozinho e com valor zero.
 */
export function pagGroup(
  payments: NfePayment[],
  changeCents: number | undefined,
  totalCents: number,
  date: string,
): string {
  for (const payment of payments) {
    if (!findPaymentMeans(payment.code, date)) {
      throw new NfeBuildError(
        `Meio de pagamento ${payment.code} não existe na tabela oficial em ${date}.`,
      );
    }
    if (payment.code === OUTROS && !payment.description?.trim()) {
      throw new NfeBuildError('Pagamento "outros" (99) precisa da descrição do meio usado.');
    }
  }
  const withoutPayment = payments.some((p) => p.code === SEM_PAGAMENTO);
  if (withoutPayment) {
    if (payments.length !== 1 || payments[0]!.amountCents !== 0 || changeCents) {
      throw new NfeBuildError('"Sem pagamento" (90) vem sozinho, com valor zero e sem troco.');
    }
  } else {
    const paid = payments.reduce((total, payment) => total + payment.amountCents, 0);
    if (payments.length === 0 || paid - (changeCents ?? 0) !== totalCents) {
      throw new NfeBuildError('Os pagamentos, descontado o troco, precisam somar o valor da nota.');
    }
  }
  return el('pag', [
    payments.map((payment) =>
      el('detPag', [
        req('tPag', payment.code),
        opt('xPag', payment.code === OUTROS ? payment.description : undefined),
        req('vPag', money(payment.amountCents)),
        payment.card
          ? el('card', [
              req('tpIntegra', payment.card.integration),
              opt('cAut', payment.card.authorizationCode),
            ])
          : '',
      ]),
    ),
    changeCents ? req('vTroco', money(changeCents)) : '',
  ]);
}

export function infAdicGroup(fiscalInfo: string | undefined, additionalInfo: string | undefined) {
  return fiscalInfo || additionalInfo
    ? el('infAdic', [opt('infAdFisco', fiscalInfo), opt('infCpl', additionalInfo)])
    : '';
}
