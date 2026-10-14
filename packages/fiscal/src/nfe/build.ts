import { cfopGroup } from '../tables/cfop';
import { buildAccessKey } from '../nfce/access-key';
import { el, opt, type XmlNode } from '../nfce/xml';
import {
  computeTotals,
  detGroup,
  emitGroup,
  infAdicGroup,
  money,
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
  /** Chaves das notas referenciadas (obrigatória na devolução). */
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
  const needsDifal =
    idDest === '2' &&
    input.finalConsumer &&
    input.recipient.ieIndicator === 9 &&
    input.direction === 'saida';
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
  const references = input.references ?? [];
  if (input.purpose === 'devolucao' && references.length === 0) {
    throw new NfeBuildError('A nota de devolução precisa da chave da nota devolvida.');
  }
  for (const key of references) {
    if (!/^\d{44}$|^[0-9A-Z]{44}$/.test(key))
      throw new NfeBuildError(`Chave referenciada inválida: ${key}.`);
  }
  const accessKey = buildAccessKey({
    cUF: input.cUF,
    yearMonth: input.issuedAt.slice(2, 4) + input.issuedAt.slice(5, 7),
    cnpj: input.issuer.cnpj,
    model: '55',
    series: input.series,
    number: input.number,
    emissionType: 1,
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
      req('tpEmis', '1'),
      req('cDV', accessKey.slice(-1)),
      req('tpAmb', '2'),
      req('finNFe', NFE_PURPOSES[input.purpose]),
      req('indFinal', input.finalConsumer ? '1' : '0'),
      req('indPres', presence),
      // Venda não presencial pede o indicador de intermediador; o Bipaê vende sem plataforma.
      ['2', '3', '4', '9'].includes(presence) ? req('indIntermed', '0') : '',
      req('procEmi', '0'),
      req('verProc', input.appVersion),
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
