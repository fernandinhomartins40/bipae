import { descendant, parseXml, textOf, type XmlElement } from '../xml-reader';
import { NFSE_ENDPOINTS, NfseMessageError, gunzipBase64, type NfseRequest } from './sefin';

/**
 * Distribuição das NFS-e pelo Ambiente de Dados Nacional (API oficial "ADN Contribuinte", lida
 * com o certificado em 20/10/2026): `GET /contribuintes/DFe/{NSU}?lote=true` devolve, a partir do
 * NSU, as NFS-e e os eventos em que o CNPJ do certificado aparece (prestador, tomador ou
 * intermediário). É o "notas de serviço recebidas" da empresa. Só produção restrita.
 */
export function nfseDistributionRequest(nsu: number): NfseRequest {
  if (!Number.isSafeInteger(nsu) || nsu < 0) throw new NfseMessageError('NSU inválido.');
  return {
    method: 'GET',
    url: `${NFSE_ENDPOINTS.contribuintes.producaoRestrita}/DFe/${nsu}?lote=true`,
  };
}

export interface DistributedNfse {
  nsu: number;
  accessKey: string | null;
  /** NFSE, EVENTO ou outro tipo que o ADN informar. */
  kind: 'nfse' | 'evento' | 'outro';
  /** Tipo do evento como o ADN escreve (CANCELAMENTO, ...), quando é evento. */
  eventType: string | null;
  xml: string | null;
  generatedAt: string | null;
}

export interface NfseDistributionResult {
  /** documents: veio lote; none: nada depois do NSU (E2220); rejected: o ADN recusou. */
  outcome: 'documents' | 'none' | 'rejected';
  documents: DistributedNfse[];
  errors: { code: string; message: string }[];
  /** O maior NSU do lote (o próximo pedido começa nele). */
  lastNsu: number | null;
}

type Json = Record<string, unknown>;

/** O XML do documento vem compactado em gzip e base64; aceita também base64 puro ou texto. */
async function documentXml(value: unknown): Promise<string | null> {
  if (typeof value !== 'string' || !value) return null;
  if (value.trimStart().startsWith('<')) return value;
  try {
    return await gunzipBase64(value);
  } catch {
    try {
      const text = new TextDecoder().decode(Uint8Array.from(atob(value), (c) => c.charCodeAt(0)));
      return text.trimStart().startsWith('<') ? text : null;
    } catch {
      return null;
    }
  }
}

export async function parseNfseDistributionResponse(
  status: number,
  body: string,
): Promise<NfseDistributionResult> {
  let json: Json;
  try {
    json = JSON.parse(body) as Json;
  } catch {
    throw new NfseMessageError(`O Ambiente Nacional respondeu (status ${status}) sem JSON.`);
  }
  const errors = (Array.isArray(json.Erros) ? (json.Erros as Json[]) : []).map((e) => ({
    code: String(e.Codigo ?? ''),
    message: String(e.Descricao ?? ''),
  }));
  const situation = String(json.StatusProcessamento ?? '');
  if (situation === 'NENHUM_DOCUMENTO_LOCALIZADO' || errors.some((e) => e.code === 'E2220')) {
    return { outcome: 'none', documents: [], errors, lastNsu: null };
  }
  if (situation !== 'DOCUMENTOS_LOCALIZADOS') {
    return { outcome: 'rejected', documents: [], errors, lastNsu: null };
  }
  const lote = Array.isArray(json.LoteDFe) ? (json.LoteDFe as Json[]) : [];
  const documents: DistributedNfse[] = [];
  for (const item of lote) {
    const type = String(item.TipoDocumento ?? '');
    documents.push({
      nsu: Number(item.NSU ?? 0),
      accessKey: typeof item.ChaveAcesso === 'string' ? item.ChaveAcesso : null,
      kind: type === 'NFSE' ? 'nfse' : type === 'EVENTO' ? 'evento' : 'outro',
      eventType: typeof item.TipoEvento === 'string' ? item.TipoEvento : null,
      xml: await documentXml(item.ArquivoXml),
      generatedAt: typeof item.DataHoraGeracao === 'string' ? item.DataHoraGeracao : null,
    });
  }
  const nsus = documents.map((d) => d.nsu).filter((n) => Number.isFinite(n) && n > 0);
  return {
    outcome: 'documents',
    documents,
    errors,
    lastNsu: nsus.length ? Math.max(...nsus) : null,
  };
}

export interface NfseSummary {
  accessKey: string;
  number: string | null;
  issuerTaxId: string;
  issuerName: string;
  takerTaxId: string | null;
  takerName: string | null;
  issuedAt: string | null;
  /** Valor dos serviços (vServ da DPS), em centavos. */
  valueCents: number;
  /** Valor líquido da NFS-e (vLiq), em centavos. */
  netCents: number;
  serviceCode: string | null;
}

const cents = (text: string | undefined) => {
  if (!text || !/^\d+(\.\d{1,2})?$/.test(text)) return 0;
  const [whole, fraction = ''] = text.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
};
const taxIdOf = (node: XmlElement | null) => textOf(node, 'CNPJ') ?? textOf(node, 'CPF') ?? null;

/** Os dados que a lista mostra, lidos do XML da NFS-e (leiaute nacional). */
export function nfseSummary(xml: string): NfseSummary | null {
  const inf = descendant(parseXml(xml), 'infNFSe');
  if (!inf) return null;
  const id = inf.attrs.Id ?? '';
  const key = /(\d{50})$/.exec(id)?.[1];
  if (!key) return null;
  const emit = descendant(inf, 'emit');
  const dps = descendant(inf, 'infDPS');
  const toma = descendant(dps, 'toma');
  return {
    accessKey: key,
    number: textOf(inf, 'nNFSe') ?? null,
    issuerTaxId: taxIdOf(emit) ?? '',
    issuerName: textOf(emit, 'xNome') ?? '',
    takerTaxId: taxIdOf(toma),
    takerName: textOf(toma, 'xNome') ?? null,
    issuedAt: textOf(inf, 'dhProc') ?? textOf(dps, 'dhEmi') ?? null,
    valueCents: cents(textOf(descendant(dps, 'vServPrest'), 'vServ')),
    netCents: cents(textOf(descendant(inf, 'valores'), 'vLiq')),
    serviceCode: textOf(descendant(dps, 'cServ'), 'cTribNac') ?? null,
  };
}
