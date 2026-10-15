import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { Config } from '../../config';
import { CONFIG, DB, QUEUE } from '../../common/di';
import type { JobQueue } from '../../common/queue';
import { asPlatform, type Db, type Tx } from '../../db/client';
import { rowsOf } from '../../db/migrate';
import { adminSessions, fiscalDocuments, sales, sessions, tenants } from '../../db/schema';
import { tenantTables } from '../account/data-export.service';
import { PlatformAuditService } from '../admin/platform-audit.service';
import { NfceEmissionService } from '../fiscal/nfce-emission.service';

export const SESSIONS_CLEANUP = 'manutencao.limpar-sessoes';
export const ACCOUNT_PURGE = 'manutencao.excluir-contas-canceladas';
export const NFCE_SWEEP = 'manutencao.reenviar-nfce';
const CINCO_MINUTOS = 5 * 60_000;
const UM_DIA = 24 * 60 * 60_000;
const SEIS_HORAS = 6 * 60 * 60_000;
const DIAS_GUARDADOS = 30;

/**
 * Rotinas de manutenção em segundo plano (F1-07). A primeira: apagar registros de login
 * vencidos ou encerrados há mais de 30 dias, que só ocupam espaço. Roda pela fila, com nova
 * tentativa automática se o banco estiver indisponível.
 */
