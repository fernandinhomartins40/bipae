import { cfopGroup } from '../tables/cfop';
import { buildAccessKey } from '../nfce/access-key';
import { el, opt, type XmlNode } from '../nfce/xml';
import {
  computeTotals,
  detGroup,
  emitGroup,
  infAdicGroup,
  money,
  assertMeiItems,
  NfeBuildError,
  pagGroup,
  req,
  totalGroup,
  type NfeIssuer,
  type NfeItem,
  type NfePayment,
} from './groups';

/**
 * XML da NF-e (modelo 55, leiaute 4.00 com os grupos da Reforma): venda entre empresas, venda
 * com entrega, devolução. Sai sem assinatura (a assinatura é a F3-09) e só em homologação
 * (tpAmb = 2): produção exige pedido explícito do dono do projeto (regra 4 do CLAUDE.md).
 */
export interface NfeAddress {
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
}

export interface NfeRecipient {
  /** CPF ou CNPJ, só dígitos (CNPJ pode ser alfanumérico). */
  cpf?: string;
  cnpj?: string;
  name: string;
  /**
   * Indicador da IE do destinatário: 1 contribuinte do ICMS (com IE), 2 contribuinte isento de
   * inscrição, 9 não contribuinte.
   */
  ieIndicator: 1 | 2 | 9;
  ie?: string;
  email?: string;
  address: NfeAddress;
}

/** Finalidade da nota (finNFe). */
export const NFE_PURPOSES = {
  normal: '1',
  complementar: '2',
  ajuste: '3',
  devolucao: '4',
} as const;

/** Presença do comprador (indPres). */
export const NFE_PRESENCE = {
  naoSeAplica: '0',
  presencial: '1',
  internet: '2',
  teleatendimento: '3',
  entregaEmDomicilio: '4',
  presencialForaDoEstabelecimento: '5',
  outros: '9',
} as const;

/** Modalidade do frete (modFrete). */
export const NFE_FREIGHT = {
  porContaDoRemetente: '0',
  porContaDoDestinatario: '1',
  porContaDeTerceiros: '2',
  proprioPorContaDoRemetente: '3',
  proprioPorContaDoDestinatario: '4',
  semFrete: '9',
} as const;

const ACCESS_KEY = /^\d{44}$|^[0-9A-Z]{44}$/;

/**
 * Referência item a item da devolução (NT 2025.002-RTC v1.52, grupo VC): cada item diz de qual
 * nota e de qual item veio (VC02-14, VC03-20), sem repetir o mesmo item (VC02-30), todas as notas
 * do mesmo emitente (VC02-50) e, quando a nota devolvida é de outra empresa, emitida pelo
 * destinatário desta (rejeição 1194). Fora da devolução, o Bipaê não referencia por item.
 */
function checkItemReferences(input: NfeInput, isReturn: boolean) {
  const seen = new Set<string>();
  const issuers = new Set<string>();
  input.items.forEach((item, index) => {
    const label = `Item ${index + 1}`;
    const ref = item.reference;
    if (!isReturn) {
      if (ref) throw new NfeBuildError(`${label}: a referência por item só vale na devolução.`);
      return;
    }
    if (!ref) {
      throw new NfeBuildError(
        `${label}: diga de qual nota e de qual item ele é devolvido (NT 2025.002, regra VC02-14).`,
      );
    }
    if (!ACCESS_KEY.test(ref.key)) {
      throw new NfeBuildError(`${label}: chave da nota devolvida inválida (${ref.key}).`);
    }
    if (!Number.isInteger(ref.item) || ref.item < 1 || ref.item > 990) {
      throw new NfeBuildError(`${label}: o número do item na nota devolvida vai de 1 a 990.`);
    }
    const id = `${ref.key}#${ref.item}`;
    if (seen.has(id)) {
      throw new NfeBuildError(
        `${label}: o item ${ref.item} da nota devolvida já está em outro item desta nota.`,
      );
    }
    seen.add(id);
    // O CNPJ do emitente ocupa as posições 7 a 20 da chave de acesso.
    issuers.add(ref.key.slice(6, 20));
  });
  if (issuers.size > 1) {
    throw new NfeBuildError(
      'Na devolução, todas as notas devolvidas precisam ser do mesmo emitente (regra VC02-50).',
    );
  }
  const [issuer] = [...issuers];
  const recipient = input.recipient.cnpj ?? input.recipient.cpf?.padStart(14, '0');
  if (
    issuer &&
    input.direction === 'saida' &&
    issuer !== input.issuer.cnpj &&
    issuer !== recipient
  ) {
    throw new NfeBuildError(
      'A nota devolvida precisa ter sido emitida pelo destinatário desta devolução (rejeição 1194).',
    );
  }
}

