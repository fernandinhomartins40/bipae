import { PIX_PSP_INFO, type PixPspProvider } from '@bipae/domain';
import { PixRejectedError, PixUnavailableError, type PixTransport } from './pix-api';

/**
 * Pix com QR dinâmico pelas APIs próprias dos parceiros (F8-09.c, ADR-0018). Documentação
 * oficial conferida em 21/10/2026:
 * - Mercado Pago: POST /v1/payments (payment_method_id "pix", X-Idempotency-Key), GET
 *   /v1/payments/{id} e PUT /v1/payments/{id} com status "cancelled".
 *   https://www.mercadopago.com.br/developers/pt/docs/checkout-api-payments/integration-configuration/integrate-pix
 * - PagBank: POST /orders com qr_codes (valor em centavos), GET /orders/{id}; o pagamento aparece
 *   em charges[] com status PAID. https://developer.pagbank.com.br/reference/criar-pedido
 * - Asaas: POST /v3/payments (billingType PIX), GET /v3/payments/{id}/pixQrCode, GET
 *   /v3/payments/{id} e DELETE /v3/payments/{id}; chave no cabeçalho access_token.
 *   https://docs.asaas.com/reference/criar-nova-cobranca
 * Confirmação sempre por consulta; o aviso (webhook, F8-09.c.2) só antecipa a consulta. O token
 * nunca vai para log.
 */

export interface PixPspConfig {
  provider: PixPspProvider;
  sandbox: boolean;
  token: string;
  payerName: string | null;
  payerEmail: string | null;
  payerTaxId: string | null;
  customerId: string | null;
  /** Endereço do aviso que vai em cada pedido (PagBank: notification_urls; F8-09.c.2). */
  notificationUrl?: string | null;
}

/** Cobrança no parceiro, como o Bipaê entende. */
export interface PspCharge {
  id: string;
  copyPaste: string | null;
  status: 'pending' | 'paid' | 'canceled' | 'expired';
  /** ID do pagamento no parceiro, quando pago. */
  paymentRef: string | null;
}

export interface PspCreateInput {
  reference: string;
  amountCents: number;
  description: string;
  expiresAt: Date;
}

export interface PixPspClient {
  create(input: PspCreateInput): Promise<PspCharge>;
  get(id: string): Promise<PspCharge>;
  /** Cancela no parceiro; false quando o parceiro não oferece cancelamento (o QR vence sozinho). */
  cancel(id: string): Promise<boolean>;
}

/** Quanto tempo o QR vale em cada parceiro (o Mercado Pago exige pelo menos 30 minutos). */
export const PSP_EXPIRES_SECONDS: Record<PixPspProvider, number> = {
  mercadopago: 30 * 60,
  pagbank: 10 * 60,
  asaas: 10 * 60,
};

/** Centavos para o texto decimal que as APIs esperam ("25.90"), sem passar por ponto flutuante. */
export function centsToDecimal(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) throw new Error('Valor em centavos inválido');
  const s = String(cents).padStart(3, '0');
  return `${s.slice(0, -2)}.${s.slice(-2)}`;
}

/**
 * JSON com um valor numérico decimal escrito do jeito exato ("transaction_amount": 25.90), porque
 * Mercado Pago e Asaas recebem número em reais. O texto vem de centsToDecimal.
 */
function jsonWithAmount(body: Record<string, unknown>, field: string, decimal: string): string {
  const marker = '__BIPAE_AMOUNT__';
  return JSON.stringify({ ...body, [field]: marker }).replace(`"${marker}"`, decimal);
}

/** Data com o fuso de Brasília (sem horário de verão desde 2019): 2026-10-21T15:30:00.000-03:00. */
export function brasiliaIso(date: Date): string {
  const shifted = new Date(date.getTime() - 3 * 3600_000);
  return `${shifted.toISOString().slice(0, 23)}-03:00`;
}

const brasiliaDay = (date: Date) => brasiliaIso(date).slice(0, 10);

interface Raw {
  status: number;
  json: unknown;
}

abstract class BaseClient implements PixPspClient {
  protected readonly name: string;

  constructor(
    protected readonly config: PixPspConfig,
    protected readonly transport: PixTransport,
  ) {
    this.name = PIX_PSP_INFO[config.provider].name;
  }

  abstract create(input: PspCreateInput): Promise<PspCharge>;
  abstract get(id: string): Promise<PspCharge>;
  abstract cancel(id: string): Promise<boolean>;

  protected abstract headers(): Record<string, string>;
  /** Mensagem de erro do parceiro, no formato de cada um. */
  protected abstract errorText(json: unknown): string | undefined;

