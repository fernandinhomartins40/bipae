import {
  Body,
  Controller,
  Get,
  Inject,
  Injectable,
  Param,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import {
  loyaltyBalance,
  loyaltyExpiry,
  loyaltyProgramInput,
  pointsEarned,
  uuidv7,
  type LoyaltyEntry,
  type LoyaltyProgram,
  type LoyaltyStatement,
} from '@bipae/domain';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { DB } from '../../common/di';
import { notFound, parse } from '../../common/errors';
import { withTenant, type Db, type Tx } from '../../db/client';
import { customers, loyaltyEntries, loyaltyPrograms } from '../../db/schema';
import { AuditService } from '../audit/audit.service';

/** Validade usada para devolver pontos quando o programa foi apagado ou nunca existiu. */
const DEFAULT_EXPIRY_MONTHS = 6;

const toEntry = (row: typeof loyaltyEntries.$inferSelect): LoyaltyEntry => ({
  kind: row.kind,
  points: row.points,
  at: row.createdAt,
  expiresAt: row.expiresAt,
});

/**
 * Fidelidade (F6-08.b). Os pontos nascem quando o servidor aplica a venda do caixa (mesma
 * transação), e o resgate vem no próprio evento da venda. A venda nunca é recusada por causa dos
 * pontos: se um caixa sem internet usou mais do que havia, o resgate fica gravado e a diferença
 * vai para a auditoria.
 */
@Injectable()
export class LoyaltyService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async program(tx: Tx): Promise<LoyaltyProgram | null> {
    const [row] = await tx.select().from(loyaltyPrograms);
    if (!row) return null;
    return {
      active: row.active,
      centsPerPoint: row.centsPerPoint,
      pointValueCents: row.pointValueCents,
      expiryMonths: row.expiryMonths,
      minRedeemPoints: row.minRedeemPoints,
    };
  }

  getProgram(ctx: RequestContext) {
    return withTenant(this.db, ctx, async (tx) => ({ program: await this.program(tx) }));
  }

  saveProgram(ctx: RequestContext, input: z.output<typeof loyaltyProgramInput>) {
    return withTenant(this.db, ctx, async (tx) => {
      const before = await this.program(tx);
      const now = new Date();
      await tx
        .insert(loyaltyPrograms)
        .values({ tenantId: ctx.tenantId, ...input, updatedBy: ctx.userId, updatedAt: now })
        .onConflictDoUpdate({
          target: loyaltyPrograms.tenantId,
          set: { ...input, updatedBy: ctx.userId, updatedAt: now },
        });
      await this.audit.record(tx, ctx, {
        action: 'loyalty.program_saved',
        entity: 'loyalty_program',
        data: { before, after: input },
      });
      return (await this.program(tx))!;
    });
  }

  private async balanceOf(tx: Tx, taxId: string, now: Date): Promise<number> {
    const rows = await tx
      .select()
      .from(loyaltyEntries)
      .where(eq(loyaltyEntries.customerTaxId, taxId));
    return loyaltyBalance(rows.map(toEntry), now);
  }

  /** Venda aplicada: ganha pontos pelo valor (sem a taxa de entrega) e registra o resgate. */
  async onSaleCompleted(
    tx: Tx,
    actor: Pick<RequestContext, 'tenantId' | 'userId'>,
    sale: {
      saleId: string;
      customerTaxId: string | null | undefined;
      totalCents: number;
      at: Date;
      loyalty?: { points: number; discountCents: number } | undefined;
    },
  ) {
    if (!sale.customerTaxId) return;
    const program = await this.program(tx);
    if (sale.loyalty) {
      const balance = await this.balanceOf(tx, sale.customerTaxId, sale.at);
      await tx.insert(loyaltyEntries).values({
        id: uuidv7(),
        tenantId: actor.tenantId,
        customerTaxId: sale.customerTaxId,
        kind: 'redeem',
        points: -sale.loyalty.points,
        saleId: sale.saleId,
        createdAt: sale.at,
      });
      if (sale.loyalty.points > balance) {
        await this.audit.record(tx, actor, {
          action: 'loyalty.overdrawn',
          entity: 'sale',
          entityId: sale.saleId,
          data: { usedPoints: sale.loyalty.points, balance },
        });
      }
    }
    const points = program ? pointsEarned(sale.totalCents, program) : 0;
    if (points > 0) {
      await tx.insert(loyaltyEntries).values({
        id: uuidv7(),
        tenantId: actor.tenantId,
        customerTaxId: sale.customerTaxId,
        kind: 'earn',
        points,
        saleId: sale.saleId,
        expiresAt: loyaltyExpiry(sale.at, program!.expiryMonths),
        createdAt: sale.at,
      });
    }
  }

  /** Venda cancelada: tira os pontos ganhos e devolve os usados. */
  async onSaleCancelled(tx: Tx, tenantId: string, saleId: string, at: Date) {
    const rows = await tx.select().from(loyaltyEntries).where(eq(loyaltyEntries.saleId, saleId));
    const program = await this.program(tx);
    const months = program?.expiryMonths ?? DEFAULT_EXPIRY_MONTHS;
    for (const r of rows) {
      if (r.kind !== 'earn' && r.kind !== 'redeem') continue;
      await tx.insert(loyaltyEntries).values({
        id: uuidv7(),
        tenantId,
        customerTaxId: r.customerTaxId,
        kind: r.kind === 'earn' ? 'reverse_earn' : 'reverse_redeem',
        points: -r.points,
        saleId,
        expiresAt: r.kind === 'redeem' ? loyaltyExpiry(at, months) : null,
        createdAt: at,
      });
    }
  }

  /** Devolução: tira os pontos do valor devolvido (nunca mais do que a venda deu). */
  async onSaleReturned(
    tx: Tx,
    tenantId: string,
    originalSaleId: string,
    refundCents: number,
    at: Date,
  ) {
    const rows = await tx
      .select()
      .from(loyaltyEntries)
      .where(eq(loyaltyEntries.saleId, originalSaleId));
    const earned = rows.filter((r) => r.kind === 'earn').reduce((s, r) => s + r.points, 0);
    const reversed = -rows
      .filter((r) => r.kind === 'reverse_earn')
      .reduce((s, r) => s + r.points, 0);
    const program = await this.program(tx);
    if (earned === 0 || !program) return;
    const points = Math.min(earned - reversed, Math.floor(refundCents / program.centsPerPoint));
    if (points <= 0) return;
    await tx.insert(loyaltyEntries).values({
      id: uuidv7(),
      tenantId,
      customerTaxId: rows[0]!.customerTaxId,
      kind: 'reverse_earn',
      points: -points,
      saleId: originalSaleId,
      createdAt: at,
    });
  }

  /** Para o retrato do caixa: o programa e quem tem saldo. */
  async snapshot(tx: Tx, now: Date) {
    const program = await this.program(tx);
    if (!program?.active) return { program, balances: [] };
    const rows = await tx
      .select()
      .from(loyaltyEntries)
      .orderBy(asc(loyaltyEntries.customerTaxId), asc(loyaltyEntries.createdAt));
    const byCustomer = new Map<string, LoyaltyEntry[]>();
    for (const r of rows) {
      const list = byCustomer.get(r.customerTaxId) ?? [];
      list.push(toEntry(r));
      byCustomer.set(r.customerTaxId, list);
    }
    const balances = [...byCustomer]
      .map(([taxId, entries]) => ({ taxId, points: loyaltyBalance(entries, now) }))
      .filter((b) => b.points > 0);
    return { program, balances };
  }

  /** O que muda o retrato: o programa e o extrato. */
  async version(tx: Tx): Promise<string> {
    const [row] = await tx
      .select({
        program: sql<string>`(select coalesce(max(${loyaltyPrograms.updatedAt})::text, '') from ${loyaltyPrograms})`,
        entries: sql<string>`(select count(*) || ':' || coalesce(max(${loyaltyEntries.createdAt})::text, '') from ${loyaltyEntries})`,
      })
      .from(sql`(select 1) as one`);
    return `${row?.program ?? ''}|${row?.entries ?? ''}`;
  }

  statement(ctx: RequestContext, customerId: string, now = new Date()): Promise<LoyaltyStatement> {
    return withTenant(this.db, ctx, async (tx) => {
      const [customer] = await tx
        .select({ taxId: customers.taxId })
        .from(customers)
        .where(eq(customers.id, customerId));
      if (!customer) throw notFound('Cliente');
      if (!customer.taxId) return { hasTaxId: false, points: 0, valueCents: 0, entries: [] };
      const rows = await tx
        .select()
        .from(loyaltyEntries)
        .where(and(eq(loyaltyEntries.customerTaxId, customer.taxId)))
        .orderBy(asc(loyaltyEntries.createdAt));
      const points = loyaltyBalance(rows.map(toEntry), now);
      const program = await this.program(tx);
      return {
        hasTaxId: true,
        points,
        valueCents: program ? points * program.pointValueCents : 0,
        entries: rows
          .slice(-50)
          .reverse()
          .map((r) => ({
            kind: r.kind,
            points: r.points,
            saleId: r.saleId,
            createdAt: r.createdAt.toISOString(),
            expiresAt: r.expiresAt?.toISOString() ?? null,
          })),
      };
    });
  }
}

@Controller('loyalty')
export class LoyaltyController {
  constructor(@Inject(LoyaltyService) private readonly loyalty: LoyaltyService) {}

  @Get('program')
  @RequirePermission('parties.read')
  program(@Ctx() ctx: RequestContext) {
    return this.loyalty.getProgram(ctx);
  }

  @Put('program')
  @RequirePermission('catalog.price.write')
  save(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.loyalty.saveProgram(ctx, parse(loyaltyProgramInput, body));
  }

  @Get('customers/:id')
  @RequirePermission('parties.read')
  statement(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.loyalty.statement(ctx, id);
  }
}
