import {
  decimalTextToCents,
  PurchaseXmlError,
  readNfeItem,
  readNfeParty,
  type PurchaseItem,
  type PurchaseParty,
} from '../purchase/read';
import { descendant, find, findAll, parseXml, textOf, type XmlElement } from '../xml-reader';

/**
 * NFC-e autorizada (nfeProc) lida de volta (MF-08): é o que se manda ao MercadoFlow, porque é
 * exatamente o que a SEFAZ autorizou. Dinheiro em centavos; quantidade e preço unitário como
 * texto decimal, como estão no XML.
 */
export interface SaleNfce {
  accessKey: string;
  number: number;
  series: number;
  /** dhEmi, com fuso. */
  issuedAt: string;
  environment: 'producao' | 'homologacao';
  /** Emitida em contingência off-line (tpEmis 9). */
  contingency: boolean;
  issuer: PurchaseParty;
  /** CPF ou CNPJ do consumidor, quando informado. */
  recipientTaxId?: string;
  items: PurchaseItem[];
  totalCents: number;
  protocol: { number: string; receivedAt: string; cStat: string };
}

export function readSaleNfce(xml: string): SaleNfce {
  let root: XmlElement;
  try {
    root = parseXml(xml);
  } catch {
    throw new PurchaseXmlError('O arquivo não é um XML válido.');
  }
  if (root.name !== 'nfeProc') {
    throw new PurchaseXmlError('Só a NFC-e autorizada (com o protocolo) pode ser lida aqui.');
  }
  const inf = find(find(root, 'NFe'), 'infNFe');
  const ide = find(inf, 'ide');
  if (!inf || textOf(ide, 'mod') !== '65') {
    throw new PurchaseXmlError('O arquivo não é o XML de uma NFC-e.');
  }
  const infProt = descendant(find(root, 'protNFe'), 'infProt');
  const protocol = textOf(infProt, 'nProt');
  if (!protocol) throw new PurchaseXmlError('A NFC-e não traz o protocolo de autorização.');
  const dest = find(inf, 'dest');
  const recipientTaxId = textOf(dest, 'CPF') ?? textOf(dest, 'CNPJ');
  return {
    accessKey: (inf.attrs.Id ?? '').replace(/^NFe/, ''),
    number: Number(textOf(ide, 'nNF')),
    series: Number(textOf(ide, 'serie')),
    issuedAt: textOf(ide, 'dhEmi') ?? '',
    environment: textOf(ide, 'tpAmb') === '1' ? 'producao' : 'homologacao',
    contingency: textOf(ide, 'tpEmis') === '9',
    issuer: readNfeParty(find(inf, 'emit'), 'enderEmit'),
    ...(recipientTaxId && { recipientTaxId }),
    items: findAll(inf, 'det').map(readNfeItem),
    totalCents: decimalTextToCents(textOf(inf, 'total/ICMSTot/vNF')),
    protocol: {
      number: protocol,
      receivedAt: textOf(infProt, 'dhRecbto') ?? '',
      cStat: textOf(infProt, 'cStat') ?? '',
    },
  };
}
