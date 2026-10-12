import {
  CLIENT_HEADER,
  TERMINAL_HEADER,
  type ApiErrorBody,
  type LoginInput,
  type Me,
  type SessionTokens,
  type SignupInput,
} from '@bipae/domain';
import type { PreferencesPort } from '@bipae/platform';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly issues: { path: string; message: string }[] = [],
  ) {
    super(message);
  }

  /** Field errors keyed by path, ready for forms. */
  fieldErrors(): Record<string, string> {
    return Object.fromEntries(this.issues.map((i) => [i.path, i.message]));
  }
}

export const OFFLINE_MESSAGE =
  'Sem conexão com o servidor. Verifique a internet; o que você digitou não foi perdido.';

const REFRESH_KEY = 'bipae.refreshToken';
const TERMINAL_KEY = 'bipae.terminalId';

export interface ApiClientOptions {
  baseUrl: string;
  clientKind: 'web' | 'desktop';
  clientVersion: string;
  preferences: PreferencesPort;
  fetch?: typeof fetch;
  onSessionEnd?: () => void;
}

type AuthResult = SessionTokens & { me: Me };

/**
 * HTTP client for the Bipaê API. Keeps the access token in memory and the refresh token
 * in platform preferences; transparently refreshes once on 401.
 * Same client for web and desktop: only the injected PreferencesPort differs.
 */
export class ApiClient {
  private accessToken: string | null = null;
  private refreshing: Promise<boolean> | null = null;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ApiClientOptions) {
    this.fetchImpl = options.fetch ?? ((...args) => fetch(...args));
  }

  get isAuthenticated() {
    return this.accessToken !== null;
  }

  async signup(input: SignupInput) {
    return this.storeSession(await this.request<AuthResult>('POST', '/auth/signup', input, false));
  }

  async login(input: LoginInput) {
    return this.storeSession(await this.request<AuthResult>('POST', '/auth/login', input, false));
  }

  async switchTenant(tenantId: string) {
    return this.storeSession(await this.request<AuthResult>('POST', '/auth/switch-tenant', { tenantId }));
  }

  /** Restores a session from the stored refresh token (app start). */
  async restore(): Promise<Me | null> {
    if (!(await this.refresh())) return null;
    return this.get<Me>('/auth/me');
  }

  async logout() {
    const refreshToken = await this.options.preferences.get(REFRESH_KEY);
    this.accessToken = null;
    await this.options.preferences.remove(REFRESH_KEY);
    if (refreshToken) {
      await this.request('POST', '/auth/logout', { refreshToken }, false).catch(() => undefined);
    }
  }

  async setTerminal(terminalId: string | null) {
    if (terminalId) await this.options.preferences.set(TERMINAL_KEY, terminalId);
    else await this.options.preferences.remove(TERMINAL_KEY);
  }

  get<T>(path: string) {
    return this.request<T>('GET', path);
  }
  post<T>(path: string, body: unknown = {}) {
    return this.request<T>('POST', path, body);
  }
  put<T>(path: string, body: unknown) {
    return this.request<T>('PUT', path, body);
  }
  patch<T>(path: string, body: unknown) {
    return this.request<T>('PATCH', path, body);
  }

  private async storeSession(result: AuthResult) {
    this.accessToken = result.accessToken;
    await this.options.preferences.set(REFRESH_KEY, result.refreshToken);
    return result.me;
  }

  private refresh(): Promise<boolean> {
    // Concurrent 401s share a single refresh (refresh tokens rotate and can be used once).
    this.refreshing ??= (async () => {
      try {
        const refreshToken = await this.options.preferences.get(REFRESH_KEY);
        if (!refreshToken) return false;
        const result = await this.request<AuthResult>('POST', '/auth/refresh', { refreshToken }, false);
        await this.storeSession(result);
        return true;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          this.accessToken = null;
          await this.options.preferences.remove(REFRESH_KEY);
        }
        return false;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  private async request<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
    const send = async () => {
      const headers: Record<string, string> = {
        [CLIENT_HEADER]: `${this.options.clientKind}/${this.options.clientVersion}`,
      };
      if (body !== undefined) headers['content-type'] = 'application/json';
      if (auth && this.accessToken) headers.authorization = `Bearer ${this.accessToken}`;
      const terminal = await this.options.preferences.get(TERMINAL_KEY);
      if (terminal) headers[TERMINAL_HEADER] = terminal;
      try {
        return await this.fetchImpl(`${this.options.baseUrl}/v1${path}`, {
          method,
          headers,
          ...(body !== undefined && { body: JSON.stringify(body) }),
        });
      } catch {
        throw new ApiError(0, 'offline', OFFLINE_MESSAGE);
      }
    };

    let response = await send();
    if (response.status === 401 && auth && (await this.refresh())) {
      response = await send();
    }
    if (response.status === 401 && auth) {
      this.options.onSessionEnd?.();
    }
    if (!response.ok) {
      const error = (await response.json().catch(() => null)) as ApiErrorBody | null;
      throw new ApiError(
        response.status,
        error?.code ?? 'http_error',
        error?.message ?? 'Algo deu errado. Tente de novo.',
        error?.issues,
      );
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
}
