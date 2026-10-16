import { buildAccessKey } from './access-key';
import { contingencyQrPayload, nfceSupplement } from './qrcode';
import { signText, type NfeSigner, type SigningKey } from './sign';
import { el, type XmlNode } from './xml';
import {
  computeTotals,
  detGroup,
  emitGroup,
  infAdicGroup,
  assertMeiItems,
  NfeBuildError,
  pagGroup,
  totalGroup,
  req,
  type NfeIssuer,
  type NfeItem,
  type NfePayment,
} from '../nfe/groups';

/**
 * XML da NFC-e (modelo 65, leiaute 4.00 com os grupos da Reforma), a partir dos dados da venda e
 * dos impostos já calculados pelo motor. Sai sem assinatura: a assinatura com o certificado é
 * outra etapa (F3-09). Só homologação (tpAmb = 2): produção exige pedido explícito do dono do
 * projeto (regra 4 do CLAUDE.md), e por isso nem existe opção para isso aqui.
 */
export type NfceIssuer = NfeIssuer;
export type NfceItem = NfeItem;
export type NfcePayment = NfePayment;
export { NfeBuildError as NfceBuildError };

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
  /**
   * Contingência off-line (tpEmis 9, F3-15): quando entrou em contingência (dhCont), o motivo
   * (xJust, 15 a 256 caracteres) e a assinatura RSA-SHA1 dos parâmetros do QR Code versão 3,
   * feita com o mesmo certificado da nota (veja `buildContingencyNfce`).
   */
  contingency?: { enteredAt: string; reason: string; qrSignature: string };
  /**
   * Entrega a domicílio (F5-10, dúvida D-032): indPres 4, endereço do destinatário, frete por
   * conta do remetente e o transportador (rejeições 753, 786, 787 e 788 do MOC 7.0). O frete de
   * cada item vem em `freightCents`.
   */
  delivery?: {
    address: {
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
    carrier: { cnpj?: string; cpf?: string; name: string };
  };
}

export interface NfceDocument {
  accessKey: string;
  /** Conteúdo do QR Code e URL de consulta pela chave, que também vão no DANFE. */
  qrCode: string;
  urlChave: string;
  /** XML do elemento <NFe>, sem assinatura. */
  xml: string;
  totalCents: number;
}

const NS = 'http://www.portalfiscal.inf.br/nfe';

