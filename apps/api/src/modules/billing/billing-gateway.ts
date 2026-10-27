import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { BillingGatewayView, PixPspProvider } from '@bipae/domain';
import { CONFIG } from '../../common/di';
import { AppError } from '../../common/errors';
import type { Config } from '../../config';
import {
  HttpsPixTransport,
  PixRejectedError,
  PixUnavailableError,
  type PixTransport,
} from '../payments/pix-api';
import { pixPspClient, type PspCharge } from '../payments/pix-psp';

/** Quem paga: o cliente do Bipaê (dados do dono e do CNPJ da conta). */
export interface BillingPayer {
  name: string;
  email: string;
  taxId: string | null;
}

export interface BillingChargeInput {
  reference: string;
  amountCents: number;
  description: string;
  expiresAt: Date;
  payer: BillingPayer;
}

export interface BillingCharge {
  id: string;
  copyPaste: string | null;
  status: PspCharge['status'];
}

/**
 * Meio de cobrança das mensalidades (F6-04): a conta do próprio Bipaê, não a da loja. Reaproveita
 * os clientes Pix dos parceiros da base de pagamentos (F8-09.c) com o token da plataforma.
 * Confirmação sempre por consulta. O simulador existe só fora da produção.
 */
export interface BillingGateway {
  readonly mode: BillingGatewayView['mode'];
  create(input: BillingChargeInput): Promise<BillingCharge>;
  get(id: string): Promise<BillingCharge>;
  /** Só o simulador: faz de conta que o cliente pagou. */
  simulatePay?(id: string): boolean;
}

/** Pix de mentira em memória, para desenvolvimento e testes. */
export class SimulatedBillingGateway implements BillingGateway {
  readonly mode = 'simulator' as const;
  private readonly charges = new Map<string, BillingCharge>();

  async create(input: BillingChargeInput): Promise<BillingCharge> {
    const id = `SIM-${randomUUID()}`;
    const charge: BillingCharge = {
      id,
      copyPaste: `SIMULADOR-PIX|${id}|${input.amountCents}`,
      status: 'pending',
    };
    this.charges.set(id, charge);
    return { ...charge };
  }

  async get(id: string): Promise<BillingCharge> {
    // Cobrança desconhecida (a API reiniciou): segue pendente, nunca "paga".
    return { ...(this.charges.get(id) ?? { id, copyPaste: null, status: 'pending' as const }) };
  }

  simulatePay(id: string): boolean {
    const charge = this.charges.get(id);
    if (!charge) return false;
    charge.status = 'paid';
    return true;
  }
}

/** Pix do parceiro (Mercado Pago ou PagBank) com o token da conta do Bipaê. */
export class PspBillingGateway implements BillingGateway {
  readonly mode = 'pix' as const;

  constructor(
    private readonly provider: PixPspProvider,
    private readonly token: string,
    private readonly sandbox: boolean,
    private readonly transport: () => PixTransport,
  ) {}

  private client(payer: BillingPayer) {
    return pixPspClient(
      {
        provider: this.provider,
        sandbox: this.sandbox,
        token: this.token,
        payerName: payer.name,
        payerEmail: payer.email,
        payerTaxId: payer.taxId,
        customerId: null,
      },
      this.transport(),
    );
  }

  async create(input: BillingChargeInput): Promise<BillingCharge> {
    try {
      const charge = await this.client(input.payer).create({
        reference: input.reference,
        amountCents: input.amountCents,
        description: input.description,
        expiresAt: input.expiresAt,
      });
      return { id: charge.id, copyPaste: charge.copyPaste, status: charge.status };
    } catch (error) {
      throw translate(error);
    }
  }

  async get(id: string): Promise<BillingCharge> {
    try {
      const charge = await this.client({
        name: 'Bipaê',
        email: 'cobranca@bipae.com.br',
        taxId: null,
      }).get(id);
      return { id: charge.id, copyPaste: charge.copyPaste, status: charge.status };
    } catch (error) {
      throw translate(error);
    }
  }
}

function translate(error: unknown): Error {
  if (error instanceof PixUnavailableError) {
    return new AppError(
      503,
      'billing_unavailable',
      'O meio de pagamento não respondeu agora. Tente de novo em instantes.',
    );
  }
  if (error instanceof PixRejectedError) {
    return new AppError(422, 'billing_rejected', error.message);
  }
  return error as Error;
}

export const BILLING_GATEWAY_INFO: Record<BillingGatewayView['mode'], string | null> = {
  simulator: 'Modo de teste: o pagamento é simulado, nenhum dinheiro se move.',
  pix: null,
  off: 'A cobrança automática ainda não está ligada. Fale com o suporte do Bipaê para assinar.',
};

/** Escolhe o meio pela configuração; sem configuração, `off` (falta configurar). */
@Injectable()
export class BillingGatewayHolder {
  /** Trocado nos testes pelo parceiro simulado. */
  transport: PixTransport = new HttpsPixTransport();
  readonly gateway: BillingGateway | null;

  constructor(@Inject(CONFIG) config: Config) {
    const provider = config.BILLING_PROVIDER;
    if (provider === 'simulator' && config.NODE_ENV !== 'production') {
      this.gateway = new SimulatedBillingGateway();
    } else if ((provider === 'mercadopago' || provider === 'pagbank') && config.BILLING_TOKEN) {
      this.gateway = new PspBillingGateway(
        provider,
        config.BILLING_TOKEN,
        config.BILLING_SANDBOX,
        () => this.transport,
      );
    } else {
      this.gateway = null;
    }
  }

  get view(): BillingGatewayView {
    const mode = this.gateway?.mode ?? 'off';
    return { mode, cardAvailable: false, message: BILLING_GATEWAY_INFO[mode] };
  }
}
