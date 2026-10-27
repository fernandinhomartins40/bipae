import { timingSafeEqual } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Injectable,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import {
  boletoInput,
  isValidCnpj,
  isValidCpf,
  normalizeTaxId,
  uuidv7,
  type BoletoStatus,
  type BoletoView,
} from '@bipae/domain';
import { and, asc, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { Config } from '../../config';
import { Ctx, Public, RequirePermission, type RequestContext } from '../../common/auth';
import { CONFIG, DB } from '../../common/di';
import { AppError, notFound, parse } from '../../common/errors';
import { SecretBox } from '../../common/secrets';
import { asPlatform, withTenant, type Db } from '../../db/client';
import { financialEntries, paymentSettings } from '../../db/schema';
import { boletoCharges } from '../../db/schema-channels';
import { AuditService } from '../audit/audit.service';
import { todayBr } from '../finance/finance.service';
import {
  AsaasBoletoPsp,
  SimulatedBoletoHub,
  type BoletoPsp,
  type BoletoPspSlip,
} from './boleto.psp';
import { HttpsPixTransport, PixRejectedError, type PixTransport } from './pix-api';

type Row = typeof boletoCharges.$inferSelect;

const RECEIVED = { received: true } as const;
const RATE_LIMIT = { rateLimit: { max: 600, timeWindow: '1 minute' } };
const MAX_BODY = 64 * 1024;
const OPEN: BoletoStatus[] = ['pending', 'registered', 'overdue'];

function sameText(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Boletos via PSP (F4-15): emissão (registro no parceiro), baixa por aviso ou consulta e
 * conciliação com a conta a receber. O aviso nunca baixa sozinho: o Bipaê consulta o parceiro
 * antes (regra do CLAUDE.md para webhooks de pagamento). O dinheiro fica em centavos inteiros.
 * Não faz: arquivo de retorno CNAB, instruções de multa/juros e baixa por data de crédito
 * (chegam em breve).
 */
@Injectable()
export class BoletoService {
  private readonly logger = new Logger('Boletos');
  private readonly box: SecretBox;
  /** Troca nos testes para falar com um Asaas de mentira. */
  transport: PixTransport = new HttpsPixTransport();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SimulatedBoletoHub) readonly hub: SimulatedBoletoHub,
  ) {
    this.box = new SecretBox(config.SECRETS_KEY ?? config.JWT_SECRET);
  }

  private get production() {
    return this.config.NODE_ENV === 'production';
  }

  /** O parceiro de boleto da conta: o Asaas dos Meios de pagamento, ou o simulador fora de produção. */
  private async psp(tenantId: string, provider?: Row['provider']): Promise<BoletoPsp> {
    const settings = await withTenant(this.db, { tenantId }, (tx) =>
      tx
        .select({
          token: paymentSettings.pixPspTokenSealed,
          sandbox: paymentSettings.pixPspSandbox,
        })
        .from(paymentSettings)
        .where(
          and(
            eq(paymentSettings.pixPspProvider, 'asaas'),
            isNotNull(paymentSettings.pixPspTokenSealed),
          ),
        )
        .limit(1),
    );
    const s = settings[0];
    if (provider !== 'simulator' && s?.token) {
      return new AsaasBoletoPsp(
        { token: this.box.open(s.token), sandbox: s.sandbox },
        this.transport,
      );
    }
    if (provider !== 'asaas' && !this.production) return this.hub.psp();
    throw new AppError(
      422,
      'boleto_not_configured',
      'Falta configurar: ligue a conta do Asaas em Meios de pagamento para emitir boletos.',
    );
  }

  /** Para a tela: se dá para emitir boleto agora e por qual parceiro. */
  async capability(ctx: RequestContext) {
    try {
      const p = await this.psp(ctx.tenantId);
      return { available: true, provider: p.provider, missing: null };
    } catch (e) {
      return { available: false, provider: null, missing: (e as Error).message };
    }
  }

  private view(r: Row): BoletoView {
    return {
      id: r.id,
      provider: r.provider,
      status: r.status,
      payerName: r.payerName,
      payerTaxId: r.payerTaxId,
      amountCents: r.amountCents,
      paidCents: r.paidCents,
      dueDate: r.dueDate,
      description: r.description,
      digitableLine: r.digitableLine,
      barcode: r.barcode,
      pdfUrl: r.pdfUrl,
      financialEntryId: r.financialEntryId,
      failure: r.failure,
      paidAt: r.paidAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    };
  }

  list(ctx: RequestContext, status?: string) {
    return withTenant(this.db, ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(boletoCharges)
        .where(status ? eq(boletoCharges.status, status as BoletoStatus) : undefined)
        .orderBy(desc(boletoCharges.createdAt))
        .limit(200);
      return rows.map((r) => this.view(r));
    });
  }

  async get(ctx: RequestContext, id: string) {
    return withTenant(this.db, ctx, async (tx) => {
      const [r] = await tx.select().from(boletoCharges).where(eq(boletoCharges.id, id));
      if (!r) throw notFound('Boleto');
      return this.view(r);
    });
  }

  /** Cria e registra no parceiro. O mesmo `id` mandado de novo devolve o mesmo boleto. */
  async create(ctx: RequestContext, body: unknown): Promise<BoletoView> {
    const input = parse(boletoInput, body);
    const taxId = normalizeTaxId(input.payerTaxId);
    if (!isValidCpf(taxId) && !isValidCnpj(taxId)) {
      throw new AppError(422, 'invalid_tax_id', 'CPF ou CNPJ do pagador inválido.');
    }
    if (input.dueDate < todayBr()) {
      throw new AppError(422, 'invalid_due_date', 'O vencimento não pode ser no passado.');
    }
    const psp = await this.psp(ctx.tenantId);
    const id = input.id ?? uuidv7();
    const created = await withTenant(this.db, ctx, async (tx) => {
      const [again] = await tx.select().from(boletoCharges).where(eq(boletoCharges.id, id));
      if (again) return { row: again, fresh: false };
      if (input.financialEntryId) {
        const [entry] = await tx
          .select()
          .from(financialEntries)
          .where(eq(financialEntries.id, input.financialEntryId));
        if (!entry || entry.kind !== 'receivable') {
          throw new AppError(422, 'invalid_entry', 'Conta a receber não encontrada.');
        }
        if (entry.status !== 'open') {
          throw new AppError(409, 'entry_closed', 'Essa conta já foi paga ou cancelada.');
        }
        if (entry.amountCents !== input.amountCents) {
          throw new AppError(
            422,
            'amount_mismatch',
            'O valor do boleto precisa ser o da conta a receber.',
          );
        }
        const [live] = await tx
          .select({ id: boletoCharges.id })
          .from(boletoCharges)
          .where(
            and(
              eq(boletoCharges.financialEntryId, input.financialEntryId),
              inArray(boletoCharges.status, [...OPEN, 'paid']),
            ),
          );
        if (live) throw new AppError(409, 'boleto_exists', 'Essa conta já tem um boleto.');
      }
      const [row] = await tx
        .insert(boletoCharges)
        .values({
          id,
          tenantId: ctx.tenantId,
          provider: psp.provider,
          payerName: input.payerName,
          payerTaxId: taxId,
          amountCents: input.amountCents,
          dueDate: input.dueDate,
          description: input.description,
          financialEntryId: input.financialEntryId ?? null,
          createdBy: ctx.userId,
        })
        .returning();
      await this.audit.record(tx, ctx, {
        action: 'boleto.created',
        entity: 'boleto',
        entityId: id,
        data: {
          amountCents: input.amountCents,
          dueDate: input.dueDate,
          entry: input.financialEntryId ?? null,
        },
      });
      return { row: row!, fresh: true };
    });
    if (!created.fresh && created.row.status !== 'pending' && created.row.status !== 'failed') {
      return this.view(created.row);
    }
    return this.register(ctx, created.row, psp);
  }

  /** Registra (ou registra de novo, se falhou) no parceiro. */
  private async register(
    ctx: Pick<RequestContext, 'tenantId' | 'userId'>,
    row: Row,
    psp: BoletoPsp,
  ) {
    let update: Partial<Row>;
    try {
      const slip = await psp.register({
        reference: row.id,
        amountCents: row.amountCents,
        dueDate: row.dueDate,
        description: row.description,
        payerName: row.payerName,
        payerTaxId: row.payerTaxId,
      });
      update = {
        status: slip.status === 'paid' ? 'paid' : 'registered',
        externalId: slip.externalId,
        digitableLine: slip.digitableLine,
        barcode: slip.barcode,
        pdfUrl: slip.pdfUrl,
        failure: null,
      };
    } catch (e) {
      update = { status: 'failed', failure: (e as Error).message.slice(0, 300) };
      this.logger.warn(`Boleto ${row.id} não registrou: ${(e as Error).message}`);
    }
    return withTenant(this.db, ctx, async (tx) => {
      const [saved] = await tx
        .update(boletoCharges)
        .set({ ...update, updatedAt: new Date() })
        .where(eq(boletoCharges.id, row.id))
        .returning();
      return this.view(saved!);
    });
  }

  /** Tenta registrar de novo um boleto que falhou. */
  async retry(ctx: RequestContext, id: string) {
    const row = await withTenant(this.db, ctx, async (tx) => {
      const [r] = await tx.select().from(boletoCharges).where(eq(boletoCharges.id, id));
      return r;
    });
    if (!row) throw notFound('Boleto');
    if (row.status !== 'failed') throw new AppError(409, 'not_failed', 'Esse boleto não falhou.');
    return this.register(ctx, row, await this.psp(ctx.tenantId, row.provider));
  }

  async cancel(ctx: RequestContext, id: string) {
    const row = await withTenant(this.db, ctx, async (tx) => {
      const [r] = await tx.select().from(boletoCharges).where(eq(boletoCharges.id, id));
      return r;
    });
    if (!row) throw notFound('Boleto');
    if (!OPEN.includes(row.status) && row.status !== 'failed') {
      throw new AppError(409, 'not_open', 'Esse boleto não pode mais ser cancelado.');
    }
    if (row.externalId) {
      try {
        await (await this.psp(ctx.tenantId, row.provider)).cancel(row.externalId);
      } catch (e) {
        if (!(e instanceof PixRejectedError)) {
          throw new AppError(
            502,
            'psp_unavailable',
            `Não consegui cancelar no parceiro: ${(e as Error).message}`,
          );
        }
        // O parceiro recusou: pode ter sido pago agora. Consulta antes de decidir.
        const state = await this.refresh(ctx.tenantId, id);
        if (state?.status === 'paid')
          throw new AppError(409, 'already_paid', 'O boleto acabou de ser pago.');
        throw new AppError(422, 'psp_rejected', (e as Error).message);
      }
    }
    return withTenant(this.db, ctx, async (tx) => {
      const [saved] = await tx
        .update(boletoCharges)
        .set({ status: 'canceled', updatedAt: new Date() })
        .where(eq(boletoCharges.id, id))
        .returning();
      await this.audit.record(tx, ctx, {
        action: 'boleto.canceled',
        entity: 'boleto',
        entityId: id,
      });
      return this.view(saved!);
    });
  }

  // ------------------------------------------------------------------ baixa e conciliação

  /** Consulta o parceiro e atualiza. Pago: baixa a conta a receber (uma vez só). */
  async refresh(tenantId: string, id: string): Promise<BoletoView | null> {
    const row = await withTenant(this.db, { tenantId }, async (tx) => {
      const [r] = await tx.select().from(boletoCharges).where(eq(boletoCharges.id, id));
      return r;
    });
    if (!row?.externalId || !OPEN.includes(row.status)) return row ? this.view(row) : null;
    let slip: BoletoPspSlip;
    try {
      slip = await (await this.psp(tenantId, row.provider)).get(row.externalId);
    } catch (e) {
      this.logger.warn(`Boleto ${id}: consulta falhou: ${(e as Error).message}`);
      return this.view(row);
    }
    const actor = { tenantId, userId: row.createdBy };
    return withTenant(this.db, actor, async (tx) => {
      // Trava a linha: aviso e consulta ao mesmo tempo baixam uma vez só.
      const [cur] = await tx
        .select()
        .from(boletoCharges)
        .where(eq(boletoCharges.id, id))
        .for('update');
      if (!cur || !OPEN.includes(cur.status)) return cur ? this.view(cur) : null;
      if (slip.status === 'paid') {
        const paidCents = slip.paidCents ?? cur.amountCents;
        const paidOn = slip.paidOn ?? todayBr();
        const [saved] = await tx
          .update(boletoCharges)
          .set({
            status: 'paid',
            paidCents,
            paidAt: new Date(`${paidOn}T12:00:00-03:00`),
            updatedAt: new Date(),
          })
          .where(eq(boletoCharges.id, id))
          .returning();
        let settled = false;
        if (cur.financialEntryId) {
          const [entry] = await tx
            .select()
            .from(financialEntries)
            .where(eq(financialEntries.id, cur.financialEntryId))
            .for('update');
          if (entry?.status === 'open') {
            await tx
              .update(financialEntries)
              .set({
                status: 'paid',
                paidAt: paidOn,
                paidCents,
                paymentMethod: 'boleto',
                updatedAt: new Date(),
              })
              .where(eq(financialEntries.id, entry.id));
            settled = true;
          }
        }
        await this.audit.record(tx, actor, {
          action: 'boleto.paid',
          entity: 'boleto',
          entityId: id,
          data: {
            paidCents,
            amountCents: cur.amountCents,
            entrySettled: settled,
            // Conciliação: valor pago diferente do cobrado ou conta que já não estava aberta.
            divergence:
              paidCents !== cur.amountCents
                ? 'valor pago diferente do cobrado'
                : cur.financialEntryId && !settled
                  ? 'a conta a receber já não estava em aberto'
                  : null,
          },
        });
        return this.view(saved!);
      }
      const next: BoletoStatus =
        slip.status === 'canceled'
          ? 'canceled'
          : slip.status === 'overdue'
            ? 'overdue'
            : 'registered';
      if (next === cur.status) return this.view(cur);
      const [saved] = await tx
        .update(boletoCharges)
        .set({ status: next, updatedAt: new Date() })
        .where(eq(boletoCharges.id, id))
        .returning();
      return this.view(saved!);
    });
  }

  /** Conciliação do cliente: consulta todos os boletos em aberto e lista as divergências. */
  async reconcile(ctx: RequestContext) {
    const open = await withTenant(this.db, ctx, (tx) =>
      tx
        .select({ id: boletoCharges.id })
        .from(boletoCharges)
        .where(inArray(boletoCharges.status, OPEN))
        .orderBy(asc(boletoCharges.dueDate))
        .limit(200),
    );
    let paid = 0;
    for (const o of open) {
      const v = await this.refresh(ctx.tenantId, o.id);
      if (v?.status === 'paid') paid += 1;
    }
    const divergences = await withTenant(this.db, ctx, async (tx) => {
      const rows = await tx.select().from(boletoCharges).where(eq(boletoCharges.status, 'paid'));
      const out: { id: string; reason: string }[] = [];
      for (const r of rows) {
        if (r.paidCents !== null && r.paidCents !== r.amountCents) {
          out.push({ id: r.id, reason: 'O valor pago é diferente do valor do boleto.' });
        }
        if (r.financialEntryId) {
          const [e] = await tx
            .select({ status: financialEntries.status, paidCents: financialEntries.paidCents })
            .from(financialEntries)
            .where(eq(financialEntries.id, r.financialEntryId));
          if (e?.status !== 'paid') {
            out.push({
              id: r.id,
              reason: 'O boleto foi pago, mas a conta a receber não está baixada.',
            });
          } else if (e.paidCents !== r.paidCents) {
            out.push({ id: r.id, reason: 'A conta foi baixada por um valor diferente do boleto.' });
          }
        }
      }
      return out;
    });
    return { checked: open.length, paid, divergences };
  }

  /** Só fora de produção: o pagador "paga" o boleto no banco de mentira e o Bipaê consulta. */
  async simulatePay(ctx: RequestContext, id: string) {
    if (this.production) throw notFound('Boleto');
    const row = await withTenant(this.db, ctx, async (tx) => {
      const [r] = await tx.select().from(boletoCharges).where(eq(boletoCharges.id, id));
      return r;
    });
    if (!row) throw notFound('Boleto');
    if (row.provider !== 'simulator' || !row.externalId) {
      throw new AppError(422, 'not_simulated', 'Só boleto do simulador aceita pagamento de teste.');
    }
    this.hub.pay(row.externalId, row.amountCents, todayBr());
    return this.refresh(ctx.tenantId, id);
  }

  // ------------------------------------------------------------------ aviso do Asaas

  /**
   * Aviso do Asaas (cabeçalho asaas-access-token = token do aviso da loja). Nada do que vem no
   * aviso baixa o boleto: ele só aponta qual consultar. asPlatform() só acha o boleto pelo id do
   * parceiro, como nos avisos do Pix.
   */
  async asaasNotice(body: unknown, token: string | undefined): Promise<number> {
    const b = (body ?? {}) as { event?: unknown; payment?: { id?: unknown } };
    if (typeof b.event !== 'string' || !b.event.startsWith('PAYMENT_')) return 0;
    const externalId = b.payment?.id;
    if (typeof externalId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(externalId) || !token)
      return 0;
    const found = await asPlatform(this.db, async (tx) => {
      const [r] = await tx
        .select({ id: boletoCharges.id, tenantId: boletoCharges.tenantId })
        .from(boletoCharges)
        .where(and(eq(boletoCharges.provider, 'asaas'), eq(boletoCharges.externalId, externalId)));
      return r ?? null;
    });
    if (!found) return 0;
    const sealed = await withTenant(this.db, { tenantId: found.tenantId }, async (tx) => {
      const rows = await tx
        .select({ t: paymentSettings.webhookTokenSealed })
        .from(paymentSettings)
        .where(isNotNull(paymentSettings.webhookTokenSealed));
      return rows.map((r) => r.t!).filter(Boolean);
    });
    if (!sealed.some((s) => sameText(this.box.open(s), token))) return 0;
    await this.refresh(found.tenantId, found.id);
    return 1;
  }
}