  protected async send(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    body?: string,
    extra: Record<string, string> = {},
  ): Promise<Raw> {
    const res = await this.transport.send(
      {
        method,
        url,
        headers: {
          ...this.headers(),
          Accept: 'application/json',
          ...(body !== undefined && { 'Content-Type': 'application/json' }),
          ...extra,
        },
        ...(body !== undefined && { body }),
      },
      null,
    );
    if (res.status >= 500) throw new PixUnavailableError(`O ${this.name} respondeu ${res.status}.`);
    if (res.status === 401 || res.status === 403) {
      throw new PixRejectedError(
        `O ${this.name} recusou o token de acesso. Confira em Meios de pagamento.`,
      );
    }
    let json: unknown;
    try {
      json = JSON.parse(res.body || '{}');
    } catch {
      throw new PixUnavailableError(`O ${this.name} respondeu algo que não é JSON.`);
    }
    if (res.status >= 400) {
      throw new PixRejectedError(
        `O ${this.name} recusou a cobrança: ${this.errorText(json) ?? `status ${res.status}`}.`,
      );
    }
    return { status: res.status, json };
  }
}

/** Mercado Pago: pagamento Pix pela API de pagamentos. */
interface MpPayment {
  id: number | string;
  status: string;
  status_detail?: string;
  point_of_interaction?: { transaction_data?: { qr_code?: string } };
}

export class MercadoPagoPixClient extends BaseClient {
  private static readonly BASE = 'https://api.mercadopago.com';

  protected headers() {
    return { Authorization: `Bearer ${this.config.token}` };
  }

  protected errorText(json: unknown) {
    const e = json as { message?: string; cause?: { description?: string }[] };
    return e.cause?.[0]?.description ?? e.message;
  }

  private map(p: MpPayment): PspCharge {
    const status =
      p.status === 'approved'
        ? 'paid'
        : p.status === 'cancelled' && p.status_detail === 'expired'
          ? 'expired'
          : ['cancelled', 'rejected', 'refunded', 'charged_back'].includes(p.status)
            ? 'canceled'
            : 'pending';
    return {
      id: String(p.id),
      copyPaste: p.point_of_interaction?.transaction_data?.qr_code ?? null,
      status,
      paymentRef: status === 'paid' ? String(p.id) : null,
    };
  }

  async create(input: PspCreateInput): Promise<PspCharge> {
    // Já guardado sem máscara (CPF, CNPJ ou o CNPJ alfanumérico).
    const digits = this.config.payerTaxId ?? '';
    const body = jsonWithAmount(
      {
        description: input.description.slice(0, 200),
        payment_method_id: 'pix',
        external_reference: input.reference,
        date_of_expiration: brasiliaIso(input.expiresAt),
        payer: {
          email: this.config.payerEmail,
          ...(digits && {
            identification: { type: digits.length === 11 ? 'CPF' : 'CNPJ', number: digits },
          }),
        },
      },
      'transaction_amount',
      centsToDecimal(input.amountCents),
    );
    const res = await this.send('POST', `${MercadoPagoPixClient.BASE}/v1/payments`, body, {
      // A mesma referência nunca cria dois pagamentos.
      'X-Idempotency-Key': input.reference,
    });
    return this.map(res.json as MpPayment);
  }

  async get(id: string): Promise<PspCharge> {
    const res = await this.send(
      'GET',
      `${MercadoPagoPixClient.BASE}/v1/payments/${encodeURIComponent(id)}`,
    );
    return this.map(res.json as MpPayment);
  }

  async cancel(id: string): Promise<boolean> {
    await this.send(
      'PUT',
      `${MercadoPagoPixClient.BASE}/v1/payments/${encodeURIComponent(id)}`,
      JSON.stringify({ status: 'cancelled' }),
    );
    return true;
  }
}

/** PagBank: pedido com QR Code Pix (valor em centavos). */
interface PagBankOrder {
  id: string;
  qr_codes?: { id: string; text?: string; expiration_date?: string }[];
  charges?: { id: string; status: string }[];
}

export class PagBankPixClient extends BaseClient {
  private get base() {
    return this.config.sandbox ? 'https://sandbox.api.pagseguro.com' : 'https://api.pagseguro.com';
  }

  protected headers() {
    return { Authorization: `Bearer ${this.config.token}` };
  }

  protected errorText(json: unknown) {
    const e = json as { error_messages?: { description?: string; parameter_name?: string }[] };
    const first = e.error_messages?.[0];
    if (!first) return undefined;
    return first.parameter_name
      ? `${first.description ?? 'dado inválido'} (${first.parameter_name})`
      : first.description;
  }

