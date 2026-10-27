import { boletoDueFactor, boletoMod10, uuidv7 } from '@bipae/domain';
import { PixRejectedError, PixUnavailableError, type PixTransport } from './pix-api';
import { centsToDecimal } from './pix-psp';

/**
 * Boleto registrado por um parceiro de cobrança (PSP) (F4-15). Hoje só o Asaas tem adaptador,
 * pela mesma conta e token do Pix dele (Meios de pagamento). Documentação do Asaas usada
 * (https://docs.asaas.com, caminhos como o projeto os conhece; não reconferidos em 27/10/2026
 * por falta de conta de teste, E9): POST /v3/customers, GET /v3/customers?cpfCnpj=,
 * POST /v3/payments (billingType BOLETO), GET /v3/payments/{id},
 * GET /v3/payments/{id}/identificationField e DELETE /v3/payments/{id}.
 */
export type BoletoPspStatus = 'registered' | 'paid' | 'overdue' | 'canceled';

export interface BoletoPspSlip {
  externalId: string;
  status: BoletoPspStatus;
  digitableLine: string | null;
  barcode: string | null;
  pdfUrl: string | null;
  paidCents: number | null;
  /** AAAA-MM-DD */
  paidOn: string | null;
}

export interface BoletoPspRegister {
  /** Nosso identificador: serve para achar o boleto se o registro foi feito e a resposta se perdeu. */
  reference: string;
  amountCents: number;
  dueDate: string;
  description: string;
  payerName: string;
  payerTaxId: string;
}

export interface BoletoPsp {
  readonly provider: 'asaas' | 'simulator';
  register(input: BoletoPspRegister): Promise<BoletoPspSlip>;
  get(externalId: string): Promise<BoletoPspSlip>;
  cancel(externalId: string): Promise<void>;
}

// ---------------------------------------------------------------------------- Asaas

interface AsaasPayment {
  id: string;
  status: string;
  deleted?: boolean;
  value?: number;
  netValue?: number;
  paymentDate?: string | null;
  clientPaymentDate?: string | null;
  bankSlipUrl?: string | null;
}

export class AsaasBoletoPsp implements BoletoPsp {
  readonly provider = 'asaas' as const;

  constructor(
    private readonly config: { token: string; sandbox: boolean },
    private readonly transport: PixTransport,
  ) {}

  private get base() {
    return this.config.sandbox ? 'https://api-sandbox.asaas.com/v3' : 'https://api.asaas.com/v3';
  }

  private async send(method: 'GET' | 'POST' | 'DELETE', path: string, body?: string) {
    const res = await this.transport.send(
      {
        method,
        url: `${this.base}${path}`,
        headers: {
          access_token: this.config.token,
          'User-Agent': 'Bipae/1.0',
          Accept: 'application/json',
          ...(body !== undefined && { 'Content-Type': 'application/json' }),
        },
        ...(body !== undefined && { body }),
      },
      null,
    );
    if (res.status >= 500) throw new PixUnavailableError(`O Asaas respondeu ${res.status}.`);
    if (res.status === 401 || res.status === 403) {
      throw new PixRejectedError(
        'O Asaas recusou o token de acesso. Confira em Meios de pagamento.',
      );
    }
    let json: unknown;
    try {
      json = JSON.parse(res.body || '{}');
    } catch {
      throw new PixUnavailableError('O Asaas respondeu algo que não é JSON.');
    }
    if (res.status >= 400) {
      const text = (json as { errors?: { description?: string }[] }).errors?.[0]?.description;
      throw new PixRejectedError(text ?? `O Asaas recusou o pedido (${res.status}).`);
    }
    return json;
  }

  private map(p: AsaasPayment, extra: Partial<BoletoPspSlip> = {}): BoletoPspSlip {
    const paid = ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'].includes(p.status);
    return {
      externalId: p.id,
      status: paid
        ? 'paid'
        : p.deleted || p.status.startsWith('REFUND') || p.status.includes('CHARGEBACK')
          ? 'canceled'
          : p.status === 'OVERDUE'
            ? 'overdue'
            : 'registered',
      digitableLine: null,
      barcode: null,
      pdfUrl: p.bankSlipUrl ?? null,
      paidCents:
        paid && typeof p.value === 'number' ? Number(p.value.toFixed(2).replace('.', '')) : null,
      paidOn: paid ? (p.paymentDate ?? p.clientPaymentDate ?? null) : null,
      ...extra,
    };
  }

  private async customerId(name: string, taxId: string): Promise<string> {
    const found = (await this.send(
      'GET',
      `/customers?cpfCnpj=${encodeURIComponent(taxId)}&limit=1`,
    )) as {
      data?: { id: string }[];
    };
    if (found.data?.[0]) return found.data[0].id;
    const created = (await this.send(
      'POST',
      '/customers',
      JSON.stringify({ name, cpfCnpj: taxId }),
    )) as {
      id: string;
    };
    return created.id;
  }

