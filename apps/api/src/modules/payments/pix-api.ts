import { request } from 'node:https';

/**
 * Cliente da API Pix no padrão do Banco Central (F8-09, ADR-0018): cobrança imediata
 * (PUT /cob/{txid}) e consulta (GET /cob/{txid}), com o token OAuth2 do banco e o certificado
 * da conta (autenticação mútua). Os segredos nunca vão para log.
 */

export interface PixHttpRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface PixHttpResponse {
  status: number;
  body: string;
}

/** O certificado da conta no banco (PKCS#12) e a senha dele. */
export interface PixTls {
  pfx: Buffer;
  passphrase: string;
}

export interface PixTransport {
  send(req: PixHttpRequest, tls: PixTls | null): Promise<PixHttpResponse>;
}

/** O banco não respondeu (rede, tempo, servidor fora): o caixa pode tentar de novo. */
export class PixUnavailableError extends Error {}

export class HttpsPixTransport implements PixTransport {
  constructor(private readonly timeoutMs = 20_000) {}

  send(req: PixHttpRequest, tls: PixTls | null): Promise<PixHttpResponse> {
    const body = req.body ? Buffer.from(req.body, 'utf8') : null;
    return new Promise((resolve, reject) => {
      const r = request(
        req.url,
        {
          method: req.method,
          ...(tls && { pfx: tls.pfx, passphrase: tls.passphrase }),
          minVersion: 'TLSv1.2',
          timeout: this.timeoutMs,
          headers: { ...req.headers, ...(body && { 'Content-Length': String(body.length) }) },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () =>
            resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
          );
          res.on('error', (e) => reject(new PixUnavailableError(e.message)));
        },
      );
      r.on('timeout', () => r.destroy(new Error('tempo esgotado')));
      r.on('error', (e) =>
        reject(new PixUnavailableError(`Não foi possível falar com o banco: ${e.message}`)),
      );
      r.end(body ?? undefined);
    });
  }
}

export interface PixApiConfig {
  baseUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  tls: PixTls | null;
}

/** Cobrança como o padrão do Banco Central devolve (só o que usamos). */
export interface Cob {
  txid: string;
  status: 'ATIVA' | 'CONCLUIDA' | 'REMOVIDA_PELO_USUARIO_RECEBEDOR' | 'REMOVIDA_PELO_PSP';
  pixCopiaECola?: string;
  valor?: { original: string };
  pix?: { endToEndId: string; valor: string }[];
}

/** O banco recusou (dados errados, credencial inválida): a mensagem vai para a tela. */
export class PixRejectedError extends Error {}

const trimSlash = (u: string) => u.replace(/\/+$/, '');

export class PixApiClient {
  private token: { value: string; until: number } | null = null;

  constructor(
    private readonly config: PixApiConfig,
    private readonly transport: PixTransport,
    private readonly now: () => number = Date.now,
  ) {}

  private async accessToken(): Promise<string> {
    if (this.token && this.token.until > this.now()) return this.token.value;
    const basic = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString(
      'base64',
    );
    const res = await this.transport.send(
      {
        method: 'POST',
        url: this.config.tokenUrl,
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          scope: 'cob.write cob.read',
        }).toString(),
      },
      this.config.tls,
    );
    if (res.status === 401 || res.status === 403) {
      throw new PixRejectedError(
        'O banco recusou o Client ID, o Client Secret ou o certificado. Confira em Meios de pagamento.',
      );
    }
    const json = this.json<{ access_token?: string; expires_in?: number }>(res);
    if (!json.access_token) throw new PixRejectedError('O banco não devolveu o token de acesso.');
    // Renova um pouco antes de vencer.
    const seconds = Math.max(60, (json.expires_in ?? 300) - 30);
    this.token = { value: json.access_token, until: this.now() + seconds * 1000 };
    return json.access_token;
  }

  private json<T>(res: PixHttpResponse): T {
    if (res.status >= 500) throw new PixUnavailableError(`O banco respondeu ${res.status}.`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(res.body || '{}');
    } catch {
      throw new PixUnavailableError('O banco respondeu algo que não é JSON.');
    }
    if (res.status >= 400) {
      const p = parsed as { detail?: string; title?: string; mensagem?: string };
      throw new PixRejectedError(
        `O banco recusou a cobrança: ${p.detail ?? p.mensagem ?? p.title ?? `status ${res.status}`}.`,
      );
    }
    return parsed as T;
  }

  private async call<T>(
    method: 'GET' | 'PUT',
    path: string,
    body?: unknown,
    retried = false,
  ): Promise<T> {
    const token = await this.accessToken();
    const res = await this.transport.send(
      {
        method,
        url: `${trimSlash(this.config.baseUrl)}${path}`,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(body !== undefined && { 'Content-Type': 'application/json' }),
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      },
      this.config.tls,
    );
    // Token vencido no meio do caminho: pega outro e tenta uma vez.
    if (res.status === 401 && !retried) {
      this.token = null;
      return this.call(method, path, body, true);
    }
    return this.json<T>(res);
  }

  /** Cobrança imediata: valor em reais com dois decimais e a chave que recebe. */
  createCharge(input: {
    txid: string;
    amountCents: number;
    key: string;
    expiresInSeconds: number;
    description: string;
  }): Promise<Cob> {
    return this.call<Cob>('PUT', `/cob/${input.txid}`, {
      calendario: { expiracao: input.expiresInSeconds },
      valor: { original: (input.amountCents / 100).toFixed(2) },
      chave: input.key,
      solicitacaoPagador: input.description.slice(0, 140),
    });
  }

  getCharge(txid: string): Promise<Cob> {
    return this.call<Cob>('GET', `/cob/${txid}`);
  }
}
