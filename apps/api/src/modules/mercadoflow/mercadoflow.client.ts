/**
 * Cliente da API de parceiro do MercadoFlow (contrato em BIPAE-INSTRUCOES-PARA-IA.md, seção 3).
 * Só a API do Bipaê fala com o MercadoFlow: o token e o segredo nunca saem daqui nem vão para log.
 */
export const MERCADOFLOW_CLIENT = Symbol('MERCADOFLOW_CLIENT');

/** O MercadoFlow respondeu com um erro que não adianta repetir (400, 403, 404, 409). */
export class MercadoflowError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Corpo da resposta, quando veio em JSON (o 409 de "já tem conta" traz dados úteis). */
    readonly body: unknown = null,
  ) {
    super(message);
  }
}

/** Fora do ar, lento ou no limite de requisições: vale tentar de novo mais tarde. */
export class MercadoflowUnavailableError extends Error {}

export interface MercadoflowRequest {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Tempo limite desta chamada (o caixa usa 1,5 s). Padrão: 15 s. */
  timeoutMs?: number;
  /** Quantas tentativas no total em caso de 429, 5xx ou falha de rede. Padrão: 3. */
  attempts?: number;
  idempotencyKey?: string;
}

export interface MercadoflowClientOptions {
  apiUrl?: string | undefined;
  clientId?: string | undefined;
  clientSecret?: string | undefined;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const RENEW_BEFORE_MS = 5 * 60_000;
const DEFAULT_TIMEOUT_MS = 15_000;

export class MercadoflowClient {
  private token: { value: string; expiresAt: number } | null = null;
  private tokenRequest: Promise<string> | null = null;
  private readonly fetch: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: MercadoflowClientOptions) {
    this.fetch = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((ok) => setTimeout(ok, ms)));
  }

  /** Sem URL, id e segredo a integração fica desligada. */
  get enabled(): boolean {
    return !!(this.options.apiUrl && this.options.clientId && this.options.clientSecret);
  }

  private url(path: string, query: MercadoflowRequest['query'] = {}): string {
    const url = new URL(`${this.options.apiUrl!.replace(/\/$/, '')}${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  private async call(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    try {
      return await this.fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      throw new MercadoflowUnavailableError(
        `Não foi possível falar com o MercadoFlow: ${(error as Error).message}`,
      );
    }
  }

  private async fetchToken(timeoutMs: number): Promise<string> {
    const response = await this.call(
      this.url('/oauth/token'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.options.clientId!,
          client_secret: this.options.clientSecret!,
        }).toString(),
      },
      timeoutMs,
    );
    if (response.status === 401 || response.status === 400) {
      throw new MercadoflowError(response.status, 'O MercadoFlow recusou as credenciais do Bipaê.');
    }
    if (!response.ok) {
      throw new MercadoflowUnavailableError(
        `O MercadoFlow respondeu ${response.status} ao pedir o token.`,
      );
    }
    const data = (await response.json()) as { access_token: string; expires_in: number };
    this.token = { value: data.access_token, expiresAt: this.now() + data.expires_in * 1000 };
    return data.access_token;
  }

  /** Token em memória, renovado 5 minutos antes de vencer. Pedidos simultâneos dividem a renovação. */
  private async accessToken(timeoutMs: number): Promise<string> {
    if (this.token && this.token.expiresAt - RENEW_BEFORE_MS > this.now()) return this.token.value;
    this.tokenRequest ??= this.fetchToken(timeoutMs).finally(() => {
      this.tokenRequest = null;
    });
    return this.tokenRequest;
  }

  async request<T>(method: string, path: string, request: MercadoflowRequest = {}): Promise<T> {
    if (!this.enabled)
      throw new MercadoflowUnavailableError('A integração com o MercadoFlow está desligada.');
    const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const attempts = request.attempts ?? 3;
    let renewed = false;
    let lastError: Error = new MercadoflowUnavailableError('O MercadoFlow não respondeu.');
    for (let attempt = 1; attempt <= attempts; attempt++) {
      let response: Response;
      try {
        const token = await this.accessToken(timeoutMs);
        response = await this.call(
          this.url(path, request.query),
          {
            method,
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/json',
              ...(request.body !== undefined && { 'Content-Type': 'application/json' }),
              ...(request.idempotencyKey && { 'Idempotency-Key': request.idempotencyKey }),
            },
            ...(request.body !== undefined && { body: JSON.stringify(request.body) }),
          },
          timeoutMs,
        );
      } catch (error) {
        if (error instanceof MercadoflowError) throw error;
        lastError = error as Error;
        if (attempt < attempts) await this.sleep(500 * 2 ** (attempt - 1));
        continue;
      }
      // Token vencido ou revogado: renova uma vez e repete, sem gastar tentativa.
      if (response.status === 401 && !renewed) {
        renewed = true;
        this.token = null;
        attempt--;
        continue;
      }
      if (response.status === 429 || response.status >= 500) {
        lastError = new MercadoflowUnavailableError(
          response.status === 429
            ? 'O MercadoFlow pediu para esperar (limite de requisições).'
            : `O MercadoFlow respondeu ${response.status}.`,
        );
        if (attempt < attempts) {
          const retryAfter = Number(response.headers.get('retry-after'));
          await this.sleep(retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** (attempt - 1));
        }
        continue;
      }
      const text = await response.text();
      let body: unknown;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = null;
      }
      if (response.ok) return body as T;
      // O contrato diz { "erro": "..." }; o serviço de token usa { "error": "..." }.
      const fields = (body ?? {}) as { erro?: string; error?: string; message?: string };
      const message =
        fields.erro ??
        fields.message ??
        fields.error ??
        `O MercadoFlow respondeu ${response.status}.`;
      throw new MercadoflowError(response.status, message, body);
    }
    throw lastError;
  }

  get<T>(path: string, request?: MercadoflowRequest) {
    return this.request<T>('GET', path, request);
  }
  post<T>(path: string, body: unknown, request?: MercadoflowRequest) {
    return this.request<T>('POST', path, { ...request, body });
  }
  put<T>(path: string, body: unknown, request?: MercadoflowRequest) {
    return this.request<T>('PUT', path, { ...request, body });
  }
  delete<T>(path: string, request?: MercadoflowRequest) {
    return this.request<T>('DELETE', path, request);
  }
}