@Injectable()
export class MaintenanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Manutencao');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(QUEUE) private readonly queue: JobQueue,
    @Inject(PlatformAuditService) private readonly platformAudit: PlatformAuditService,
    @Inject(NfceEmissionService) private readonly nfce: NfceEmissionService,
  ) {}

  async onModuleInit() {
    // A manutenção é um extra: se a fila falhar ao iniciar, a API sobe do mesmo jeito.
    try {
      this.queue.process(SESSIONS_CLEANUP, async () => {
        const removed = await this.cleanupSessions();
        if (removed > 0) this.logger.log(`${removed} registros de login antigos apagados`);
      });
      this.queue.process(NFCE_SWEEP, async () => {
        const again = await this.sweepNfce();
        if (again > 0) this.logger.log(`${again} NFC-e de volta à fila`);
      });
      this.queue.process(ACCOUNT_PURGE, async () => {
        const purged = await this.purgeCancelledAccounts();
        if (purged.length > 0)
          this.logger.log(`${purged.length} conta(s) cancelada(s) excluída(s)`);
      });
    } catch (error) {
      this.logger.error(`Fila de manutenção não iniciou: ${(error as Error).message}`);
      return;
    }
    // Nos testes a rotina é chamada direto, sem agendamento. O agendamento não segura a subida
    // da API: se o Redis demorar, a API sobe e a tarefa é agendada quando ele responder.
    if (this.config.NODE_ENV !== 'test') {
      void this.queue
        .add(SESSIONS_CLEANUP, {}, { repeatEveryMs: SEIS_HORAS })
        .catch((error: Error) =>
          this.logger.warn(`Não foi possível agendar a limpeza: ${error.message}`),
        );
      void this.queue
        .add(NFCE_SWEEP, {}, { repeatEveryMs: CINCO_MINUTOS })
        .catch((error: Error) =>
          this.logger.warn(`Não foi possível agendar a fila da NFC-e: ${error.message}`),
        );
      void this.queue
        .add(ACCOUNT_PURGE, {}, { repeatEveryMs: UM_DIA })
        .catch((error: Error) =>
          this.logger.warn(`Não foi possível agendar a exclusão de contas: ${error.message}`),
        );
    }
  }

  async onModuleDestroy() {
    await this.queue.close().catch(() => undefined);
  }

  /**
   * NFC-e paradas na fila (F3-14.b): pendentes ou com falha temporária há mais de um minuto, das
   * últimas 24 horas, voltam para a fila (a fila em memória perde tarefas numa reinicialização, e
   * a SEFAZ pode ficar fora mais tempo do que as tentativas automáticas). "Falta configurar" e
   * recusadas não voltam sozinhas: dependem de alguém corrigir.
   */
  async sweepNfce(now: Date = new Date()): Promise<number> {
    const stuck = await asPlatform(this.db, (tx) =>
      tx
        .select({
          id: fiscalDocuments.id,
          tenantId: fiscalDocuments.tenantId,
          operatorId: sales.operatorId,
        })
        .from(fiscalDocuments)
        .innerJoin(sales, eq(sales.id, fiscalDocuments.saleId))
        .where(
          and(
            sql`${fiscalDocuments.status} in ('pending', 'error')`,
            lt(fiscalDocuments.updatedAt, new Date(now.getTime() - 60_000)),
            sql`${fiscalDocuments.createdAt} > ${new Date(now.getTime() - UM_DIA)}`,
            lt(fiscalDocuments.attempts, 10),
          ),
        )
        .limit(200),
    );
    for (const doc of stuck) await this.nfce.schedule(doc.tenantId, doc.operatorId, doc.id);
    return stuck.length;
  }

  /** Apaga logins vencidos ou encerrados há mais de 30 dias, de todas as empresas. */
  async cleanupSessions(now: Date = new Date()): Promise<number> {
    const limit = new Date(now.getTime() - DIAS_GUARDADOS * 86_400_000);
    return asPlatform(this.db, async (tx) => {
      const clients = await tx
        .delete(sessions)
        .where(
          or(
            lt(sessions.expiresAt, limit),
            and(sql`${sessions.revokedAt} is not null`, lt(sessions.revokedAt, limit)),
          ),
        )
        .returning({ id: sessions.id });
      const staff = await tx
        .delete(adminSessions)
        .where(
          or(
            lt(adminSessions.expiresAt, limit),
            and(sql`${adminSessions.revokedAt} is not null`, lt(adminSessions.revokedAt, limit)),
          ),
        )
        .returning({ id: adminSessions.id });
      return clients.length + staff.length;
    });
  }

  /**
   * LGPD (P-03): apaga de vez os dados das contas canceladas há mais de ACCOUNT_PURGE_DAYS. A
   * linha do cliente fica, anonimizada, para a auditoria da plataforma. Uma transação por conta:
   * se algo falhar, a conta fica para a próxima rodada, sem dado pela metade.
   */
  async purgeCancelledAccounts(now: Date = new Date()): Promise<string[]> {
    const limit = new Date(now.getTime() - this.config.ACCOUNT_PURGE_DAYS * UM_DIA);
    const due = await asPlatform(this.db, (tx) =>
      tx
        .select({ id: tenants.id })
        .from(tenants)
        .where(
          and(
            eq(tenants.status, 'cancelled'),
            isNull(tenants.purgedAt),
            lt(tenants.statusChangedAt, limit),
          ),
        ),
    );
    const done: string[] = [];
    for (const { id } of due) {
      await asPlatform(this.db, (tx) => this.purgeTenant(tx, id, now));
      done.push(id);
    }
    return done;
  }

  private async purgeTenant(tx: Tx, tenantId: string, now: Date) {
    // Libera a exclusão da trilha de auditoria só deste cliente, nesta transação.
    await tx.execute(sql`select set_config('bipae.purge_tenant', ${tenantId}, true)`);
    const tables = await tenantTables((q) => tx.execute(q));
    // Quem referencia sai antes de quem é referenciado (chaves estrangeiras do banco).
    const edges = rowsOf<{ child: string; parent: string }>(
      await tx.execute(sql`
        select c.relname as child, p.relname as parent
        from pg_constraint k
        join pg_class c on c.oid = k.conrelid
        join pg_class p on p.oid = k.confrelid
        where k.contype = 'f' and c.relname <> p.relname`),
    ).filter((e) => tables.includes(e.child) && tables.includes(e.parent));
    const remaining = new Set(tables);
    const order: string[] = [];
    while (remaining.size > 0) {
      const free = [...remaining].filter(
        (t) => !edges.some((e) => e.parent === t && remaining.has(e.child)),
      );
      if (free.length === 0)
        throw new Error('Ciclo de chaves estrangeiras entre tabelas do cliente.');
      for (const t of free) {
        order.push(t);
        remaining.delete(t);
      }
    }
    const members = rowsOf<{ user_id: string }>(
      await tx.execute(sql`select user_id from memberships where tenant_id = ${tenantId}`),
    ).map((r) => r.user_id);
    const counts: Record<string, number> = {};
    for (const table of order) {
      const result = await tx.execute(
        sql`delete from ${sql.identifier(table)} where tenant_id = ${tenantId}`,
      );
      counts[table] = Number(
        (result as { rowCount?: number; affectedRows?: number }).rowCount ??
          (result as { affectedRows?: number }).affectedRows ??
          0,
      );
    }
    // Pessoas que não têm mais nenhuma empresa no Bipaê saem também.
    let users = 0;
    for (const userId of members) {
      const removed = rowsOf<{ id: string }>(
        await tx.execute(sql`
          delete from users where id = ${userId}
            and not exists (select 1 from memberships where user_id = ${userId})
          returning id`),
      );
      users += removed.length;
    }
    await tx
      .update(tenants)
      .set({ name: 'Cliente excluído', notes: null, statusReason: null, purgedAt: now })
      .where(eq(tenants.id, tenantId));
    await this.platformAudit.record(
      tx,
      { userId: null },
      { action: 'tenant.purged', tenantId, target: 'tenant', data: { tables: counts, users } },
    );
  }
}
