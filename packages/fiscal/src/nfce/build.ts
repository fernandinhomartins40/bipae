import { buildAccessKey } from './access-key';
import { nfceSupplement } from './qrcode';
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
    emissionType: 1,
    numericCode: input.numericCode,
  });
  const totals = computeTotals(input.items);
  const supplement = nfceSupplement({
    uf: input.issuer.address.uf,
    accessKey,
    environment: 'homologacao',
  });
  const customer = input.customer;
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
      req('tpEmis', '1'),
      req('cDV', accessKey.slice(-1)),
      req('tpAmb', '2'),
      req('finNFe', '1'),
      req('indFinal', '1'),
      req('indPres', '1'),
      req('procEmi', '0'),
      req('verProc', input.appVersion),
    ]),
    emitGroup(input.issuer),
    customer?.cpf || customer?.cnpj
      ? el('dest', [
          customer.cpf ? req('CPF', customer.cpf) : req('CNPJ', customer.cnpj!),
          customer.name ? req('xNome', customer.name) : '',
          req('indIEDest', '9'),
        ])
      : '',
    input.items.map((item, index) => detGroup(item, index, '65')),
    totalGroup(input.items, totals),
    el('transp', req('modFrete', '9')),
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
