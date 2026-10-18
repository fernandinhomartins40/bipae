import endpoints from '../tables/data/nfse-endpoints.json';

/**
 * Conversa com a Sefin Nacional (F5-13.b): a API REST do Emissor Público Nacional da NFS-e
 * (manual dos contribuintes v1.2). A DPS assinada vai compactada em GZip e em base64 numa mensagem
 * JSON (regras E1225 e E1226 do Anexo I); a resposta traz a NFS-e do mesmo jeito. A conexão usa o
 * certificado A1 da empresa (autenticação mútua). Só produção restrita (regra 4 do projeto).
 *
 * Os nomes dos campos do JSON (dpsXmlGZipB64, chaveAcesso, nfseXmlGZipB64, erros) vêm do uso
 * corrente, porque o Swagger oficial só abre com certificado. Conferir na primeira emissão real
 * (dúvida D-036).
 */
export const NFSE_ENDPOINTS = endpoints as unknown as Record<
  'sefinNacional' | 'danfse' | 'parametrizacao' | 'contribuintes',
  { producaoRestrita: string; producao: string }
>;

const SEFIN = NFSE_ENDPOINTS.sefinNacional.producaoRestrita;

export interface NfseRequest {
  method: 'GET' | 'POST' | 'HEAD';
  url: string;
  /** Corpo JSON, quando há. */
  body?: string;
}

const toBase64 = (bytes: Uint8Array) => {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
};

const fromBase64 = (text: string) => {
  const binary = atob(text.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

/** GZip + base64, como a Sefin pede a área de dados. */
export async function gzipBase64(xml: string): Promise<string> {
  const stream = new Blob([new TextEncoder().encode(xml)])
    .stream()
    .pipeThrough(new CompressionStream('gzip'));
  return toBase64(new Uint8Array(await new Response(stream).arrayBuffer()));
}

export async function gunzipBase64(base64: string): Promise<string> {
  const stream = new Blob([fromBase64(base64)])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

export class NfseMessageError extends Error {}

/** POST /nfse: a DPS assinada, para a Sefin gerar a NFS-e de forma síncrona. */
export async function nfseEmitRequest(signedDps: string): Promise<NfseRequest> {
  if (!/<Signature[\s>]/.test(signedDps)) throw new NfseMessageError('DPS sem assinatura.');
  if (!signedDps.includes('<tpAmb>2</tpAmb>')) {
    throw new NfseMessageError('Só DPS de produção restrita (tpAmb 2) pode ser enviada.');
  }
  return {
    method: 'POST',
    url: `${SEFIN}/nfse`,
    body: JSON.stringify({ dpsXmlGZipB64: await gzipBase64(signedDps) }),
  };
}

/** GET /dps/{id}: a chave da NFS-e gerada a partir da DPS (para nunca emitir duas vezes). */
export function dpsQueryRequest(dpsId: string): NfseRequest {
  if (!/^DPS\d{42}$/.test(dpsId)) throw new NfseMessageError('Identificador da DPS inválido.');
  return { method: 'GET', url: `${SEFIN}/dps/${dpsId}` };
}

/** GET /nfse/{chave}: a NFS-e pela chave de acesso. */
export function nfseQueryRequest(accessKey: string): NfseRequest {
  if (!/^\d{50}$/.test(accessKey)) throw new NfseMessageError('Chave de acesso da NFS-e inválida.');
  return { method: 'GET', url: `${SEFIN}/nfse/${accessKey}` };
}

/** GET /parametros_municipais/{município}/convenio: o convênio do município no Sistema Nacional. */
export function municipalAgreementRequest(cityCode: string): NfseRequest {
  if (!/^\d{7}$/.test(cityCode)) throw new NfseMessageError('Código do município inválido.');
  return { method: 'GET', url: `${SEFIN}/parametros_municipais/${cityCode}/convenio` };
}

export type NfseResult =
  | { outcome: 'authorized'; accessKey: string; nfseXml: string; alerts: string[] }
  | { outcome: 'rejected'; errors: { code: string; message: string }[] };

type Json = Record<string, unknown>;
const pickStr = (o: Json, ...names: string[]) => {
  for (const n of names) {
    const key = Object.keys(o).find((k) => k.toLowerCase() === n.toLowerCase());
    const v = key ? o[key] : undefined;
    if (typeof v === 'string' && v) return v;
  }
  return null;
};

/** Lê a resposta da emissão: a NFS-e gerada ou a lista de erros das regras de negócio. */
export async function parseNfseEmitResponse(status: number, body: string): Promise<NfseResult> {
  let json: Json;
  try {
    json = JSON.parse(body) as Json;
  } catch {
    throw new NfseMessageError(
      `A Sefin Nacional respondeu (status ${status}) sem uma mensagem JSON.`,
    );
  }
  const zipped = pickStr(json, 'nfseXmlGZipB64');
  const key = pickStr(json, 'chaveAcesso');
  if (status < 300 && zipped && key) {
    const alerts = (Array.isArray(json.alertas) ? json.alertas : []) as Json[];
    return {
      outcome: 'authorized',
      accessKey: key,
      nfseXml: await gunzipBase64(zipped),
      alerts: alerts.map((a) =>
        `${pickStr(a, 'codigo') ?? ''} ${pickStr(a, 'descricao') ?? ''}`.trim(),
      ),
    };
  }
  const list = (
    Array.isArray(json.erros) ? json.erros : Array.isArray(json.erro) ? json.erro : []
  ) as Json[];
  const errors = list.map((e) => ({
    code: pickStr(e, 'codigo') ?? '',
    message: [pickStr(e, 'descricao'), pickStr(e, 'complemento')].filter(Boolean).join(' — '),
  }));
  if (errors.length === 0) {
    throw new NfseMessageError(`A Sefin Nacional respondeu com o status ${status} sem a NFS-e.`);
  }
  return { outcome: 'rejected', errors };
}

/** A chave da NFS-e da consulta pela DPS; null quando a DPS ainda não gerou nota. */
export function parseDpsQueryResponse(status: number, body: string): string | null {
  if (status === 404) return null;
  try {
    return pickStr(JSON.parse(body) as Json, 'chaveAcesso');
  } catch {
    return null;
  }
}

/**
 * O convênio do município está ativo? Null quando a resposta não diz (o motor da DPS então pede
 * para tentar de novo, em vez de supor).
 */
export function parseMunicipalAgreementResponse(status: number, body: string): boolean | null {
  if (status >= 400) return null;
  let json: Json;
  try {
    json = JSON.parse(body) as Json;
  } catch {
    return null;
  }
  const node = (json.parametrosConvenio ?? json) as Json;
  const situation = pickStr(node, 'situacaoConvenio', 'situacao');
  if (situation) return /ativ/i.test(situation) && !/inativ/i.test(situation);
  const flag = Object.entries(node).find(([k]) => /aderente|ativo/i.test(k))?.[1];
  return typeof flag === 'boolean' ? flag : typeof flag === 'number' ? flag === 1 : null;
}
