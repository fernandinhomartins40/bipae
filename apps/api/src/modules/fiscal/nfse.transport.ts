import { request } from 'node:https';
import { rootCertificates } from 'node:tls';
import type { NfseRequest } from '@bipae/fiscal';
import { ICP_BRASIL_CERTIFICATES } from '@bipae/fiscal/icp-brasil';
import type { SefazCredentials } from './sefaz.transport';

/**
 * Leva as mensagens JSON até a Sefin Nacional da NFS-e por HTTPS com o certificado A1 da empresa
 * (autenticação mútua), F5-13.d. A chave e o certificado nunca vão para log.
 */
export interface NfseResponse {
  status: number;
  body: string;
  /** O corpo como veio (o DANFSE é PDF). */
  bytes: Buffer;
  contentType: string;
}

export interface NfseTransport {
  send(
    request: NfseRequest,
    credentials: SefazCredentials,
  ): Promise<NfseResponse>;
}

/** A Sefin não respondeu (rede, tempo esgotado, servidor fora): vale tentar de novo depois. */
export class NfseUnavailableError extends Error {}

export interface HttpsNfseTransportOptions {
  ca?: string[];
  timeoutMs?: number;
  /** Troca o endereço antes de conectar (só nos testes, para a Sefin simulada). */
  rewriteUrl?: (url: string) => string;
}

const DEFAULT_CA = [...rootCertificates, ...ICP_BRASIL_CERTIFICATES.map((c) => c.pem)];

export class HttpsNfseTransport implements NfseTransport {
  constructor(private readonly options: HttpsNfseTransportOptions = {}) {}

  send(nfse: NfseRequest, credentials: SefazCredentials) {
    const url = this.options.rewriteUrl?.(nfse.url) ?? nfse.url;
    const body = nfse.body ? Buffer.from(nfse.body, 'utf8') : null;
    return new Promise<NfseResponse>((resolve, reject) => {
      const req = request(
        url,
        {
          method: nfse.method,
          key: credentials.key,
          cert: credentials.cert,
          ca: this.options.ca ?? DEFAULT_CA,
          minVersion: 'TLSv1.2',
          timeout: this.options.timeoutMs ?? 30_000,
          headers: {
            Accept: 'application/json',
            ...(body && { 'Content-Type': 'application/json', 'Content-Length': body.length }),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const status = res.statusCode ?? 0;
            // Servidor fora ou sobrecarregado: falha temporária, a fila tenta de novo.
            if ([502, 503, 504].includes(status)) {
              reject(
                new NfseUnavailableError(`A Sefin Nacional respondeu com o status ${status}.`),
              );
              return;
            }
            const bytes = Buffer.concat(chunks);
            resolve({
              status,
              body: bytes.toString('utf8'),
              bytes,
              contentType: String(res.headers['content-type'] ?? ''),
            });
          });
          res.on('error', (error) =>
            reject(new NfseUnavailableError(`Conexão com a Sefin interrompida: ${error.message}`)),
          );
        },
      );
      req.on('timeout', () => req.destroy(new Error('tempo esgotado')));
      req.on('error', (error) =>
        reject(
          new NfseUnavailableError(`Não foi possível falar com a Sefin Nacional: ${error.message}`),
        ),
      );
      req.end(body ?? undefined);
    });
  }
}