@Controller('boletos')
export class BoletoController {
  constructor(@Inject(BoletoService) private readonly boletos: BoletoService) {}

  @Get('capability')
  @RequirePermission('finance.read')
  capability(@Ctx() ctx: RequestContext) {
    return this.boletos.capability(ctx);
  }

  @Get()
  @RequirePermission('finance.read')
  list(@Ctx() ctx: RequestContext, @Query('status') status?: string) {
    return this.boletos.list(ctx, status);
  }

  @Post()
  @RequirePermission('finance.write')
  create(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.boletos.create(ctx, body);
  }

  @Post('reconcile')
  @RequirePermission('finance.write')
  reconcile(@Ctx() ctx: RequestContext) {
    return this.boletos.reconcile(ctx);
  }

  @Get(':id')
  @RequirePermission('finance.read')
  get(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.boletos.get(ctx, id);
  }

  @Post(':id/refresh')
  @RequirePermission('finance.write')
  async refresh(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    const v = await this.boletos.refresh(ctx.tenantId, id);
    if (!v) throw notFound('Boleto');
    return v;
  }

  @Post(':id/retry')
  @RequirePermission('finance.write')
  retry(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.boletos.retry(ctx, id);
  }

  @Post(':id/cancel')
  @RequirePermission('finance.write')
  cancel(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.boletos.cancel(ctx, id);
  }

  /** Só em teste: o pagador "paga" o boleto no banco de mentira. */
  @Post(':id/simulate-payment')
  @RequirePermission('finance.write')
  simulatePayment(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.boletos.simulatePay(ctx, id);
  }
}

/** Aviso do Asaas para boletos: sem login, resposta sempre igual (não conta se o boleto existe). */
@Controller('boletos/webhooks')
export class BoletoWebhookController {
  private readonly logger = new Logger('Boletos');

  constructor(@Inject(BoletoService) private readonly boletos: BoletoService) {}

  @Public()
  @Post('asaas')
  @HttpCode(200)
  @RouteConfig(RATE_LIMIT)
  async asaas(
    @Req() request: RawBodyRequest<FastifyRequest>,
    @Headers('asaas-access-token') token: string | undefined,
  ) {
    const raw = request.rawBody;
    if (!raw || raw.length > MAX_BODY) return RECEIVED;
    try {
      await this.boletos.asaasNotice(request.body, token);
    } catch (error) {
      this.logger.warn(`Aviso de boleto descartado: ${(error as Error).message}`);
    }
    return RECEIVED;
  }
}
