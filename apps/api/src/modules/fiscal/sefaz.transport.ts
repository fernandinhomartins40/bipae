import { request } from 'node:https';
import { rootCertificates } from 'node:tls';
import type { SefazRequest } from '@bipae/fiscal';
import { ICP_BRASIL_CERTIFICATES } from '@bipae/fiscal/icp-brasil';

/**
 * Leva o envelope SOAP até a SEFAZ por HTTPS com o certificado A1 da empresa (autenticação
 * mútua, exigida pelos webservices). A chave e o certificado chegam em PEM e nunca vão para log.
 */
export interface SefazCredentials {
  /** Chave privada PKCS#8 em PEM. */
  key: string;
  /** Certificado do titular em PEM. */
  cert: string;
}

export interface SefazTransport {
  send(request: SefazRequest, credentials: SefazCredentials): Promise<string>;
}

/** A SEFAZ não respondeu (rede, tempo esgotado, servidor fora): vale tentar de novo depois. */
export class SefazUnavailableError extends Error {}

export interface HttpsSefazTransportOptions {
  /** Autoridades aceitas no certificado do servidor. Padrão: as do Node mais a ICP-Brasil. */
  ca?: string[];
  timeoutMs?: number;
  /** Troca o endereço antes de conectar (só nos testes, para a SEFAZ simulada). */
  rewriteUrl?: (url: string) => string;
}

const DEFAULT_CA = [...rootCertificates, ...ICP_BRASIL_CERTIFICATES.map((c) => c.pem)];

export class HttpsSefazTransport implements SefazTransport {
  constructor(private readonly options: HttpsSefazTransportOptions = {}) {}

  send(sefaz: SefazRequest, credentials: SefazCredentials): Promise<string> {
    const url = this.options.rewriteUrl?.(sefaz.url) ?? sefaz.url;
    const body = Buffer.from(sefaz.envelope, 'utf8');
    return new Promise((resolve, reject) => {
      const req = request(
        url,
        {
          method: 'POST',
          key: credentials.key,
          cert: credentials.cert,
          ca: this.options.ca ?? DEFAULT_CA,
          minVersion: 'TLSv1.2',
          timeout: this.options.timeoutMs ?? 30_000,
          headers: { 'Content-Type': sefaz.contentType, 'Content-Length': body.length },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            // Falha SOAP chega com status 500 e envelope: quem lê o retorno explica o motivo.
            if (/<(\w+:)?Envelope[\s>]/.test(text)) return resolve(text);
            reject(
              new SefazUnavailableError(
                `A SEFAZ respondeu com o status ${res.statusCode} e sem mensagem SOAP.`,
              ),
            );
          });
          res.on('error', (error) =>
            reject(new SefazUnavailableError(`Conexão com a SEFAZ interrompida: ${error.message}`)),
          );
        },
      );
      req.on('timeout', () => req.destroy(new Error('tempo esgotado')));
      req.on('error', (error) =>
        reject(new SefazUnavailableError(`Não foi possível falar com a SEFAZ: ${error.message}`)),
      );
      req.end(body);
    });
  }
}
