import { el } from '../nfce/xml';
import { descendant, findAll, parseXml, textOf, type XmlElement } from '../xml-reader';
import {
  SefazMessageError,
  sefazUrl,
  ufCode,
  type SefazEndpoint,
  type SefazRequest,
} from './messages';
import { SefazResponseError } from './responses';

/**
 * Eventos da NFC-e e da NF-e e inutilização de numeração (F3-17), conforme o MOC 7.0 (itens 5.3,
 * 5.8 e 5.9) e os schemas oficiais: Evento_Canc e Evento_CancSubst (NT 2018.004) e o PL_009q.
 * Só homologação (tpAmb 2, regra 4 do projeto).
 *
 * Prazos (regra da rejeição 501): cancelamento normal até 24 horas da autorização; cancelamento
 * por substituição (só NFC-e) até 168 horas. A UF pode reduzir por lei estadual.
 */
const NFE_NS = 'http://www.portalfiscal.inf.br/nfe';
const TP_AMB = '2';
const EVENT_NS = `${NFE_NS}/wsdl/NFeRecepcaoEvento4`;
const INUT_NS = `${NFE_NS}/wsdl/NFeInutilizacao4`;

export const CANCEL_WINDOW_HOURS = 24;
export const CANCEL_SUBSTITUTION_WINDOW_HOURS = 168;

export type FiscalEventRequest = SefazRequest;

function soap(
  service: SefazEndpoint,
  ns: string,
  method: string,
  url: string,
  payload: string,
): FiscalEventRequest {
  return {
    service,
    url,
    envelope:
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
      'xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">' +
      `<soap12:Body><nfeDadosMsg xmlns="${ns}">${payload}</nfeDadosMsg></soap12:Body></soap12:Envelope>`,
    contentType: `application/soap+xml; charset=utf-8; action="${ns}/${method}"`,
  };
}

const justification = (text: string) => {
  const value = text.trim();
  if (value.length < 15 || value.length > 255) {
    throw new SefazMessageError('A justificativa precisa ter de 15 a 255 caracteres.');
  }
  return value;
};

const assertKey = (key: string) => {
  if (!/^[0-9A-Z]{44}$/.test(key)) throw new SefazMessageError('Chave de acesso inválida.');
};

/** Evento de cancelamento (110111) ou de cancelamento por substituição (110112), sem assinatura. */
export function buildCancelEvent(input: {
  accessKey: string;
  cnpj: string;
  /** Protocolo de autorização da nota (nProt). */
  protocol: string;
  reason: string;
  /** dhEvento com fuso (AAAA-MM-DDThh:mm:ss-03:00). */
  at: string;
  /** Cancelamento por substituição: a NFC-e de contingência que acobertou a venda. */
  substitutedBy?: { accessKey: string; appVersion: string };
}): string {
  assertKey(input.accessKey);
  if (!/^\d{15}$/.test(input.protocol)) throw new SefazMessageError('Protocolo inválido.');
  const substitution = input.substitutedBy;
  if (substitution) {
    assertKey(substitution.accessKey);
    if (input.accessKey.slice(20, 22) !== '65') {
      throw new SefazMessageError('O cancelamento por substituição é só da NFC-e.');
    }
  }
  const type = substitution ? '110112' : '110111';
  const cUF = input.accessKey.slice(0, 2);
  const detail = substitution
    ? [
        el('descEvento', 'Cancelamento por substituicao'),
        el('cOrgaoAutor', cUF),
        el('tpAutor', '1'),
        el('verAplic', substitution.appVersion),
        el('nProt', input.protocol),
        el('xJust', justification(input.reason)),
        el('chNFeRef', substitution.accessKey),
      ]
    : [
        el('descEvento', 'Cancelamento'),
        el('nProt', input.protocol),
        el('xJust', justification(input.reason)),
      ];
  return el(
    'evento',
    el(
      'infEvento',
      [
        el('cOrgao', cUF),
        el('tpAmb', TP_AMB),
        el('CNPJ', input.cnpj),
        el('chNFe', input.accessKey),
        el('dhEvento', input.at),
        el('tpEvento', type),
        el('nSeqEvento', '1'),
        el('verEvento', '1.00'),
        el('detEvento', detail, { versao: '1.00' }),
      ],
      { Id: `ID${type}${input.accessKey}01` },
    ),
    { xmlns: NFE_NS, versao: '1.00' },
  );
}

/** Lote de eventos (envEvento) para o serviço de recepção de eventos da UF. */
export function eventRequest(input: {
  model: '55' | '65';
  uf: string;
  batchId: string;
  signedEvents: string[];
}): FiscalEventRequest {
  if (!/^\d{1,15}$/.test(input.batchId)) throw new SefazMessageError('Número do lote inválido.');
  for (const xml of input.signedEvents) {
    if (!/<Signature[\s>]/.test(xml)) throw new SefazMessageError('Evento sem assinatura.');
  }
  const payload =
    `<envEvento xmlns="${NFE_NS}" versao="1.00">${el('idLote', input.batchId)}` +
    `${input.signedEvents.join('')}</envEvento>`;
  return soap(
    'RecepcaoEvento',
    EVENT_NS,
    'nfeRecepcaoEvento',
    sefazUrl(input.model, input.uf, 'RecepcaoEvento'),
    payload,
  );
}

