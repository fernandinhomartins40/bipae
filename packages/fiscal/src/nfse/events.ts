import { el } from '../nfce/xml';
import { NFSE_NS } from './dps';
import {
  gunzipBase64,
  gzipBase64,
  withXmlDeclaration,
  NFSE_ENDPOINTS,
  NfseMessageError,
  type NfseRequest,
} from './sefin';

/**
 * Cancelamento da NFS-e Nacional (F5-13.g): o pedido de registro de evento 101101, conforme o
 * leiaute e as regras do Anexo II (ANEXO_II-SEFIN_ADN-PEDREGEVT_EVT-SNNFSe-v1.01-20260122) e o
 * schema pedRegEvento_v1.01. O autor é o emitente (CNPJ do certificado), a assinatura é
 * obrigatória e o pedido vai à Sefin Nacional que gerou a NFS-e (POST /nfse/{chave}/eventos).
 *
 * O prazo e o valor-limite do cancelamento são parâmetros de cada município (rejeições E0822 e
 * E0823): o Bipaê não supõe um prazo, manda o pedido e mostra a recusa quando houver.
 */

/** Códigos de justificativa do cancelamento (TSCodJustCanc). */
export const NFSE_CANCEL_REASONS = {
  '1': 'Erro na emissão',
  '2': 'Serviço não prestado',
  '9': 'Outros',
} as const;
export type NfseCancelReason = keyof typeof NFSE_CANCEL_REASONS;

const VER_APLIC = 'Bipae-1.0';

/** Pedido de cancelamento sem assinatura (assine com signFiscalXml(..., 'pedRegEvento', 'infPedReg')). */
export function buildNfseCancelRequest(input: {
  accessKey: string;
  cnpj: string;
  code: NfseCancelReason;
  reason: string;
  /** dhEvento com fuso (AAAA-MM-DDThh:mm:ss-03:00). */
  at: string;
}): string {
  if (!/^\d{50}$/.test(input.accessKey)) {
    throw new NfseMessageError('Chave de acesso da NFS-e inválida.');
  }
  if (!/^\d{14}$/.test(input.cnpj)) throw new NfseMessageError('CNPJ do emitente inválido.');
  if (!(input.code in NFSE_CANCEL_REASONS)) {
    throw new NfseMessageError('Escolha o motivo do cancelamento (1, 2 ou 9).');
  }
  const reason = input.reason.replace(/\s+/g, ' ').trim();
  if (reason.length < 15 || reason.length > 255) {
    throw new NfseMessageError('Explique o motivo do cancelamento em 15 a 255 caracteres.');
  }
  // "PRE" + chave de acesso (50) + código do evento (6), como no Anexo II (item 13 do leiaute).
  const id = `PRE${input.accessKey}101101`;
  return el(
    'pedRegEvento',
    el(
      'infPedReg',
      [
        el('tpAmb', '2'),
        el('verAplic', VER_APLIC),
        el('dhEvento', input.at),
        el('CNPJAutor', input.cnpj),
        el('chNFSe', input.accessKey),
        el('e101101', [
          el('xDesc', 'Cancelamento de NFS-e'),
          el('cMotivo', input.code),
          el('xMotivo', reason),
        ]),
      ],
      { Id: id },
    ),
    { xmlns: NFSE_NS, versao: '1.01' },
  );
}

/** POST /nfse/{chave}/eventos, com o pedido assinado compactado (como a DPS). */
export async function nfseEventRequest(
  accessKey: string,
  signedRequest: string,
): Promise<NfseRequest> {
  if (!/<Signature[\s>]/.test(signedRequest)) {
    throw new NfseMessageError('Pedido de evento sem assinatura.');
  }
  if (!signedRequest.includes('<tpAmb>2</tpAmb>')) {
    throw new NfseMessageError('O Bipaê só manda eventos de NFS-e para a produção restrita.');
  }
  return {
    method: 'POST',
    url: `${NFSE_ENDPOINTS.sefinNacional.producaoRestrita}/nfse/${accessKey}/eventos`,
    body: JSON.stringify({
      pedidoRegistroEventoXmlGZipB64: await gzipBase64(withXmlDeclaration(signedRequest)),
    }),
  };
}

export type NfseEventResult =
  | { outcome: 'registered'; eventXml: string }
  | { outcome: 'rejected'; errors: { code: string; message: string }[] };

type Json = Record<string, unknown>;
const pick = (json: Json, name: string) => {
  const found = Object.keys(json).find((k) => k.toLowerCase() === name.toLowerCase());
  const value = found ? json[found] : undefined;
  return typeof value === 'string' ? value : null;
};

/**
 * Resposta do registro do evento: o XML do evento gerado (compactado) ou a lista de erros. Os
 * nomes dos campos do JSON (eventoXmlGZipB64, erros) seguem os da emissão e ficam para conferir
 * na primeira conversa real (dúvida D-036).
 */
export async function parseNfseEventResponse(
  status: number,
  body: string,
): Promise<NfseEventResult> {
  let json: Json;
  try {
    json = JSON.parse(body) as Json;
  } catch {
    throw new NfseMessageError(
      `A Sefin Nacional respondeu (status ${status}) sem uma mensagem JSON.`,
    );
  }
  const zipped = pick(json, 'eventoXmlGZipB64');
  if (status < 300 && zipped) {
    return { outcome: 'registered', eventXml: await gunzipBase64(zipped) };
  }
  const list = (
    Array.isArray(json.erros) ? json.erros : Array.isArray(json.erro) ? json.erro : []
  ) as Json[];
  const errors = list.map((e) => ({
    code: pick(e, 'codigo') ?? '',
    message: [pick(e, 'descricao'), pick(e, 'complemento')].filter(Boolean).join(' — '),
  }));
  if (errors.length === 0) {
    throw new NfseMessageError(`A Sefin Nacional respondeu com o status ${status} sem o evento.`);
  }
  return { outcome: 'rejected', errors };
}