export interface NfeInput {
  issuer: NfeIssuer;
  /** Código IBGE da UF do emitente (2 dígitos). */
  cUF: string;
  series: number;
  number: number;
  /** Data e hora da emissão com fuso (AAAA-MM-DDThh:mm:ss-03:00). */
  issuedAt: string;
  /** Data e hora da saída da mercadoria, quando já se sabe. */
  leavesAt?: string;
  numericCode: string;
  /** Natureza da operação (natOp), como "Venda de mercadoria". */
  nature: string;
  direction: 'entrada' | 'saida';
  purpose: keyof typeof NFE_PURPOSES;
  presence: keyof typeof NFE_PRESENCE;
  /** Venda a consumidor final (indFinal)? */
  finalConsumer: boolean;
  /**
   * Chaves das notas referenciadas no cabeçalho (NFref), como a remessa no retorno da venda
   * condicional. Na devolução não vale: a referência vai em cada item (NfeItem.reference).
   */
  references?: string[];
  recipient: NfeRecipient;
  items: NfeItem[];
  transport: {
    freight: keyof typeof NFE_FREIGHT;
    carrier?: {
      cnpj?: string;
      cpf?: string;
      name: string;
      ie?: string;
      address?: string;
      cityName?: string;
      uf?: string;
    };
    volumes?: {
      quantity?: number;
      species?: string;
      brand?: string;
      netKg?: string;
      grossKg?: string;
    }[];
  };
  /** Fatura e duplicatas da venda a prazo. */
  billing?: {
    invoice: { number: string; originalCents: number; discountCents: number };
    installments: { number: string; dueDate: string; amountCents: number }[];
  };
  payments: NfePayment[];
  changeCents?: number;
  /**
   * Contingência SVC (F3-16): a SEFAZ da UF fora do ar, a nota vai à SEFAZ Virtual de
   * Contingência que a UF usa (SVC-AN, tpEmis 6, ou SVC-RS, tpEmis 7), com a data e hora da
   * entrada em contingência e a justificativa (MOC, regras B22-60 e B28).
   */
  contingency?: { mode: 'SVC-AN' | 'SVC-RS'; enteredAt: string; reason: string };
  /** Informações de interesse do fisco (infAdFisco) e do contribuinte (infCpl). */
  fiscalInfo?: string;
  additionalInfo?: string;
  appVersion: string;
}

export interface NfeDocument {
  accessKey: string;
  /** XML do elemento <NFe>, sem assinatura. */
  xml: string;
  totalCents: number;
}

const NS = 'http://www.portalfiscal.inf.br/nfe';
const DIRECTION = { entrada: '0', saida: '1' } as const;
/** Destino da operação (idDest) pelo escopo do CFOP. */
const SCOPE_TO_ID_DEST = { interna: '1', interestadual: '2', exterior: '3' } as const;

function destinationOf(input: NfeInput): '1' | '2' {
  const sameUf = input.recipient.address.uf === input.issuer.address.uf;
  const idDest = sameUf ? '1' : '2';
  for (const item of input.items) {
    const group = cfopGroup(item.cfop);
    if (!group) throw new NfeBuildError(`CFOP ${item.cfop} inválido no item ${item.code}.`);
    if (group.direction !== input.direction) {
      throw new NfeBuildError(
        `O CFOP ${item.cfop} é de ${group.direction}, mas a nota é de ${input.direction}.`,
      );
    }
    if (group.scope === 'exterior') {
      throw new NfeBuildError('Operação com o exterior ainda não é emitida pelo Bipaê.');
    }
    if (SCOPE_TO_ID_DEST[group.scope] !== idDest) {
      throw new NfeBuildError(
        `O CFOP ${item.cfop} é de operação ${group.scope}, mas o destinatário está ${sameUf ? 'no mesmo estado' : 'em outro estado'}.`,
      );
    }
  }
  return idDest;
}

