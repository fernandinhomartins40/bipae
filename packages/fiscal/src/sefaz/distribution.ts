import { el } from '../nfce/xml';
import { NFE_NATIONAL_ENDPOINTS } from '../tables/nfe-endpoints';
import { descendant, findAll, parseXml, textOf, type XmlElement } from '../xml-reader';
import { SefazMessageError, ufCode, type SefazRequest } from './messages';
import { SefazResponseError } from './responses';

/**
 * Distribuição de DF-e e manifestação do destinatário (F3-20), pelo Ambiente Nacional, conforme a
 * NT 2014.002 e os pacotes oficiais "Distribuição de DF-e v1.04" e "Evento Manifesta Destinatário
 * v1.01" do Portal Nacional da NF-e. Só homologação (tpAmb 2, regra 4 do projeto).
 *
 * A empresa pergunta ao Ambiente Nacional pelos documentos emitidos contra o CNPJ dela, a partir
 * do último NSU recebido. Chegam resumos (resNFe), notas completas (procNFe) e eventos. Para baixar
 * a nota completa, a empresa registra a ciência da operação (210210); depois confirma (210200),
 * desconhece (210220) ou diz que a operação não foi realizada (210240).
 */
const NFE_NS = 'http://www.portalfiscal.inf.br/nfe';
const TP_AMB = '2';
const DIST_NS = `${NFE_NS}/wsdl/NFeDistribuicaoDFe`;
const EVENT_NS = `${NFE_NS}/wsdl/NFeRecepcaoEvento4`;
/** Código do Ambiente Nacional como órgão do evento (cOrgao). */
const AMBIENTE_NACIONAL = '91';

const onlyDigits = (text: string) => text.replace(/\D/g, '');
const nsu = (value: string | number) => {
  const text = String(value).replace(/\D/g, '');
  if (!text || text.length > 15) throw new SefazMessageError('NSU inválido.');
  return text.padStart(15, '0');
};

export type DistributionQuery =
  { ultNSU: string | number } | { nsu: string | number } | { accessKey: string };

/** Pedido de distribuição (distDFeInt) para o CNPJ ou CPF interessado. */
export function buildDistributionQuery(input: {
  taxId: string;
  /** UF do interessado (cUFAutor). */
  uf: string;
  query: DistributionQuery;
}): string {
  const taxId = input.taxId.replace(/[^0-9A-Z]/gi, '').toUpperCase();
  if (taxId.length !== 11 && taxId.length !== 14) {
    throw new SefazMessageError('Informe o CNPJ ou o CPF do interessado.');
  }
  const q = input.query;
  let group: string;
  if ('accessKey' in q) {
    if (!/^[0-9]{44}$/.test(q.accessKey)) throw new SefazMessageError('Chave de acesso inválida.');
    group = el('consChNFe', el('chNFe', q.accessKey));
  } else if ('nsu' in q) {
    group = el('consNSU', el('NSU', nsu(q.nsu)));
  } else {
    group = el('distNSU', el('ultNSU', nsu(q.ultNSU)));
  }
  return el(
    'distDFeInt',
    [
      el('tpAmb', TP_AMB),
      el('cUFAutor', ufCode(input.uf)),
      el(taxId.length === 11 ? 'CPF' : 'CNPJ', taxId),
      group,
    ],
    { xmlns: NFE_NS, versao: '1.01' },
  );
}

/** Envelope SOAP 1.2 do serviço de distribuição do Ambiente Nacional (homologação). */
export function distributionRequest(queryXml: string): SefazRequest {
  return {
    service: 'NFeDistribuicaoDFe',
    url: NFE_NATIONAL_ENDPOINTS.homologacao.NFeDistribuicaoDFe,
    envelope:
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
      'xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">' +
      `<soap12:Body><nfeDistDFeInteresse xmlns="${DIST_NS}"><nfeDadosMsg>${queryXml}</nfeDadosMsg>` +
      '</nfeDistDFeInteresse></soap12:Body></soap12:Envelope>',
    contentType: `application/soap+xml; charset=utf-8; action="${DIST_NS}/nfeDistDFeInteresse"`,
  };
}

// ---------------------------------------------------------------- manifestação

export const RECIPIENT_EVENTS = {
  confirmacao: { code: '210200', description: 'Confirmacao da Operacao' },
  ciencia: { code: '210210', description: 'Ciencia da Operacao' },
  desconhecimento: { code: '210220', description: 'Desconhecimento da Operacao' },
  naoRealizada: { code: '210240', description: 'Operacao nao Realizada' },
} as const;
export type RecipientEvent = keyof typeof RECIPIENT_EVENTS;