export function buildNfce(input: NfceInput): NfceDocument {
  if (input.items.length === 0) throw new NfeBuildError('A NFC-e precisa de pelo menos um item.');
  if (input.items.length > 990) throw new NfeBuildError('A NFC-e aceita no máximo 990 itens.');
  assertMeiItems(input.issuer, input.items, '65');
  const accessKey = buildAccessKey({
    cUF: input.cUF,
    yearMonth: input.issuedAt.slice(2, 4) + input.issuedAt.slice(5, 7),
    cnpj: input.issuer.cnpj,
    model: '65',
    series: input.series,
    number: input.number,
    emissionType: input.contingency ? 9 : 1,
    numericCode: input.numericCode,
  });
  const totals = computeTotals(input.items);
  const customer = input.customer;
  const delivery = input.delivery;
  if (delivery && !customer?.cpf && !customer?.cnpj) {
    throw new NfeBuildError('A NFC-e de entrega a domicílio precisa do CPF ou CNPJ do cliente.');
  }
  if (!delivery && totals.vFrete > 0) {
    throw new NfeBuildError('A NFC-e só leva frete quando é entrega a domicílio (rejeição 753).');
  }
  if (input.contingency) {
    const reason = input.contingency.reason.trim();
    if (reason.length < 15 || reason.length > 256) {
      throw new NfeBuildError(
        'A justificativa da contingência precisa ter de 15 a 256 caracteres.',
      );
    }
  }
  const supplement = nfceSupplement({
    uf: input.issuer.address.uf,
    accessKey,
    environment: 'homologacao',
    ...(input.contingency && {
      offline: {
        payload: contingencyQrPayload({
          accessKey,
          issuedAt: input.issuedAt,
          totalCents: totals.vNF,
          customer,
        }),
        signature: input.contingency.qrSignature,
      },
    }),
  });
  const body: XmlNode = [
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
      req('cMunFG', input.issuer.address.cityCode),
      req('tpImp', '4'),
      req('tpEmis', input.contingency ? '9' : '1'),
      req('cDV', accessKey.slice(-1)),
      req('tpAmb', '2'),
      req('finNFe', '1'),
      req('indFinal', '1'),
      req('indPres', delivery ? '4' : '1'),
      // Entrega a domicílio pede o indicador de intermediador; o Bipaê vende sem plataforma.
      delivery ? req('indIntermed', '0') : '',
      req('procEmi', '0'),
      req('verProc', input.appVersion),
      input.contingency ? req('dhCont', input.contingency.enteredAt) : '',
      input.contingency ? req('xJust', input.contingency.reason.trim()) : '',
    ]),
    emitGroup(input.issuer),
    customer?.cpf || customer?.cnpj
      ? el('dest', [
          customer.cpf ? req('CPF', customer.cpf) : req('CNPJ', customer.cnpj!),
          customer.name ? req('xNome', customer.name) : '',
          delivery
            ? el('enderDest', [
                req('xLgr', delivery.address.street),
                req('nro', delivery.address.number),
                delivery.address.complement ? req('xCpl', delivery.address.complement) : '',
                req('xBairro', delivery.address.district),
                req('cMun', delivery.address.cityCode),
                req('xMun', delivery.address.cityName),
                req('UF', delivery.address.uf),
                delivery.address.cep ? req('CEP', delivery.address.cep) : '',
                req('cPais', '1058'),
                req('xPais', 'Brasil'),
                delivery.address.phone ? req('fone', delivery.address.phone) : '',
              ])
            : '',
          req('indIEDest', '9'),
        ])
      : '',
    input.items.map((item, index) => detGroup(item, index, '65')),
    totalGroup(input.items, totals),
    delivery
      ? el('transp', [
          // Frete por conta do remetente: a loja cobra a taxa e entrega.
          req('modFrete', '0'),
          el('transporta', [
            delivery.carrier.cnpj
              ? req('CNPJ', delivery.carrier.cnpj)
              : req('CPF', delivery.carrier.cpf ?? ''),
            req('xNome', delivery.carrier.name),
          ]),
        ])
      : el('transp', req('modFrete', '9')),
    // Os itens vêm antes: um erro no item é mais útil que a soma dos pagamentos não bater.
    pagGroup(input.payments, input.changeCents, totals.vNF, input.issuedAt.slice(0, 10)),
    infAdicGroup(undefined, input.additionalInfo),
  ];
  const xml = el(
    'NFe',
    [
      el('infNFe', body, { Id: `NFe${accessKey}`, versao: '4.00' }),
      el('infNFeSupl', [req('qrCode', supplement.qrCode), req('urlChave', supplement.urlChave)]),
    ],
    { xmlns: NS },
  );
  return { accessKey, xml, totalCents: totals.vNF, ...supplement };
}

/**
 * NFC-e em contingência off-line já com o QR Code assinado (F3-15): monta uma vez para saber a
 * chave (que leva o tpEmis 9) e o total, assina os parâmetros do QR Code com o certificado e
 * monta de novo. Depois, o XML ainda é assinado com `signNfe`, como a nota normal.
 */
export async function buildContingencyNfce(
  input: Omit<NfceInput, 'contingency'> & { contingency: { enteredAt: string; reason: string } },
  key: SigningKey | NfeSigner,
): Promise<NfceDocument> {
  const draft = buildNfce({ ...input, contingency: { ...input.contingency, qrSignature: '-' } });
  const payload = contingencyQrPayload({
    accessKey: draft.accessKey,
    issuedAt: input.issuedAt,
    totalCents: draft.totalCents,
    customer: input.customer ?? null,
  });
  const qrSignature = await signText(payload, key);
  return buildNfce({ ...input, contingency: { ...input.contingency, qrSignature } });
}
