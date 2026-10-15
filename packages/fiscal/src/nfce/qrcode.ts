import { nfceEndpoints } from '../tables/nfce-endpoints';

/**
 * QR Code da NFC-e, versão 3 (NT 2025.001 v1.01, item 04): na emissão normal (on-line) o
 * conteúdo é só "URL da UF?p=<chave>|3|<tpAmb>", sem CSC. A versão com assinatura, usada na
 * contingência off-line, entra com a F3-15.
 */
export const QR_CODE_VERSION = '3';

/** A NT exige o protocolo no endereço; algumas URLs da tabela oficial vêm sem ele (dúvida D-014). */
const withProtocol = (url: string) => (/^https?:\/\//.test(url) ? url : `https://${url}`);

export interface NfceSupplement {
  qrCode: string;
  urlChave: string;
}

/**
 * Parâmetros 1 a 7 do QR Code versão 3 em contingência off-line (Manual do DANFE NFC-e e QR
 * Code v6.0, item 4.4.2): chave|3|tpAmb|dia da emissão|vNF|tipo do destinatário|identificação.
 * É este texto que se assina com o certificado da nota (RSA-SHA1, base64).
 */
export function contingencyQrPayload(input: {
  accessKey: string;
  issuedAt: string;
  totalCents: number;
  customer?: { cpf?: string; cnpj?: string } | null;
}): string {
  const day = input.issuedAt.slice(8, 10);
  const vNF = (input.totalCents / 100).toFixed(2);
  const kind = input.customer?.cnpj ? '1' : input.customer?.cpf ? '2' : '';
  const id = input.customer?.cnpj ?? input.customer?.cpf ?? '';
  // tpAmb 2 = homologação (regra 4).
  return `${input.accessKey}|${QR_CODE_VERSION}|2|${day}|${vNF}|${kind}|${id}`;
}

export function nfceSupplement(input: {
  uf: string;
  accessKey: string;
  environment: 'homologacao';
  /** Contingência off-line: os parâmetros e a assinatura deles. */
  offline?: { payload: string; signature: string };
}): NfceSupplement {
  if (!/^\d{44}$/.test(input.accessKey) && !/^[0-9A-Z]{44}$/.test(input.accessKey)) {
    throw new Error('Chave de acesso inválida para o QR Code');
  }
  const endpoints = nfceEndpoints(input.uf);
  const base = endpoints?.qrCode[input.environment];
  const urlChave = endpoints?.urlChave[input.environment];
  if (!base || !urlChave) throw new Error(`Sem endereço de QR Code da NFC-e para a UF ${input.uf}`);
  // tpAmb 2 = homologação; a produção exige pedido explícito do dono do projeto (regra 4).
  const params = input.offline
    ? `${input.offline.payload}|${input.offline.signature}`
    : `${input.accessKey}|${QR_CODE_VERSION}|2`;
  return { qrCode: `${withProtocol(base)}?p=${params}`, urlChave };
}