/** Evento de manifestação do destinatário, sem assinatura (cOrgao 91, Ambiente Nacional). */
export function buildRecipientEvent(input: {
  accessKey: string;
  /** CNPJ ou CPF do destinatário que se manifesta. */
  taxId: string;
  type: RecipientEvent;
  /** Obrigatória em "operação não realizada" (15 a 255 caracteres). */
  reason?: string;
  /** dhEvento com fuso (AAAA-MM-DDThh:mm:ss-03:00). */
  at: string;
  /** Sequência do evento do mesmo tipo na nota (1 a 20). */
  sequence?: number;
}): string {
  if (!/^[0-9]{44}$/.test(input.accessKey))
    throw new SefazMessageError('Chave de acesso inválida.');
  const taxId = onlyDigits(input.taxId);
  if (taxId.length !== 11 && taxId.length !== 14) {
    throw new SefazMessageError('Informe o CNPJ ou o CPF do destinatário.');
  }
  const event = RECIPIENT_EVENTS[input.type];
  const sequence = input.sequence ?? 1;
  if (sequence < 1 || sequence > 20) throw new SefazMessageError('Sequência do evento inválida.');
  const reason = input.reason?.trim() ?? '';
  if (input.type === 'naoRealizada' && (reason.length < 15 || reason.length > 255)) {
    throw new SefazMessageError(
      'Diga por que a operação não foi realizada (de 15 a 255 caracteres).',
    );
  }
  const seq = String(sequence).padStart(2, '0');
  return el(
    'evento',
    el(
      'infEvento',
      [
        el('cOrgao', AMBIENTE_NACIONAL),
        el('tpAmb', TP_AMB),
        el(taxId.length === 11 ? 'CPF' : 'CNPJ', taxId),
        el('chNFe', input.accessKey),
        el('dhEvento', input.at),
        el('tpEvento', event.code),
        el('nSeqEvento', String(sequence)),
        el('verEvento', '1.00'),
        el(
          'detEvento',
          [
            el('descEvento', event.description),
            input.type === 'naoRealizada' ? el('xJust', reason) : '',
          ],
          { versao: '1.00' },
        ),
      ],
      { Id: `ID${event.code}${input.accessKey}${seq}` },
    ),
    { xmlns: NFE_NS, versao: '1.00' },
  );
}

/** Lote com o evento de manifestação, para a recepção de eventos do Ambiente Nacional. */
export function recipientEventRequest(input: {
  batchId: string;
  signedEvent: string;
}): SefazRequest {
  if (!/^\d{1,15}$/.test(input.batchId)) throw new SefazMessageError('Número do lote inválido.');
  if (!/<Signature[\s>]/.test(input.signedEvent)) {
    throw new SefazMessageError('Evento sem assinatura.');
  }
  const payload =
    `<envEvento xmlns="${NFE_NS}" versao="1.00">${el('idLote', input.batchId)}` +
    `${input.signedEvent}</envEvento>`;
  return {
    service: 'RecepcaoEvento',
    url: NFE_NATIONAL_ENDPOINTS.homologacao.RecepcaoEvento,
    envelope:
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
      'xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">' +
      `<soap12:Body><nfeDadosMsg xmlns="${EVENT_NS}">${payload}</nfeDadosMsg></soap12:Body></soap12:Envelope>`,
    contentType: `application/soap+xml; charset=utf-8; action="${EVENT_NS}/nfeRecepcaoEvento"`,
  };
}

// ---------------------------------------------------------------- retorno da distribuição

/** Situação da NF-e no resumo (cSitNFe): 1 autorizada, 2 denegada, 3 cancelada. */
const SITUATION = { '1': 'autorizada', '2': 'denegada', '3': 'cancelada' } as const;

export interface DistributedSummary {
  accessKey: string;
  issuerTaxId: string;
  issuerName: string;
  issuerIe: string | null;
  issuedAt: string;
  /** 0 entrada, 1 saída (do ponto de vista do emitente). */
  direction: '0' | '1';
  totalCents: number;
  protocol: string | null;
  situation: (typeof SITUATION)[keyof typeof SITUATION] | null;
}

export type DistributedDocument =
  | { kind: 'resumo'; nsu: string; schema: string; xml: string; summary: DistributedSummary }
  | { kind: 'nota'; nsu: string; schema: string; xml: string; summary: DistributedSummary }
  | {
      kind: 'evento';
      nsu: string;
      schema: string;
      xml: string;
      accessKey: string | null;
      eventType: string | null;
    }
  | { kind: 'outro'; nsu: string; schema: string; xml: string };

