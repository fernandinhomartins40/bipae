import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { CONFIG } from '../../common/di';
import { AppError } from '../../common/errors';
import { SecretBox } from '../../common/secrets';
import type { Config } from '../../config';
import { AsaasBoletoPsp, SimulatedBoletoHub, type BoletoPsp } from '../payments/boleto.psp';
import {
  HttpsPixTransport,
  PixRejectedError,
  PixUnavailableError,
  type PixTransport,
} from '../payments/pix-api';
import type { BillingPayer } from './billing-gateway';

/**
 * Boleto e cartão recorrente como formas de pagar a fatura do plano (F6-04.c). Os dois usam a conta
 * do próprio Bipaê no parceiro, nunca a da loja. O boleto reaproveita a porta `BoletoPsp` da base de
 * cobrança (F4-15); o cartão é uma porta nova, porque o cartão salvo no parceiro ainda não tem
 * adaptador real (depende da conta do parceiro, item E9): sem isso, a tela diz "chega em breve".
 */

export interface BillingBoletoInput {
  reference: string;
  amountCents: number;
  /** AAAA-MM-DD */
  dueDate: string;
  description: string;
  payer: BillingPayer;
}

export interface BillingBoleto {
  id: string;
  line: string | null;
  url: string | null;
  status: 'registered' | 'paid' | 'overdue' | 'canceled';
}

export interface BillingBoletoGateway {
  readonly mode: 'asaas' | 'simulator';
  register(input: BillingBoletoInput): Promise<BillingBoleto>;
  get(id: string): Promise<BillingBoleto>;
  /** Só o simulador: faz de conta que o cliente pagou o boleto. */
  simulatePay?(id: string, amountCents: number): void;
}

function translate(error: unknown): Error {
  if (error instanceof PixUnavailableError) {
    return new AppError(
      503,
      'billing_unavailable',
      'O meio de pagamento não respondeu agora. Tente de novo em instantes.',
    );
  }
  if (error instanceof PixRejectedError)
    return new AppError(422, 'billing_rejected', error.message);
  return error as Error;
}

class PspBoletoGateway implements BillingBoletoGateway {
  constructor(
    readonly mode: 'asaas' | 'simulator',
    private readonly psp: BoletoPsp,
    private readonly hub?: SimulatedBoletoHub,
  ) {}

  async register(input: BillingBoletoInput): Promise<BillingBoleto> {
    if (!input.payer.taxId) {
      throw new AppError(
        422,
        'billing_payer_without_tax_id',
        'Cadastre o CNPJ da empresa antes de gerar o boleto.',
      );
    }
    try {
      const slip = await this.psp.register({
        reference: input.reference,
        amountCents: input.amountCents,
        dueDate: input.dueDate,
        description: input.description,
        payerName: input.payer.name,
        payerTaxId: input.payer.taxId,
      });
      return {
        id: slip.externalId,
        line: slip.digitableLine,
        url: slip.pdfUrl,
        status: slip.status,
      };
    } catch (error) {
      throw translate(error);
    }
  }

  async get(id: string): Promise<BillingBoleto> {
    try {
      const slip = await this.psp.get(id);
      return {
        id: slip.externalId,
        line: slip.digitableLine,
        url: slip.pdfUrl,
        status: slip.status,
      };
    } catch (error) {
      throw translate(error);
    }
  }

  simulatePay(id: string, amountCents: number) {
    if (!this.hub) throw new Error('Só o simulador paga boleto de mentira.');
    this.hub.pay(id, amountCents, new Date().toISOString().slice(0, 10));
  }
}

export interface SavedCard {
  /** Identificador do cartão no parceiro (nunca o número do cartão). */
  cardRef: string;
  brand: string | null;
  last4: string | null;
}

export interface BillingCardGateway {
  readonly mode: 'simulator';
  /** Troca o código gerado pela tela do parceiro por um cartão salvo para cobranças futuras. */
  save(input: { token: string; payer: BillingPayer }): Promise<SavedCard>;
  charge(input: {
    cardRef: string;
    amountCents: number;
    reference: string;
    description: string;
  }): Promise<{ id: string; approved: boolean; message: string | null }>;
}

/**
 * Cartão de mentira, só fora de produção: o código `tok_recusado` salva o cartão mas toda cobrança
 * é negada; qualquer outro `tok_...` é aprovado.
 */
export class SimulatedBillingCardGateway implements BillingCardGateway {
  readonly mode = 'simulator' as const;

  async save(input: { token: string }): Promise<SavedCard> {
    if (!input.token.startsWith('tok_')) {
      throw new AppError(422, 'billing_card_invalid', 'O código do cartão não foi aceito.');
    }
    return {
      cardRef: input.token === 'tok_recusado' ? 'card_recusado' : `card_${randomUUID()}`,
      brand: 'SIMULADO',
      last4: '4242',
    };
  }

  async charge(input: { cardRef: string }) {
    if (input.cardRef === 'card_recusado') {
      return {
        id: `SIM-${randomUUID()}`,
        approved: false,
        message: 'Cartão recusado pelo emissor (simulador).',
      };
    }
    return { id: `SIM-${randomUUID()}`, approved: true, message: null };
  }
}

export const BILLING_BOLETO_INFO =
  'O boleto ainda não está ligado: falta a conta do Bipaê no parceiro de cobrança (item E9).';
export const BILLING_CARD_INFO =
  'O cartão recorrente chega em breve: falta a conta do Bipaê no parceiro de cobrança (item E9).';

/** Escolhe os meios pela configuração; sem configuração, ficam `null` ("falta configurar"). */
@Injectable()
export class BillingMethodsHolder {
  /** Trocado nos testes pelo parceiro simulado. */
  transport: PixTransport = new HttpsPixTransport();
  readonly hub = new SimulatedBoletoHub();
  readonly boleto: BillingBoletoGateway | null;
  readonly card: BillingCardGateway | null;
  private readonly box: SecretBox;

  constructor(@Inject(CONFIG) config: Config) {
    this.box = new SecretBox(config.SECRETS_KEY ?? config.JWT_SECRET);
    const production = config.NODE_ENV === 'production';
    if (config.BILLING_BOLETO_PROVIDER === 'simulator' && !production) {
      this.boleto = new PspBoletoGateway('simulator', this.hub.psp(), this.hub);
    } else if (config.BILLING_BOLETO_PROVIDER === 'asaas' && config.BILLING_BOLETO_TOKEN) {
      this.boleto = new PspBoletoGateway(
        'asaas',
        new AsaasBoletoPsp(
          { token: config.BILLING_BOLETO_TOKEN, sandbox: config.BILLING_SANDBOX },
          // O transporte é lido a cada uso, para os testes poderem trocá-lo.
          { send: (request, agent) => this.transport.send(request, agent) },
        ),
      );
    } else {
      this.boleto = null;
    }
    this.card =
      config.BILLING_CARD_PROVIDER === 'simulator' && !production
        ? new SimulatedBillingCardGateway()
        : null;
  }

  seal(plain: string): string {
    return this.box.seal(plain);
  }

  open(sealed: string): string {
    return this.box.open(sealed);
  }
}
