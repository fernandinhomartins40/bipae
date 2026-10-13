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

export function nfceSupplement(input: { uf: string; accessKey: string; environment: 'homologacao' }): NfceSupplement {
  if (!/^\d{44}$/.test(input.accessKey) && !/^[0-9A-Z]{44}$/.test(input.accessKey)) {
    throw new Error('Chave de acesso inválida para o QR Code');
  }
  const endpoints = nfceEndpoints(input.uf);
  const base = endpoints?.qrCode[input.environment];
  const urlChave = endpoints?.urlChave[input.environment];
  if (!base || !urlChave) throw new Error(`Sem endereço de QR Code da NFC-e para a UF ${input.uf}`);
  // tpAmb 2 = homologação; a produção exige pedido explícito do dono do projeto (regra 4).
  return { qrCode: `${withProtocol(base)}?p=${input.accessKey}|${QR_CODE_VERSION}|2`, urlChave };
}
