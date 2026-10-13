import { descendant, findAll, parseXml, textOf, type XmlElement } from '../xml-reader';

/**
 * Leitura dos retornos da SEFAZ (MOC 7.0, item 5) e montagem do XML autorizado (nfeProc).
 * O que cada código de situação (cStat) significa para o Bipaê fica na tabela SEFAZ_OUTCOMES.
 */
export class SefazResponseError extends Error {}

export type SefazOutcome =
  'authorized' | 'denied' | 'processing' | 'batch-processed' | 'online' | 'offline' | 'rejected';

/** Situações do MOC 7.0 que mudam o caminho da nota; qualquer outra é rejeição. */
const SEFAZ_OUTCOMES: Record<string, SefazOutcome> = {
  '100': 'authorized', // Autorizado o uso da NF-e
  '150': 'authorized', // Autorizado o uso da NF-e, autorização fora de prazo
  '110': 'denied', // Uso denegado
  '205': 'denied', // NF-e está denegada na base de dados da SEFAZ
  '301': 'denied', // Uso denegado: irregularidade fiscal do emitente
  '302': 'denied', // Uso denegado: irregularidade fiscal do destinatário
  '303': 'denied', // Uso denegado: destinatário não habilitado a operar na UF
  '103': 'processing', // Lote recebido com sucesso
  '105': 'processing', // Lote em processamento
  '104': 'batch-processed', // Lote processado
  '107': 'online', // Serviço em operação
  '108': 'offline', // Serviço paralisado momentaneamente
  '109': 'offline', // Serviço paralisado sem previsão
};

export function sefazOutcome(cStat: string): SefazOutcome {
  return SEFAZ_OUTCOMES[cStat] ?? 'rejected';
}

export interface SefazProtocol {
  accessKey: string;
  cStat: string;
  xMotivo: string;
  outcome: SefazOutcome;
  /** Número do protocolo (só quando autorizada ou denegada). */
  number?: string;
  receivedAt?: string;
  /** O elemento protNFe como veio, para guardar no nfeProc. */
  xml: string;
}

export interface SefazStatusResult {
  cStat: string;
  xMotivo: string;
  online: boolean;
  receivedAt?: string;
  averageSeconds?: number;
  observation?: string;
}

export interface SefazBatchResult {
  cStat: string;
  xMotivo: string;
  outcome: SefazOutcome;
  receivedAt?: string;
  /** Recibo do lote, quando o processamento não foi síncrono. */
  receipt?: string;
  averageSeconds?: number;
  protocols: SefazProtocol[];
}

export interface SefazConsultResult {
  cStat: string;
  xMotivo: string;
  outcome: SefazOutcome;
  protocol?: SefazProtocol;
}

/** O retorno dentro do envelope SOAP; falha SOAP vira erro com o motivo. */
function resultOf(responseXml: string, expected: string): XmlElement {
  let root: XmlElement;
  try {
    root = parseXml(responseXml);
  } catch {
    throw new SefazResponseError('A SEFAZ devolveu uma resposta que não é XML.');
  }
  const fault = descendant(root, 'Fault');
  if (fault) {
    const reason =
      descendant(fault, 'Text')?.text ?? descendant(fault, 'faultstring')?.text ?? 'sem motivo';
    throw new SefazResponseError(`A SEFAZ recusou a mensagem (SOAP Fault): ${reason.trim()}`);
  }
  const result = descendant(root, expected);
  if (!result) throw new SefazResponseError(`A resposta da SEFAZ não traz ${expected}.`);
  return result;
}

const required = (node: XmlElement, tag: string) => {
  const value = textOf(node, tag);
  if (value === undefined) throw new SefazResponseError(`A resposta da SEFAZ não traz ${tag}.`);
  return value;
};

/** Os protNFe da resposta, como texto, na mesma ordem dos elementos lidos. */
function rawProtocols(responseXml: string): string[] {
  return [...responseXml.matchAll(/<(?:\w+:)?protNFe[\s>][\s\S]*?<\/(?:\w+:)?protNFe>/g)].map(
    (m) => m[0],
  );
}

