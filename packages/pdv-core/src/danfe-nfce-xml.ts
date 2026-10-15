import {
  dec,
  decimalTextToCents,
  descendant,
  find,
  findAll,
  parseXml,
  textOf,
  type XmlElement,
} from '@bipae/fiscal';
import { findPaymentMeans } from '@bipae/fiscal/tables';
import type { DanfeNfceData } from './danfe-nfce';

/**
 * Dados do DANFE da NFC-e lidos do XML autorizado (nfeProc) que o servidor guardou (F3-14.c):
 * a impressão e a reimpressão saem sempre do que a SEFAZ autorizou, não do carrinho.
 */
export class DanfeXmlError extends Error {}

const cents = (node: XmlElement | null, path: string) => decimalTextToCents(textOf(node, path));
const milli = (value: string | undefined) =>
  dec(value ?? '0')
    .mul(1000)
    .toDecimalPlaces(0)
    .toNumber();

export function danfeNfceFromXml(xml: string): DanfeNfceData {
  let root: XmlElement;
  try {
    root = parseXml(xml);
  } catch {
    throw new DanfeXmlError('O XML da nota não pôde ser lido.');
  }
  const inf = descendant(root, 'infNFe');
  if (!inf || textOf(inf, 'ide/mod') !== '65') throw new DanfeXmlError('O XML não é de uma NFC-e.');
  const emit = find(inf, 'emit');
  const address = find(emit, 'enderEmit');
  const total = find(inf, 'total/ICMSTot');
  const dest = find(inf, 'dest');
  const supl = descendant(root, 'infNFeSupl');
  const prot = descendant(root, 'infProt');
  const date = (textOf(inf, 'ide/dhEmi') ?? '').slice(0, 10);
  const consumerId = textOf(dest, 'CPF') ?? textOf(dest, 'CNPJ') ?? textOf(dest, 'idEstrangeiro');
  return {
    environment: textOf(inf, 'ide/tpAmb') === '1' ? 'producao' : 'homologacao',
    emitter: {
      cnpj: textOf(emit, 'CNPJ') ?? '',
      legalName: textOf(emit, 'xNome') ?? '',
      address: [
        [textOf(address, 'xLgr'), textOf(address, 'nro')].filter(Boolean).join(', '),
        textOf(address, 'xBairro'),
        [textOf(address, 'xMun'), textOf(address, 'UF')].filter(Boolean).join(' - '),
      ]
        .filter(Boolean)
        .join(', '),
    },
    items: findAll(inf, 'det').map((det) => {
      const prod = find(det, 'prod');
      return {
        code: textOf(prod, 'cProd') ?? '',
        description: textOf(prod, 'xProd') ?? '',
        quantityMilli: milli(textOf(prod, 'qCom')),
        unit: textOf(prod, 'uCom') ?? '',
        unitPriceCents: cents(prod, 'vUnCom'),
        totalCents: cents(prod, 'vProd'),
      };
    }),
    surchargeCents: cents(total, 'vFrete') + cents(total, 'vSeg') + cents(total, 'vOutro'),
    discountCents: cents(total, 'vDesc'),
    totalCents: cents(total, 'vNF'),
    payments: findAll(find(inf, 'pag'), 'detPag').map((p) => {
      const code = textOf(p, 'tPag') ?? '99';
      return {
        label: textOf(p, 'xPag') ?? findPaymentMeans(code, date)?.description ?? 'Outros',
        amountCents: cents(p, 'vPag'),
      };
    }),
    changeCents: cents(find(inf, 'pag'), 'vTroco'),
    consumer: consumerId
      ? {
          kind: textOf(dest, 'CPF') ? 'cpf' : textOf(dest, 'CNPJ') ? 'cnpj' : 'estrangeiro',
          id: consumerId,
          ...(textOf(dest, 'xNome') && { name: textOf(dest, 'xNome') }),
        }
      : null,
    number: Number(textOf(inf, 'ide/nNF') ?? 0),
    series: Number(textOf(inf, 'ide/serie') ?? 0),
    issuedAt: textOf(inf, 'ide/dhEmi') ?? '',
    protocol:
      prot && textOf(prot, 'nProt')
        ? { number: textOf(prot, 'nProt')!, receivedAt: textOf(prot, 'dhRecbto') ?? '' }
        : null,
    contingency: (textOf(inf, 'ide/tpEmis') ?? '1') !== '1',
    accessKey: (inf.attrs.Id ?? '').replace(/^NFe/, ''),
    urlChave: textOf(supl, 'urlChave') ?? '',
    qrCode: textOf(supl, 'qrCode') ?? '',
    ...(textOf(inf, 'infAdic/infAdFisco') && {
      fiscalMessage: textOf(inf, 'infAdic/infAdFisco'),
    }),
    ...(textOf(inf, 'infAdic/infCpl') && { taxpayerMessage: textOf(inf, 'infAdic/infCpl') }),
    ...(textOf(total, 'vTotTrib') && { approximateTaxesCents: cents(total, 'vTotTrib') }),
  };
}
