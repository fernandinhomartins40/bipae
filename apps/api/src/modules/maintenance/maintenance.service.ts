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
import {
  adminSessions,
  memberships,
  roles,
  users,
  fiscalDocuments,
  nfeInvoices,
  nfseDocuments,
  sales,
  sessions,
  tenants,
  webhookDeliveries,
} from '../../db/schema';
import { tenantTables } from '../account/data-export.service';
import { PlatformAuditService } from '../admin/platform-audit.service';
import { DfeService } from '../fiscal/dfe.service';
import { NfseReceivedService } from '../fiscal/nfse-received.service';
import { NfseService } from '../fiscal/nfse.service';
import { FiscalEventsService } from '../fiscal/fiscal-events.service';
import { NfceEmissionService } from '../fiscal/nfce-emission.service';
import { NfeInvoicesService } from '../fiscal/nfe-invoices.service';
import { mailBody, MailService } from '../mail/mail.service';
import { WebhooksService } from '../public-api/webhooks.service';

export const SESSIONS_CLEANUP = 'manutencao.limpar-sessoes';
export const ACCOUNT_PURGE = 'manutencao.excluir-contas-canceladas';
export const NFCE_SWEEP = 'manutencao.reenviar-nfce';
export const WEBHOOK_SWEEP = 'manutencao.reenviar-webhooks';
export const DFE_SWEEP = 'manutencao.buscar-notas-recebidas';
export const ACCOUNT_NOTICES = 'manutencao.avisos-da-conta';
const UM_MINUTO = 60_000;
const CINCO_MINUTOS = 5 * 60_000;
const UM_DIA = 24 * 60 * 60_000;
const UMA_HORA = 60 * 60_000;
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
    @Inject(NfeInvoicesService) private readonly nfe: NfeInvoicesService,
    @Inject(FiscalEventsService) private readonly fiscalEvents: FiscalEventsService,
    @Inject(WebhooksService) private readonly webhooks: WebhooksService,
    @Inject(DfeService) private readonly dfe: DfeService,
    @Inject(NfseReceivedService) private readonly nfseReceived: NfseReceivedService,
    @Inject(NfseService) private readonly nfse: NfseService,
    @Inject(MailService) private readonly mail: MailService,
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
      this.queue.process(WEBHOOK_SWEEP, async () => {
        await this.sweepWebhooks();
      });
      this.queue.process(DFE_SWEEP, async () => {
        await this.sweepDfe();
      });
      this.queue.process(ACCOUNT_NOTICES, async () => {
        await this.accountNotices();
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
        .add(WEBHOOK_SWEEP, {}, { repeatEveryMs: UM_MINUTO })
        .catch((error: Error) =>
          this.logger.warn(`Não foi possível agendar os webhooks: ${error.message}`),
        );
      void this.queue
        .add(ACCOUNT_NOTICES, {}, { repeatEveryMs: SEIS_HORAS })
        .catch((error: Error) =>
          this.logger.warn(`Não foi possível agendar os avisos da conta: ${error.message}`),
        );
      void this.queue
        .add(DFE_SWEEP, {}, { repeatEveryMs: UMA_HORA })
        .catch((error: Error) =>
          this.logger.warn(`Não foi possível agendar a busca de notas: ${error.message}`),
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
   * Avisos por e-mail da conta (P-04.d), para os donos: o teste termina em até 3 dias e a conta
   * foi suspensa. Cada aviso vai uma vez (a suspensão, uma vez por suspensão). Sem o e-mail
   * ligado, nada é marcado como enviado: o aviso sai quando o provedor for configurado.
   */
  async accountNotices(now: Date = new Date()): Promise<number> {
    if (!this.mail.enabled) return 0;
    const owners = (tenantId: string) =>
      asPlatform(this.db, (tx) =>
        tx
          .select({ name: users.name, email: users.email })
          .from(memberships)
          .innerJoin(roles, eq(roles.id, memberships.roleId))
          .innerJoin(users, eq(users.id, memberships.userId))
          .where(
            and(
              eq(memberships.tenantId, tenantId),
              eq(memberships.active, true),
              eq(roles.systemKey, 'owner'),
            ),
          ),
      );
    const date = (d: Date) =>
      new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(d);
    let sent = 0;
    const ending = await asPlatform(this.db, (tx) =>
      tx
        .select()
        .from(tenants)
        .where(
          and(
            eq(tenants.status, 'trial'),
            isNull(tenants.trialNoticeSentAt),
            sql`${tenants.trialEndsAt} > ${now}`,
            sql`${tenants.trialEndsAt} < ${new Date(now.getTime() + 3 * UM_DIA)}`,
          ),
        )
        .limit(500),
    );
    for (const t of ending) {
      for (const o of await owners(t.id)) {
        await this.mail.send({
          to: o.email,
          subject: 'Bipaê: o seu teste termina em breve',
          ...mailBody({
            greeting: `Olá, ${o.name.split(' ')[0]}!`,
            paragraphs: [
              `O teste grátis de ${t.name} no Bipaê termina em ${date(t.trialEndsAt!)}.`,
              'Para continuar vendendo sem interrupção, escolha um plano na retaguarda, em Assinatura.',
            ],
            action: { label: 'Ver os planos', url: this.mail.link('/assinatura') },
          }),
        });
        sent++;
      }
      await asPlatform(this.db, (tx) =>
        tx.update(tenants).set({ trialNoticeSentAt: now }).where(eq(tenants.id, t.id)),
      );
    }
    const suspended = await asPlatform(this.db, (tx) =>
      tx
        .select()
        .from(tenants)
        .where(
          and(
            eq(tenants.status, 'suspended'),
            sql`(${tenants.suspensionNoticeSentAt} is null or ${tenants.suspensionNoticeSentAt} < ${tenants.statusChangedAt})`,
          ),
        )
        .limit(500),
    );
    for (const t of suspended) {
      for (const o of await owners(t.id)) {
        await this.mail.send({
          to: o.email,
          subject: 'Bipaê: a sua conta foi suspensa',
          ...mailBody({
            greeting: `Olá, ${o.name.split(' ')[0]}!`,
            paragraphs: [
              `A conta de ${t.name} no Bipaê foi suspensa${t.statusReason ? `: ${t.statusReason}` : '.'}`,
              'Os seus dados continuam guardados. Fale com o suporte do Bipaê para reativar.',
            ],
          }),
        });
        sent++;
      }
      // Marca com a data da própria suspensão avisada, copiada no banco: o relógio da API pode
      // estar atrás, e a data lida no JavaScript perde os microssegundos do PostgreSQL. Nos dois
      // casos a marca ficaria antes da suspensão, e o aviso sairia de novo a cada rodada.
      await asPlatform(this.db, (tx) =>
        tx
          .update(tenants)
          .set({ suspensionNoticeSentAt: sql`coalesce(${tenants.statusChangedAt}, now())` })
          .where(eq(tenants.id, t.id)),
      );
    }
    return sent;
  }

  /**
   * Notas emitidas contra o CNPJ das empresas (F3-20): de hora em hora, cada empresa com
   * certificado pergunta ao Ambiente Nacional pelos documentos novos. Junto, as NFS-e em que a
   * empresa aparece, pelo ADN Contribuinte (F5-13.l).
   */
  async sweepDfe(): Promise<number> {
    const due = await asPlatform(this.db, (tx) => this.dfe.due(tx));
    for (const c of due) await this.dfe.schedule(c.tenantId, c.id);
    const services = await asPlatform(this.db, (tx) => this.nfseReceived.due(tx));
    for (const c of services) await this.nfseReceived.schedule(c.tenantId, c.id);
    return due.length + services.length;
  }

  /**
   * Avisos da API pública (F6-01.c) com tentativa vencida voltam para a fila: a espera entre
   * tentativas fica na própria linha, e a fila em memória perde tarefas numa reinicialização.
   */
  async sweepWebhooks(now: Date = new Date()): Promise<number> {
    const due = await asPlatform(this.db, (tx) =>
      tx
        .select({ id: webhookDeliveries.id, tenantId: webhookDeliveries.tenantId })
        .from(webhookDeliveries)
        .where(
          and(eq(webhookDeliveries.status, 'pending'), lt(webhookDeliveries.nextAttemptAt, now)),
        )
        .limit(500),
    );
    for (const d of due) await this.webhooks.schedule(d.tenantId, [d.id]);
    return due.length;
  }

  /**
   * NFC-e e NF-e paradas na fila (F3-14.b, F3-33.b): pendentes ou com falha temporária há mais de um minuto, das
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
            // Venda cancelada: quem cuida da nota é o cancelamento, logo abaixo.
            or(isNull(fiscalDocuments.cancelRequestedAt), eq(fiscalDocuments.origin, 'terminal')),
            lt(fiscalDocuments.updatedAt, new Date(now.getTime() - 60_000)),
            sql`${fiscalDocuments.createdAt} > ${new Date(now.getTime() - UM_DIA)}`,
            lt(fiscalDocuments.attempts, 10),
          ),
        )
        .limit(200),
    );
    for (const doc of stuck) await this.nfce.schedule(doc.tenantId, doc.operatorId, doc.id);
    // NF-e da retaguarda (F3-33.b) paradas do mesmo jeito, em nome de quem emitiu.
    const stuckNfe = await asPlatform(this.db, (tx) =>
      tx
        .select({
          id: fiscalDocuments.id,
          tenantId: fiscalDocuments.tenantId,
          userId: nfeInvoices.createdBy,
        })
        .from(fiscalDocuments)
        .innerJoin(nfeInvoices, eq(nfeInvoices.id, fiscalDocuments.invoiceId))
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
    for (const doc of stuckNfe) await this.nfe.schedule(doc.tenantId, doc.userId, doc.id);
    // NFS-e da ordem de serviço (F5-13.d) paradas do mesmo jeito.
    const stuckNfse = await asPlatform(this.db, (tx) =>
      tx
        .select({
          id: nfseDocuments.id,
          tenantId: nfseDocuments.tenantId,
          userId: nfseDocuments.createdBy,
        })
        .from(nfseDocuments)
        .where(
          and(
            sql`${nfseDocuments.status} in ('pending', 'error')`,
            lt(nfseDocuments.updatedAt, new Date(now.getTime() - 60_000)),
            sql`${nfseDocuments.createdAt} > ${new Date(now.getTime() - UM_DIA)}`,
            lt(nfseDocuments.attempts, 10),
          ),
        )
        .limit(200),
    );
    for (const doc of stuckNfse) await this.nfse.schedule(doc.tenantId, doc.userId, doc.id);
    // Contingência SVC (F3-16): com a nota autorizada na SVC, confere se a tentativa normal não
    // foi autorizada também, assim que a SEFAZ da UF responder.
    const replaced = await asPlatform(this.db, (tx) =>
      tx
        .select({
          id: fiscalDocuments.id,
          tenantId: fiscalDocuments.tenantId,
          userId: nfeInvoices.createdBy,
        })
        .from(fiscalDocuments)
        .innerJoin(nfeInvoices, eq(nfeInvoices.id, fiscalDocuments.invoiceId))
        .where(
          and(
            sql`${fiscalDocuments.replacedAccessKey} is not null`,
            isNull(fiscalDocuments.replacedCheckedAt),
            eq(fiscalDocuments.status, 'authorized'),
          ),
        )
        .limit(100),
    );
    for (const doc of replaced) {
      await this.nfe
        .checkReplaced(
          {
            tenantId: doc.tenantId,
            userId: doc.userId,
            permissions: [],
            terminalId: null,
            storeIds: null,
          },
          doc.id,
        )
        .catch((error: Error) => this.logger.warn(`Chave anterior da SVC: ${error.message}`));
    }
    // Cancelamentos parados (F3-17): venda cancelada cuja nota ainda não foi cancelada nem
    // deixada de emitir, sem resposta final da SEFAZ ao evento.
    const cancels = await asPlatform(this.db, (tx) =>
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
            sql`${fiscalDocuments.cancelRequestedAt} is not null`,
            sql`${fiscalDocuments.status} in ('authorized', 'pending', 'error')`,
            lt(fiscalDocuments.updatedAt, new Date(now.getTime() - 60_000)),
            sql`${fiscalDocuments.cancelRequestedAt} > ${new Date(now.getTime() - 2 * UM_DIA)}`,
            sql`not exists (select 1 from fiscal_events e where e.document_id = ${fiscalDocuments.id}
              and (e.status in ('registered', 'rejected') or e.attempts >= 10))`,
          ),
        )
        .limit(200),
    );
    for (const doc of cancels) {
      await this.fiscalEvents.schedule(doc.tenantId, doc.operatorId, doc.id);
    }
    return stuck.length + stuckNfe.length + stuckNfse.length + cancels.length;
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