/** Pedido de inutilização de uma faixa de números (inutNFe), sem assinatura. */
export function buildInutilization(input: {
  uf: string;
  /** Ano (2 dígitos) da emissão dos números a inutilizar. */
  year: string;
  cnpj: string;
  model: '55' | '65';
  series: number;
  from: number;
  to: number;
  reason: string;
}): string {
  if (!/^\d{2}$/.test(input.year)) throw new SefazMessageError('Ano inválido (2 dígitos).');
  if (input.series < 0 || input.series > 999) throw new SefazMessageError('Série inválida.');
  if (input.from < 1 || input.to < input.from || input.to > 999_999_999) {
    throw new SefazMessageError('Faixa de números inválida.');
  }
  const cUF = ufCode(input.uf);
  const series = String(input.series).padStart(3, '0');
  const id =
    `ID${cUF}${input.year}${input.cnpj}${input.model}${series}` +
    `${String(input.from).padStart(9, '0')}${String(input.to).padStart(9, '0')}`;
  return el(
    'inutNFe',
    el(
      'infInut',
      [
        el('tpAmb', TP_AMB),
        el('xServ', 'INUTILIZAR'),
        el('cUF', cUF),
        el('ano', input.year),
        el('CNPJ', input.cnpj),
        el('mod', input.model),
        el('serie', String(input.series)),
        el('nNFIni', String(input.from)),
        el('nNFFin', String(input.to)),
        el('xJust', justification(input.reason)),
      ],
      { Id: id },
    ),
    { xmlns: NFE_NS, versao: '4.00' },
  );
}

export function inutilizationRequest(input: {
  model: '55' | '65';
  uf: string;
  signedXml: string;
}): FiscalEventRequest {
  if (!/<Signature[\s>]/.test(input.signedXml)) {
    throw new SefazMessageError('Pedido de inutilização sem assinatura.');
  }
  return soap(
    'NFeInutilizacao',
    INUT_NS,
    'nfeInutilizacaoNF',
    sefazUrl(input.model, input.uf, 'NFeInutilizacao'),
    input.signedXml,
  );
}

// ---------------------------------------------------------------- retornos

/** 135 registrado e vinculado; 136 registrado sem vínculo; 155 cancelamento fora de prazo. */
const EVENT_REGISTERED = new Set(['135', '136', '155']);

export interface FiscalEventResult {
  cStat: string;
  xMotivo: string;
  registered: boolean;
  protocol?: string;
  registeredAt?: string;
  /** O retEvento como veio, para guardar com o evento (procEventoNFe). */
  xml: string;
}

function root(responseXml: string, tag: string): XmlElement {
  let parsed: XmlElement;
  try {
    parsed = parseXml(responseXml);
  } catch {
    throw new SefazResponseError('A SEFAZ devolveu uma resposta que não é XML.');
  }
  const fault = descendant(parsed, 'Fault');
  if (fault) {
    const reason = descendant(fault, 'Text')?.text ?? 'sem motivo';
    throw new SefazResponseError(`A SEFAZ recusou a mensagem (SOAP Fault): ${reason.trim()}`);
  }
  const found = descendant(parsed, tag);
  if (!found) throw new SefazResponseError(`A resposta da SEFAZ não traz ${tag}.`);
  return found;
}

/** Resultado do primeiro evento do lote (o Bipaê manda um evento por lote). */
export function parseEventResponse(responseXml: string): FiscalEventResult {
  const ret = root(responseXml, 'retEnvEvento');
  const [event] = findAll(ret, 'retEvento');
  if (!event) {
    return {
      cStat: textOf(ret, 'cStat') ?? '',
      xMotivo: textOf(ret, 'xMotivo') ?? '',
      registered: false,
      xml: '',
    };
  }
  const info = descendant(event, 'infEvento');
  const cStat = textOf(info, 'cStat') ?? '';
  const raw = /<(?:\w+:)?retEvento[\s>][\s\S]*?<\/(?:\w+:)?retEvento>/.exec(responseXml)?.[0] ?? '';
  return {
    cStat,
    xMotivo: textOf(info, 'xMotivo') ?? '',
    registered: EVENT_REGISTERED.has(cStat),
    ...(textOf(info, 'nProt') && { protocol: textOf(info, 'nProt') }),
    ...(textOf(info, 'dhRegEvento') && { registeredAt: textOf(info, 'dhRegEvento') }),
    xml: raw,
  };
}

/** 102 = inutilização de número homologada. */
export function parseInutilizationResponse(responseXml: string): FiscalEventResult {
  const info = descendant(root(responseXml, 'retInutNFe'), 'infInut');
  const cStat = textOf(info, 'cStat') ?? '';
  const raw =
    /<(?:\w+:)?retInutNFe[\s>][\s\S]*?<\/(?:\w+:)?retInutNFe>/.exec(responseXml)?.[0] ?? '';
  return {
    cStat,
    xMotivo: textOf(info, 'xMotivo') ?? '',
    registered: cStat === '102',
    ...(textOf(info, 'nProt') && { protocol: textOf(info, 'nProt') }),
    ...(textOf(info, 'dhRecbto') && { registeredAt: textOf(info, 'dhRecbto') }),
    xml: raw,
  };
}