  private async slipFields(id: string) {
    const f = (await this.send(
      'GET',
      `/payments/${encodeURIComponent(id)}/identificationField`,
    )) as {
      identificationField?: string;
      barCode?: string;
    };
    return { digitableLine: f.identificationField ?? null, barcode: f.barCode ?? null };
  }

  async register(input: BoletoPspRegister): Promise<BoletoPspSlip> {
    // Se um registro anterior chegou ao Asaas e a resposta se perdeu, reaproveita o mesmo boleto.
    const existing = (await this.send(
      'GET',
      `/payments?externalReference=${encodeURIComponent(input.reference)}&limit=1`,
    )) as { data?: AsaasPayment[] };
    let payment = existing.data?.[0];
    if (!payment) {
      const customer = await this.customerId(input.payerName, input.payerTaxId);
      const marker = '__BIPAE_VALOR__';
      const body = JSON.stringify({
        customer,
        billingType: 'BOLETO',
        value: marker,
        dueDate: input.dueDate,
        description: input.description.slice(0, 500),
        externalReference: input.reference,
      }).replace(`"${marker}"`, centsToDecimal(input.amountCents));
      payment = (await this.send('POST', '/payments', body)) as AsaasPayment;
    }
    return this.map(payment, await this.slipFields(payment.id));
  }

  async get(externalId: string): Promise<BoletoPspSlip> {
    const p = (await this.send(
      'GET',
      `/payments/${encodeURIComponent(externalId)}`,
    )) as AsaasPayment;
    return this.map(p);
  }

  async cancel(externalId: string): Promise<void> {
    await this.send('DELETE', `/payments/${encodeURIComponent(externalId)}`);
  }
}

// ---------------------------------------------------------------------------- Simulador

/** Módulo 11 do dígito geral do código de barras (pesos 2 a 9 da direita; 0, 10 e 11 viram 1). */
function barcodeCheckDigit(digits43: string): number {
  let sum = 0;
  let weight = 2;
  for (let i = digits43.length - 1; i >= 0; i--) {
    sum += Number(digits43[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const dv = 11 - (sum % 11);
  return dv === 0 || dv === 10 || dv === 11 ? 1 : dv;
}

/** Código de barras (44) e linha digitável (47) válidos, de um banco de mentira (999). */
export function simulatedBoletoCodes(amountCents: number, dueDate: string, seed: number) {
  const value = String(amountCents).padStart(10, '0');
  const factor = String(boletoDueFactor(dueDate)).padStart(4, '0');
  const free = String(seed % 10 ** 25).padStart(25, '0');
  const base = `9999${factor}${value}${free}`;
  const barcode = `999${9}${barcodeCheckDigit(base)}${factor}${value}${free}`;
  const f1 = barcode.slice(0, 4) + barcode.slice(19, 24);
  const f2 = barcode.slice(24, 34);
  const f3 = barcode.slice(34, 44);
  const line = `${f1}${boletoMod10(f1)}${f2}${boletoMod10(f2)}${f3}${boletoMod10(f3)}${barcode[4]}${barcode.slice(5, 19)}`;
  return { barcode, digitableLine: line };
}

export class SimulatedBoletoHub {
  private readonly slips = new Map<string, BoletoPspSlip & { reference: string }>();
  private counter = 1;
  failNext = 0;

  psp(): BoletoPsp {
    return {
      provider: 'simulator',
      register: (input) => {
        if (this.failNext > 0) {
          this.failNext -= 1;
          return Promise.reject(new PixUnavailableError('Falha simulada do parceiro.'));
        }
        const same = [...this.slips.values()].find((s) => s.reference === input.reference);
        if (same) return Promise.resolve(same);
        const id = `sim_${uuidv7().slice(-10)}`;
        const codes = simulatedBoletoCodes(input.amountCents, input.dueDate, this.counter++);
        const slip = {
          externalId: id,
          reference: input.reference,
          status: 'registered' as const,
          ...codes,
          pdfUrl: null,
          paidCents: null,
          paidOn: null,
        };
        this.slips.set(id, slip);
        return Promise.resolve(slip);
      },
      get: (id) => {
        const s = this.slips.get(id);
        return s ? Promise.resolve(s) : Promise.reject(new PixRejectedError('Boleto não existe.'));
      },
      cancel: (id) => {
        const s = this.slips.get(id);
        if (s && s.status !== 'paid') s.status = 'canceled';
        return Promise.resolve();
      },
    };
  }

  /** O pagador "paga" no banco de mentira (o valor cheio, ou o que for passado). */
  pay(externalId: string, paidCents: number, paidOn: string) {
    const s = this.slips.get(externalId);
    if (!s) throw new Error('Boleto não existe no simulador.');
    s.status = 'paid';
    s.paidCents = paidCents;
    s.paidOn = paidOn;
  }

  expire(externalId: string) {
    const s = this.slips.get(externalId);
    if (s && s.status === 'registered') s.status = 'overdue';
  }
}
