import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { uuidv7 } from '@bipae/domain';
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import type { Config } from '../../config';
import { CONFIG, DB, QUEUE } from '../../common/di';
import type { JobQueue } from '../../common/queue';
import { asPlatform, type Db, type Tx } from '../../db/client';
import { mercadoflowOutbox } from '../../db/schema';
import { MERCADOFLOW_CLIENT, MercadoflowError, type MercadoflowClient } from './mercadoflow.client';

export type OutboxRow = typeof mercadoflowOutbox.$inferSelect;

/** O que aconteceu com cada item de um lote enviado. */
export type OutboxResult =
  { id: string; outcome: 'sent' } | { id: string; outcome: 'rejected'; error: string };

/** Envia um lote do mesmo tipo e diz o resultado de cada item. Erro lançado = tenta de novo depois. */
export type OutboxSender = (
  rows: OutboxRow[],
  client: MercadoflowClient,
) => Promise<OutboxResult[]>;

const FLUSH_JOB = 'mercadoflow.outbox';
const FLUSH_EVERY_MS = 60_000;
const MAX_BACKOFF_MS = 6 * 3_600_000;

/**
 * Fila de envio ao MercadoFlow (seção 1 do contrato): tudo o que o Bipaê manda passa por esta
 * tabela, com tentativas e espera crescente. Com o MercadoFlow fora do ar, nada se perde e o
 * Bipaê segue funcionando. Como a fila é de todos os clientes, o envio roda no papel da
 * plataforma (ADR-0015).
 */
@Injectable()
export class MercadoflowOutbox implements OnModuleInit {
  private readonly logger = new Logger('MercadoFlow');
  private readonly senders = new Map<string, { batch: number; send: OutboxSender }>();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(QUEUE) private readonly queue: JobQueue,
    @Inject(MERCADOFLOW_CLIENT) private readonly client: MercadoflowClient,
  ) {}

  onModuleInit() {
    if (!this.client.enabled) return;
    try {
      this.queue.process(FLUSH_JOB, async () => {
        await this.flush();
      });
    } catch (error) {
      this.logger.error(`Fila do MercadoFlow não iniciou: ${(error as Error).message}`);
      return;
    }
    if (this.config.NODE_ENV !== 'test') {
      void this.queue
        .add(FLUSH_JOB, {}, { repeatEveryMs: FLUSH_EVERY_MS })
        .catch((error: Error) =>
          this.logger.warn(`Não foi possível agendar o envio: ${error.message}`),
        );
    }
  }

  /** Cada módulo registra como envia o seu tipo de item e o tamanho do lote. */
  register(kind: string, batch: number, send: OutboxSender) {
    this.senders.set(kind, { batch, send });
  }

  /**
   * Põe na fila, na mesma transação de quem chama. Repetir a mesma chave atualiza o conteúdo e
   * volta o item para a fila (produto alterado de novo), sem duplicar.
   */
  async enqueue(
    tx: Tx,
    item: {
      tenantId: string;
      storeId?: string | null;
      kind: string;
      dedupeKey: string;
      payload: unknown;
    },
  ) {
    if (!this.client.enabled) return;
    await tx
      .insert(mercadoflowOutbox)
      .values({
        id: uuidv7(),
        tenantId: item.tenantId,
        storeId: item.storeId ?? null,
        kind: item.kind,
        dedupeKey: item.dedupeKey,
        payload: item.payload,
      })
      .onConflictDoUpdate({
        target: [mercadoflowOutbox.tenantId, mercadoflowOutbox.kind, mercadoflowOutbox.dedupeKey],
        set: {
          payload: item.payload,
          status: 'pending',
          attempts: 0,
          nextAttemptAt: new Date(),
          lastError: null,
        },
      });
  }

  /** Envia o que está pendente e vencido. Devolve quantos itens foram enviados ou recusados. */
  async flush(
    now: Date = new Date(),
  ): Promise<{ sent: number; rejected: number; retried: number }> {
    const totals = { sent: 0, rejected: 0, retried: 0 };
    if (!this.client.enabled) return totals;
    for (const [kind, { batch, send }] of this.senders) {
      const rows = await asPlatform(this.db, (tx) =>
        tx
          .select()
          .from(mercadoflowOutbox)
          .where(
            and(
              eq(mercadoflowOutbox.kind, kind),
              eq(mercadoflowOutbox.status, 'pending'),
              lte(mercadoflowOutbox.nextAttemptAt, now),
            ),
          )
          .orderBy(asc(mercadoflowOutbox.createdAt), asc(mercadoflowOutbox.id))
          .limit(batch),
      );
      if (rows.length === 0) continue;
      let results: OutboxResult[];
      try {
        results = await send(rows, this.client);
      } catch (error) {
        // Recusa do lote inteiro por dado inválido não melhora repetindo.
        if (error instanceof MercadoflowError && [400, 403, 404, 409].includes(error.status)) {
          results = rows.map((row) => ({ id: row.id, outcome: 'rejected', error: error.message }));
        } else {
          await this.retryLater(rows, (error as Error).message, now);
          totals.retried += rows.length;
          continue;
        }
      }
      const sent = results.filter((r) => r.outcome === 'sent').map((r) => r.id);
      const rejected = results.filter(
        (r): r is Extract<OutboxResult, { outcome: 'rejected' }> => r.outcome === 'rejected',
      );
      await asPlatform(this.db, async (tx) => {
        if (sent.length) {
          await tx
            .update(mercadoflowOutbox)
            .set({ status: 'sent', sentAt: now, lastError: null })
            .where(inArray(mercadoflowOutbox.id, sent));
        }
        for (const item of rejected) {
          await tx
            .update(mercadoflowOutbox)
            .set({ status: 'rejected', lastError: item.error.slice(0, 500) })
            .where(eq(mercadoflowOutbox.id, item.id));
        }
      });
      totals.sent += sent.length;
      totals.rejected += rejected.length;
    }
    return totals;
  }

  /** Espera crescente: 1 min, 2, 4... até 6 horas. */
  private async retryLater(rows: OutboxRow[], error: string, now: Date) {
    await asPlatform(this.db, async (tx) => {
      for (const row of rows) {
        const wait = Math.min(60_000 * 2 ** row.attempts, MAX_BACKOFF_MS);
        await tx
          .update(mercadoflowOutbox)
          .set({
            attempts: sql`${mercadoflowOutbox.attempts} + 1`,
            nextAttemptAt: new Date(now.getTime() + wait),
            lastError: error.slice(0, 500),
          })
          .where(eq(mercadoflowOutbox.id, row.id));
      }
    });
  }
}
