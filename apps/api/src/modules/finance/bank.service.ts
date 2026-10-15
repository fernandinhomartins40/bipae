import {
  Body,
  Controller,
  Get,
  Inject,
  Injectable,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  bankImportInput,
  OfxError,
  parseOfx,
  uuidv7,
  type BankImportResult,
  type BankTransactionView,
} from '@bipae/domain';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { DB } from '../../common/di';
import { AppError, notFound, parse } from '../../common/errors';
import { withTenant, type Db, type Tx } from '../../db/client';
import {
  bankAccounts,
  bankTransactions,
  customers,
  financialEntries,
  suppliers,
} from '../../db/schema';
import { AuditService } from '../audit/audit.service';

/** Até quantos dias de distância do vencimento um lançamento do banco vira sugestão. */
const WINDOW_DAYS = 10;
const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * Conciliação bancária por OFX (F4-07): importa o extrato (sem duplicar), sugere a conta a
 * pagar ou a receber de mesmo valor e vencimento próximo, e conciliar dá baixa nela com a data
 * e o valor do banco.
 */
@Injectable()
export class BankService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async import(ctx: RequestContext, content: string): Promise<BankImportResult> {
    let statement: ReturnType<typeof parseOfx>;
    try {
      statement = parseOfx(content);
    } catch (error) {
      if (error instanceof OfxError) throw new AppError(422, 'invalid_ofx', error.message);
      throw error;
    }
    return withTenant(this.db, ctx, async (tx) => {
      const [existing] = await tx
        .select()
        .from(bankAccounts)
        .where(
          and(
            eq(bankAccounts.accountNumber, statement.accountId),
            statement.bankId
              ? eq(bankAccounts.bankCode, statement.bankId)
              : sql`${bankAccounts.bankCode} is null`,
          ),
        );
      const name = `${statement.bankId ? `Banco ${statement.bankId} · ` : ''}Conta ${statement.accountId}`;
      const accountId = existing?.id ?? uuidv7();
      if (!existing) {
        await tx.insert(bankAccounts).values({
          id: accountId,
          tenantId: ctx.tenantId,
          bankCode: statement.bankId,
          accountNumber: statement.accountId,
          name,
        });
      }
      let imported = 0;
      for (const t of statement.transactions) {
        if (t.amountCents === 0) continue;
        const inserted = await tx
          .insert(bankTransactions)
          .values({
            id: uuidv7(),
            tenantId: ctx.tenantId,
            bankAccountId: accountId,
            fitId: t.fitId.slice(0, 120),
            postedOn: t.postedOn,
            amountCents: t.amountCents,
            memo: t.memo.slice(0, 300),
          })
          .onConflictDoNothing()
          .returning({ id: bankTransactions.id });
        imported += inserted.length;
      }
      return {
        account: existing?.name ?? name,
        imported,
        repeated: statement.transactions.filter((t) => t.amountCents !== 0).length - imported,
      };
    });
  }

  async list(ctx: RequestContext, status: string): Promise<BankTransactionView[]> {
    return withTenant(this.db, ctx, async (tx) => {
      const rows = await tx
        .select({ t: bankTransactions, account: bankAccounts.name })
        .from(bankTransactions)
        .innerJoin(bankAccounts, eq(bankAccounts.id, bankTransactions.bankAccountId))
        .where(
          status === 'pending' || status === 'matched' || status === 'ignored'
            ? eq(bankTransactions.status, status)
            : undefined,
        )
        .orderBy(asc(bankTransactions.postedOn))
        .limit(300);
      const pending = rows.filter((r) => r.t.status === 'pending');
      const open = pending.length
        ? await tx
            .select({ e: financialEntries, supplier: suppliers.name, customer: customers.name })
            .from(financialEntries)
            .leftJoin(suppliers, eq(suppliers.id, financialEntries.supplierId))
            .leftJoin(customers, eq(customers.id, financialEntries.customerId))
            .where(
              and(
                eq(financialEntries.status, 'open'),
                inArray(financialEntries.amountCents, [
                  ...new Set(pending.map((r) => Math.abs(r.t.amountCents))),
                ]),
              ),
            )
        : [];
      return rows.map(({ t, account }) => ({
        id: t.id,
        bankAccountName: account,
        postedOn: t.postedOn,
        amountCents: t.amountCents,
        memo: t.memo,
        status: t.status,
        entryId: t.entryId,
        suggestions:
          t.status !== 'pending'
            ? []
            : open
                .filter(
                  ({ e }) =>
                    e.amountCents === Math.abs(t.amountCents) &&
                    e.kind === (t.amountCents < 0 ? 'payable' : 'receivable') &&
                    e.dueDate >= addDays(t.postedOn, -WINDOW_DAYS) &&
                    e.dueDate <= addDays(t.postedOn, WINDOW_DAYS),
                )
                .map(({ e, supplier, customer }) => ({
                  id: e.id,
                  description: e.description,
                  dueDate: e.dueDate,
                  partyName: supplier ?? customer ?? null,
                })),
      }));
    });
  }

  private async pending(tx: Tx, id: string) {
    const [t] = await tx.select().from(bankTransactions).where(eq(bankTransactions.id, id));
    if (!t) throw notFound('Lançamento do extrato');
    if (t.status !== 'pending')
      throw new AppError(409, 'already_resolved', 'Este lançamento já foi conciliado ou ignorado.');
    return t;
  }

  /** Concilia com uma conta em aberto: dá baixa com a data e o valor do banco. */
  async match(ctx: RequestContext, id: string, entryId: string) {
    await withTenant(this.db, ctx, async (tx) => {
      const t = await this.pending(tx, id);
      const [entry] = await tx
        .select()
        .from(financialEntries)
        .where(eq(financialEntries.id, entryId));
      if (!entry) throw notFound('Conta');
      if (entry.status !== 'open')
        throw new AppError(409, 'entry_closed', 'Esta conta já foi paga ou cancelada.');
      if (entry.kind !== (t.amountCents < 0 ? 'payable' : 'receivable')) {
        throw new AppError(
          422,
          'wrong_direction',
          t.amountCents < 0
            ? 'Saída do banco só concilia com conta a pagar.'
            : 'Entrada no banco só concilia com conta a receber.',
        );
      }
      await tx
        .update(financialEntries)
        .set({
          status: 'paid',
          paidAt: t.postedOn,
          paidCents: Math.abs(t.amountCents),
          paymentMethod: 'banco',
          updatedAt: new Date(),
        })
        .where(eq(financialEntries.id, entryId));
      await tx
        .update(bankTransactions)
        .set({ status: 'matched', entryId, resolvedBy: ctx.userId, resolvedAt: new Date() })
        .where(eq(bankTransactions.id, id));
      await this.audit.record(tx, ctx, {
        action: 'finance.bank_matched',
        entity: 'financial_entry',
        entityId: entryId,
        data: { bankTransactionId: id, postedOn: t.postedOn, amountCents: t.amountCents },
      });
    });
    return { ok: true };
  }

  async ignore(ctx: RequestContext, id: string) {
    await withTenant(this.db, ctx, async (tx) => {
      await this.pending(tx, id);
      await tx
        .update(bankTransactions)
        .set({ status: 'ignored', resolvedBy: ctx.userId, resolvedAt: new Date() })
        .where(eq(bankTransactions.id, id));
    });
    return { ok: true };
  }
}

@Controller('finance/bank')
export class BankController {
  constructor(@Inject(BankService) private readonly bank: BankService) {}

  @Post('import')
  @RequirePermission('finance.write')
  import(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.bank.import(ctx, parse(bankImportInput, body).content);
  }

  @Get('transactions')
  @RequirePermission('finance.read')
  list(@Ctx() ctx: RequestContext, @Query('status') status?: string) {
    return this.bank.list(ctx, status ?? 'pending');
  }

  @Post('transactions/:id/match')
  @RequirePermission('finance.write')
  match(
    @Ctx() ctx: RequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.bank.match(ctx, id, parse(z.object({ entryId: z.string().uuid() }), body).entryId);
  }

  @Post('transactions/:id/ignore')
  @RequirePermission('finance.write')
  ignore(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.bank.ignore(ctx, id);
  }
}