export interface DistributionResult {
  /** 137 nenhum documento; 138 documentos localizados; 656 consumo indevido (esperar 1 hora). */
  cStat: string;
  xMotivo: string;
  ultNSU: string;
  maxNSU: string;
  documents: DistributedDocument[];
}

const cents = (value: string | undefined) => {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value ?? '');
  return m ? Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0')) : 0;
};

function summaryOf(node: XmlElement): DistributedSummary {
  const situation = textOf(node, 'cSitNFe') as keyof typeof SITUATION | undefined;
  return {
    accessKey: textOf(node, 'chNFe') ?? '',
    issuerTaxId: textOf(node, 'CNPJ') ?? textOf(node, 'CPF') ?? '',
    issuerName: textOf(node, 'xNome') ?? '',
    issuerIe: textOf(node, 'IE') ?? null,
    issuedAt: textOf(node, 'dhEmi') ?? '',
    direction: textOf(node, 'tpNF') === '0' ? '0' : '1',
    totalCents: cents(textOf(node, 'vNF')),
    protocol: textOf(node, 'nProt') ?? null,
    situation: situation ? SITUATION[situation] : null,
  };
}

/** Resumo da nota completa (procNFe): emitente, data, total, protocolo. */
function summaryOfProc(root: XmlElement): DistributedSummary {
  const inf = descendant(root, 'infNFe');
  const emit = descendant(root, 'emit');
  const ide = descendant(root, 'ide');
  const total = descendant(root, 'ICMSTot');
  const prot = descendant(root, 'infProt');
  return {
    accessKey: (inf?.attrs.Id ?? '').replace(/^NFe/, ''),
    issuerTaxId: textOf(emit, 'CNPJ') ?? textOf(emit, 'CPF') ?? '',
    issuerName: textOf(emit, 'xNome') ?? '',
    issuerIe: textOf(emit, 'IE') ?? null,
    issuedAt: textOf(ide, 'dhEmi') ?? '',
    direction: textOf(ide, 'tpNF') === '0' ? '0' : '1',
    totalCents: cents(textOf(total, 'vNF')),
    protocol: textOf(prot, 'nProt') ?? null,
    situation: textOf(prot, 'cStat') === '100' ? 'autorizada' : null,
  };
}

const fromBase64 = (text: string) => {
  const binary = atob(text.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

/** O docZip vem em GZip e base64 (NT 2014.002). */
export async function unzipDocument(base64: string): Promise<string> {
  const stream = new Blob([fromBase64(base64)])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

export async function parseDistributionResponse(responseXml: string): Promise<DistributionResult> {
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
  const ret = parsed.name === 'retDistDFeInt' ? parsed : descendant(parsed, 'retDistDFeInt');
  if (!ret) throw new SefazResponseError('A resposta da SEFAZ não traz retDistDFeInt.');
  const documents: DistributedDocument[] = [];
  for (const zip of findAll(descendant(ret, 'loteDistDFeInt'), 'docZip')) {
    const schema = zip.attrs.schema ?? '';
    const docNsu = zip.attrs.NSU ?? '';
    const xml = await unzipDocument(zip.text ?? '');
    let root: XmlElement;
    try {
      root = parseXml(xml);
    } catch {
      documents.push({ kind: 'outro', nsu: docNsu, schema, xml });
      continue;
    }
    if (schema.startsWith('resNFe')) {
      documents.push({ kind: 'resumo', nsu: docNsu, schema, xml, summary: summaryOf(root) });
    } else if (schema.startsWith('procNFe')) {
      documents.push({ kind: 'nota', nsu: docNsu, schema, xml, summary: summaryOfProc(root) });
    } else if (schema.startsWith('resEvento') || schema.startsWith('procEventoNFe')) {
      documents.push({
        kind: 'evento',
        nsu: docNsu,
        schema,
        xml,
        accessKey: descendant(root, 'chNFe')?.text ?? null,
        eventType: descendant(root, 'tpEvento')?.text ?? null,
      });
    } else {
      documents.push({ kind: 'outro', nsu: docNsu, schema, xml });
    }
  }
  return {
    cStat: textOf(ret, 'cStat') ?? '',
    xMotivo: textOf(ret, 'xMotivo') ?? '',
    ultNSU: textOf(ret, 'ultNSU') ?? '000000000000000',
    maxNSU: textOf(ret, 'maxNSU') ?? '000000000000000',
    documents,
  };
}
