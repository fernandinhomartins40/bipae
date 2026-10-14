import type { PaymentMethod } from '@bipae/domain';

/** Types of the backend contract (contract/openapi.yaml). */
export interface Me {
  operator: { id: string; name: string };
  store: { name: string; document?: string | null; address?: string | null };
  settings: {
    paymentMethods: PaymentMethod[];
    maxDiscountPercent: number;
    canCancelSales: boolean;
    /** A aplicação aceita a senha do gerente para desconto acima do limite (P-05). */
    managerAuthorization?: boolean;
  };
}
export interface Product {
  id: string;
  name: string;
  barcode: string | null;
  sku: string | null;
  priceCents: number;
  unit: string;
  weighable: boolean;
  stock: number | null;
}
export interface CashSession {
  id: string;
  openedAt: string;
  openingCents: number;
  operator: { id: string; name: string };
  salesCount: number;
  salesTotalCents: number;
}
export type AmountsByMethod = Partial<Record<PaymentMethod, number>>;
export interface CashClosing {
  closedAt: string;
  expectedCents: AmountsByMethod;
  countedCents: AmountsByMethod;
  differenceCents: number;
}
export interface SalePaymentLine {
  method: PaymentMethod;
  amountCents: number;
  changeCents: number;
}
export interface Sale {
  id: string;
  number: number;
  status: 'completed' | 'cancelled';
  createdAt: string;
  cancelledAt?: string | null;
  items: {
    productId: string;
    name: string;
    unit: string;
    quantityMilli: number;
    unitPriceCents: number;
    discountCents: number;
    totalCents: number;
  }[];
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  payments: SalePaymentLine[];
  customerDocument?: string | null;
}
export interface SaleInput {
  id: string;
  items: {
    productId: string;
    quantityMilli: number;
    unitPriceCents: number;
    discountCents: number;
  }[];
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  payments: SalePaymentLine[];
  customerDocument: string | null;
  /** Código devolvido por POST /authorize quando o desconto passa do limite (P-05). */
  discountAuthorization?: string | null;
}

export class PdvApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
  get isNetwork() {
    return this.status === 0;
  }
}

const NETWORK =
  'Sem conexão com o servidor. Confira a internet; nada foi perdido, é só tentar de novo.';

/** UUID v4 that also works outside HTTPS (crypto.randomUUID needs a secure context). */
export function uuid(): string {
  if (typeof crypto.randomUUID === 'function' && globalThis.isSecureContext)
    return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export interface ApiOptions {
  baseUrl: string;
  token?: string | null;
  credentials?: RequestCredentials;
  /** Extra headers on every request (e.g. CSRF token for Laravel, Rails or Django). */
  headers?: Record<string, string>;
  fetch?: typeof fetch;
}

export class PdvApi {
  constructor(private readonly options: ApiOptions) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      ...this.options.headers,
      'x-bipae-pdv': '1',
      accept: 'application/json',
    };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.options.token) headers.authorization = `Bearer ${this.options.token}`;
    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)(
        this.options.baseUrl.replace(/\/$/, '') + path,
        {
          method,
          headers,
          credentials: this.options.credentials ?? 'same-origin',
          ...(body !== undefined && { body: JSON.stringify(body) }),
        },
      );
    } catch {
      throw new PdvApiError(0, 'network', NETWORK);
    }
    const data = (await response.json().catch(() => null)) as
      (T & { error?: { code: string; message: string; details?: Record<string, unknown> } }) | null;
    if (!response.ok) {
      const e = data?.error;
      throw new PdvApiError(
        response.status,
        e?.code ?? 'http_' + response.status,
        e?.message ??
          (response.status === 401
            ? 'Sua sessão expirou. Entre de novo no sistema.'
            : `O servidor respondeu com erro (${response.status}). Tente de novo.`),
        e?.details,
      );
    }
    return data as T;
  }

  me() {
    return this.request<Me>('GET', '/me');
  }
  products(params: { q?: string; barcode?: string; limit?: number }) {
    const qs = new URLSearchParams();
    if (params.barcode) qs.set('barcode', params.barcode);
    if (params.q) qs.set('q', params.q);
    qs.set('limit', String(params.limit ?? 20));
    return this.request<{ items: Product[] }>('GET', `/products?${qs}`).then((r) => r.items);
  }
  session() {
    return this.request<{ session: CashSession | null }>('GET', '/cash-session').then(
      (r) => r.session,
    );
  }
  openSession(openingCents: number) {
    return this.request<{ session: CashSession }>('POST', '/cash-session/open', {
      openingCents,
    }).then((r) => r.session);
  }
  movement(body: {
    id: string;
    kind: 'withdrawal' | 'supply';
    amountCents: number;
    reason: string;
  }) {
    return this.request<{ movement: unknown }>('POST', '/cash-session/movements', body);
  }
  closeSession(countedCents: AmountsByMethod) {
    return this.request<{ closing: CashClosing }>('POST', '/cash-session/close', {
      countedCents,
    }).then((r) => r.closing);
  }
  sales(limit = 20) {
    return this.request<{ items: Sale[] }>('GET', `/sales?limit=${limit}`).then((r) => r.items);
  }
  /** Gerente autoriza desconto acima do limite (P-05). */
  authorize(body: {
    login: string;
    password: string;
    discountCents: number;
    subtotalCents: number;
  }) {
    return this.request<{ authorization: string; manager: { id: string; name: string } }>(
      'POST',
      '/authorize',
      body,
    );
  }
  cancelSale(id: string, reason: string) {
    return this.request<{ sale: Sale }>('POST', `/sales/${encodeURIComponent(id)}/cancel`, {
      reason,
    }).then((r) => r.sale);
  }

  /**
   * Registers a sale. The id is generated before the first attempt, so retrying after a network
   * failure can never create the sale twice (the contract makes POST /sales idempotent).
   */
  async createSale(input: SaleInput, retries = 3): Promise<Sale> {
    for (let attempt = 0; ; attempt++) {
      try {
        return (await this.request<{ sale: Sale }>('POST', '/sales', input)).sale;
      } catch (error) {
        if (error instanceof PdvApiError && error.isNetwork && attempt < retries) {
          await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
          continue;
        }
        throw error;
      }
    }
  }
}