  private map(o: PagBankOrder, now = new Date()): PspCharge {
    const paid = o.charges?.find((c) => c.status === 'PAID');
    const expiration = o.qr_codes?.[0]?.expiration_date;
    const expired = !paid && expiration ? new Date(expiration).getTime() < now.getTime() : false;
    return {
      id: o.id,
      copyPaste: o.qr_codes?.[0]?.text ?? null,
      status: paid ? 'paid' : expired ? 'expired' : 'pending',
      paymentRef: paid?.id ?? null,
    };
  }

  async create(input: PspCreateInput): Promise<PspCharge> {
    const res = await this.send(
      'POST',
      `${this.base}/orders`,
      JSON.stringify({
        reference_id: input.reference,
        customer: {
          name: this.config.payerName,
          email: this.config.payerEmail,
          tax_id: this.config.payerTaxId,
        },
        items: [
          { name: input.description.slice(0, 64), quantity: 1, unit_amount: input.amountCents },
        ],
        qr_codes: [
          { amount: { value: input.amountCents }, expiration_date: brasiliaIso(input.expiresAt) },
        ],
        // O PagBank avisa neste endereço; o aviso só apressa a consulta (F8-09.c.2).
        ...(this.config.notificationUrl && { notification_urls: [this.config.notificationUrl] }),
      }),
      // O reference_id já é nosso; a chave evita pedido duplicado numa nova tentativa.
      { 'x-idempotency-key': input.reference },
    );
    return this.map(res.json as PagBankOrder);
  }

  async get(id: string): Promise<PspCharge> {
    const res = await this.send('GET', `${this.base}/orders/${encodeURIComponent(id)}`);
    return this.map(res.json as PagBankOrder);
  }

  /** A referência do PagBank não traz cancelamento de QR: ele vence sozinho no prazo. */
  cancel(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

/** Asaas: cobrança com billingType PIX e o QR dela. */
interface AsaasPayment {
  id: string;
  status: string;
  deleted?: boolean;
}

export class AsaasPixClient extends BaseClient {
  private get base() {
    return this.config.sandbox ? 'https://api-sandbox.asaas.com/v3' : 'https://api.asaas.com/v3';
  }

  protected headers() {
    // O Asaas exige User-Agent nas contas novas.
    return { access_token: this.config.token, 'User-Agent': 'Bipae/1.0' };
  }

  protected errorText(json: unknown) {
    return (json as { errors?: { description?: string }[] }).errors?.[0]?.description;
  }

  private map(p: AsaasPayment, copyPaste: string | null): PspCharge {
    const paid = ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'].includes(p.status);
    return {
      id: p.id,
      copyPaste,
      status: paid
        ? 'paid'
        : p.deleted || p.status.startsWith('REFUND') || p.status.includes('CHARGEBACK')
          ? 'canceled'
          : p.status === 'OVERDUE'
            ? 'expired'
            : 'pending',
      paymentRef: paid ? p.id : null,
    };
  }

  async create(input: PspCreateInput): Promise<PspCharge> {
    const created = await this.send(
      'POST',
      `${this.base}/payments`,
      jsonWithAmount(
        {
          customer: this.config.customerId,
          billingType: 'PIX',
          dueDate: brasiliaDay(input.expiresAt),
          description: input.description.slice(0, 500),
          externalReference: input.reference,
        },
        'value',
        centsToDecimal(input.amountCents),
      ),
    );
    const payment = created.json as AsaasPayment;
    const qr = await this.send(
      'GET',
      `${this.base}/payments/${encodeURIComponent(payment.id)}/pixQrCode`,
    );
    return this.map(payment, (qr.json as { payload?: string }).payload ?? null);
  }

  async get(id: string): Promise<PspCharge> {
    const res = await this.send('GET', `${this.base}/payments/${encodeURIComponent(id)}`);
    return this.map(res.json as AsaasPayment, null);
  }

  async cancel(id: string): Promise<boolean> {
    await this.send('DELETE', `${this.base}/payments/${encodeURIComponent(id)}`);
    return true;
  }
}

export function pixPspClient(config: PixPspConfig, transport: PixTransport): PixPspClient {
  switch (config.provider) {
    case 'mercadopago':
      return new MercadoPagoPixClient(config, transport);
    case 'pagbank':
      return new PagBankPixClient(config, transport);
    case 'asaas':
      return new AsaasPixClient(config, transport);
  }
}