function checkRecipient(input: NfeInput) {
  const r = input.recipient;
  if (!r.cpf === !r.cnpj)
    throw new NfeBuildError('Informe o CPF ou o CNPJ do destinatário (só um).');
  if (r.ieIndicator === 1 && !r.ie) {
    throw new NfeBuildError('Destinatário contribuinte do ICMS precisa da inscrição estadual.');
  }
  if (r.ieIndicator !== 1 && r.ie) {
    throw new NfeBuildError(
      'Só o destinatário contribuinte (indicador 1) leva inscrição estadual.',
    );
  }
}

export function buildNfe(input: NfeInput): NfeDocument {
  if (input.items.length === 0) throw new NfeBuildError('A NF-e precisa de pelo menos um item.');
  if (input.items.length > 990) throw new NfeBuildError('A NF-e aceita no máximo 990 itens.');
  checkRecipient(input);
  const idDest = destinationOf(input);
  // EC 87/2015: venda interestadual a consumidor final não contribuinte leva a partilha do ICMS
  // (grupo ICMSUFDest) em cada item; em qualquer outra operação o grupo não pode aparecer.
  // O MEI não leva a partilha (NT 2024.001, regra NA01-20).
  const needsDifal =
    input.issuer.crt !== 4 &&
    idDest === '2' &&
    input.finalConsumer &&
    input.recipient.ieIndicator === 9 &&
    input.direction === 'saida';
  assertMeiItems(input.issuer, input.items, '55', {
    isReturn: input.purpose === 'devolucao',
  });
  input.items.forEach((item, index) => {
    if (needsDifal && !item.difal) {
      throw new NfeBuildError(
        `Item ${index + 1}: falta a partilha do ICMS (DIFAL) da venda para consumidor final de outro estado.`,
      );
    }
    if (!needsDifal && item.difal) {
      throw new NfeBuildError(
        `Item ${index + 1}: a partilha do ICMS só vale na venda para consumidor final não contribuinte de outro estado.`,
      );
    }
  });
  const isReturn = input.purpose === 'devolucao';
  const references = input.references ?? [];
  if (isReturn && references.length > 0) {
    throw new NfeBuildError(
      'Na devolução, a nota devolvida vai em cada item, não no cabeçalho (NT 2025.002, regra VC02-14).',
    );
  }
  for (const key of references) {
    if (!ACCESS_KEY.test(key)) throw new NfeBuildError(`Chave referenciada inválida: ${key}.`);
  }
  checkItemReferences(input, isReturn);
  const contingency = input.contingency;
  const emissionType = contingency ? (contingency.mode === 'SVC-AN' ? 6 : 7) : 1;
  if (contingency) {
    const reason = contingency.reason.trim();
    if (reason.length < 15 || reason.length > 256) {
      throw new NfeBuildError(
        'A justificativa da contingência precisa ter de 15 a 256 caracteres.',
      );
    }
    // A entrada em contingência não pode ser depois da emissão (regra B28-40).
    if (new Date(contingency.enteredAt) > new Date(input.issuedAt)) {
      throw new NfeBuildError('A entrada em contingência não pode ser depois da emissão da nota.');
    }
  }
  const accessKey = buildAccessKey({
    cUF: input.cUF,
    yearMonth: input.issuedAt.slice(2, 4) + input.issuedAt.slice(5, 7),
    cnpj: input.issuer.cnpj,
    model: '55',
    series: input.series,
    number: input.number,
    emissionType,
    numericCode: input.numericCode,
  });
  const totals = computeTotals(input.items);
  const billing = input.billing;
  if (billing) {
    const net = billing.invoice.originalCents - billing.invoice.discountCents;
    const installments = billing.installments.reduce((total, d) => total + d.amountCents, 0);
    if (installments !== net) {
      throw new NfeBuildError('As parcelas precisam somar o valor líquido da fatura.');
    }
  }
  const presence = NFE_PRESENCE[input.presence];
  const r = input.recipient;
  const a = r.address;
  const t = input.transport;

  const body: XmlNode = [
    el('ide', [
      req('cUF', input.cUF),
      req('cNF', input.numericCode),
      req('natOp', input.nature),
      req('mod', '55'),
      req('serie', input.series),
      req('nNF', input.number),
      req('dhEmi', input.issuedAt),
      opt('dhSaiEnt', input.leavesAt),
      req('tpNF', DIRECTION[input.direction]),
      req('idDest', idDest),
      req('cMunFG', input.issuer.address.cityCode),
      req('tpImp', '1'),
      req('tpEmis', String(emissionType)),
      req('cDV', accessKey.slice(-1)),
      req('tpAmb', '2'),
      req('finNFe', NFE_PURPOSES[input.purpose]),
      req('indFinal', input.finalConsumer ? '1' : '0'),
      req('indPres', presence),
      // Venda não presencial pede o indicador de intermediador; o Bipaê vende sem plataforma.
      ['2', '3', '4', '9'].includes(presence) ? req('indIntermed', '0') : '',
      req('procEmi', '0'),
      req('verProc', input.appVersion),
      contingency ? req('dhCont', contingency.enteredAt) : '',
      contingency ? req('xJust', contingency.reason.trim()) : '',
      references.map((key) => el('NFref', req('refNFe', key))),
    ]),
    emitGroup(input.issuer),
    el('dest', [
      r.cpf ? req('CPF', r.cpf) : req('CNPJ', r.cnpj!),
      req('xNome', r.name),
      el('enderDest', [
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
      req('indIEDest', String(r.ieIndicator)),
      opt('IE', r.ie),
      opt('email', r.email),
    ]),
    input.items.map((item, index) => detGroup(item, index, '55')),
    totalGroup(input.items, totals),
    el('transp', [
      req('modFrete', NFE_FREIGHT[t.freight]),
      t.carrier
        ? el('transporta', [
            t.carrier.cnpj ? req('CNPJ', t.carrier.cnpj) : opt('CPF', t.carrier.cpf),
            req('xNome', t.carrier.name),
            opt('IE', t.carrier.ie),
            opt('xEnder', t.carrier.address),
            opt('xMun', t.carrier.cityName),
            opt('UF', t.carrier.uf),
          ])
        : '',
      (t.volumes ?? []).map((v) =>
        el('vol', [
          opt('qVol', v.quantity),
          opt('esp', v.species),
          opt('marca', v.brand),
          opt('pesoL', v.netKg),
          opt('pesoB', v.grossKg),
        ]),
      ),
    ]),
    billing
      ? el('cobr', [
          el('fat', [
            req('nFat', billing.invoice.number),
            req('vOrig', money(billing.invoice.originalCents)),
            req('vDesc', money(billing.invoice.discountCents)),
            req('vLiq', money(billing.invoice.originalCents - billing.invoice.discountCents)),
          ]),
          billing.installments.map((d) =>
            el('dup', [
              req('nDup', d.number),
              req('dVenc', d.dueDate),
              req('vDup', money(d.amountCents)),
            ]),
          ),
        ])
      : '',
    // Os itens vêm antes: um erro no item é mais útil que a soma dos pagamentos não bater.
    pagGroup(input.payments, input.changeCents, totals.vNF, input.issuedAt.slice(0, 10)),
    infAdicGroup(input.fiscalInfo, input.additionalInfo),
  ];
  const xml = el('NFe', el('infNFe', body, { Id: `NFe${accessKey}`, versao: '4.00' }), {
    xmlns: NS,
  });
  return { accessKey, xml, totalCents: totals.vNF };
}