function protocols(responseXml: string, parent: XmlElement): SefazProtocol[] {
  const raw = rawProtocols(responseXml);
  return findAll(parent, 'protNFe').map((prot, i) => {
    const inf = descendant(prot, 'infProt');
    if (!inf) throw new SefazResponseError('Protocolo da SEFAZ sem infProt.');
    const cStat = required(inf, 'cStat');
    return {
      accessKey: required(inf, 'chNFe'),
      cStat,
      xMotivo: required(inf, 'xMotivo'),
      outcome: sefazOutcome(cStat),
      ...(textOf(inf, 'nProt') && { number: textOf(inf, 'nProt') }),
      ...(textOf(inf, 'dhRecbto') && { receivedAt: textOf(inf, 'dhRecbto') }),
      xml: raw[i] ?? '',
    };
  });
}

const seconds = (node: XmlElement, tag: string) => {
  const value = textOf(node, tag);
  return value !== undefined && /^\d+$/.test(value) ? { averageSeconds: Number(value) } : {};
};

export function parseStatusResponse(responseXml: string): SefazStatusResult {
  const ret = resultOf(responseXml, 'retConsStatServ');
  const cStat = required(ret, 'cStat');
  return {
    cStat,
    xMotivo: required(ret, 'xMotivo'),
    online: sefazOutcome(cStat) === 'online',
    ...(textOf(ret, 'dhRecbto') && { receivedAt: textOf(ret, 'dhRecbto') }),
    ...seconds(ret, 'tMed'),
    ...(textOf(ret, 'xObs') && { observation: textOf(ret, 'xObs') }),
  };
}

/** Retorno do envio do lote (retEnviNFe) ou da consulta do recibo (retConsReciNFe). */
export function parseBatchResponse(responseXml: string): SefazBatchResult {
  const ret = /retConsReciNFe/.test(responseXml)
    ? resultOf(responseXml, 'retConsReciNFe')
    : resultOf(responseXml, 'retEnviNFe');
  const cStat = required(ret, 'cStat');
  const receipt = textOf(ret, 'infRec/nRec') ?? textOf(ret, 'nRec');
  const infRec = descendant(ret, 'infRec');
  return {
    cStat,
    xMotivo: required(ret, 'xMotivo'),
    outcome: sefazOutcome(cStat),
    ...(textOf(ret, 'dhRecbto') && { receivedAt: textOf(ret, 'dhRecbto') }),
    ...(receipt && { receipt }),
    ...(infRec ? seconds(infRec, 'tMed') : {}),
    protocols: protocols(responseXml, ret),
  };
}

export function parseConsultResponse(responseXml: string): SefazConsultResult {
  const ret = resultOf(responseXml, 'retConsSitNFe');
  const cStat = required(ret, 'cStat');
  const [protocol] = protocols(responseXml, ret);
  return {
    cStat,
    xMotivo: required(ret, 'xMotivo'),
    outcome: sefazOutcome(cStat),
    ...(protocol && { protocol }),
  };
}

/** XML autorizado para guardar e entregar ao destinatário: a nota assinada e o protocolo. */
export function buildNfeProc(signedNfeXml: string, protocol: SefazProtocol): string {
  if (protocol.outcome !== 'authorized' && protocol.outcome !== 'denied') {
    throw new SefazResponseError(
      `A nota não foi autorizada: ${protocol.cStat} - ${protocol.xMotivo}`,
    );
  }
  const nfe = signedNfeXml.replace(/^\s*<\?xml[^>]*\?>\s*/, '');
  const key = /Id="NFe([0-9A-Z]{44})"/.exec(nfe)?.[1];
  if (key !== protocol.accessKey) throw new SefazResponseError('O protocolo não é desta nota.');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">${nfe}${protocol.xml}</nfeProc>`
  );
}
