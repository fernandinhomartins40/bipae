import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { and, eq, inArray, isNotNull, lt, or, isNull } from 'drizzle-orm';
import type { Config } from '../../config';
import { CONFIG, DB, QUEUE } from '../../common/di';
import type { JobQueue } from '../../common/queue';
import { asPlatform, type Db } from '../../db/client';
import { boletoCharges, channelActions, channelIntegrations } from '../../db/schema-channels';
import { CATALOG_SYNC_EVERY_MS, ChannelsService } from '../channels/channels.service';
import { BoletoService } from '../payments/boleto.service';

export const CHANNELS_SWEEP = 'canais.varrer';
const TRINTA_SEGUNDOS = 30_000;

/**
 * Rotina dos pedidos de canais e dos boletos (F6-05, F6-06, F4-15): a cada 30 segundos consulta
 * os canais ativos, devolve à fila as ações vencidas e consulta no parceiro os boletos em aberto
 * (o aviso do banco pode se perder). asPlatform() só lista quem tem trabalho; cada tarefa roda
 * com o tenant dela. Rodar duas vezes não faz estrago: tudo é idempotente.
 */
@Injectable()
export class ChannelsSweep implements OnModuleInit {
  private readonly logger = new Logger('CanaisVarredura');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(QUEUE) private readonly queue: JobQueue,
    @Inject(ChannelsService) private readonly channels: ChannelsService,
    @Inject(BoletoService) private readonly boletos: BoletoService,
  ) {}

  onModuleInit() {
    try {
      this.queue.process(CHANNELS_SWEEP, async () => {
        await this.sweep();
      });
    } catch (error) {
      this.logger.error(`Fila dos canais não iniciou: ${(error as Error).message}`);
      return;
    }
    // Nos testes a rotina é chamada direto, sem agendamento.
    if (this.config.NODE_ENV !== 'test') {
      void this.queue
        .add(CHANNELS_SWEEP, {}, { repeatEveryMs: TRINTA_SEGUNDOS })
        .catch((error: Error) =>
          this.logger.warn(`Não foi possível agendar a varredura dos canais: ${error.message}`),
        );
    }
  }

  async sweep(now: Date = new Date()) {
    const work = await asPlatform(this.db, async (tx) => ({
      integrations: await tx
        .select({ id: channelIntegrations.id, tenantId: channelIntegrations.tenantId })
        .from(channelIntegrations)
        .where(
          and(
            eq(channelIntegrations.active, true),
            inArray(channelIntegrations.provider, ['ifood', 'simulator']),
          ),
        )
        .limit(500),
      catalogs: await tx
        .select({ id: channelIntegrations.id, tenantId: channelIntegrations.tenantId })
        .from(channelIntegrations)
        .where(
          and(
            eq(channelIntegrations.active, true),
            eq(channelIntegrations.provider, 'generic'),
            isNotNull(channelIntegrations.outboundUrl),
            or(
              isNull(channelIntegrations.lastCatalogSyncAt),
              lt(
                channelIntegrations.lastCatalogSyncAt,
                new Date(now.getTime() - CATALOG_SYNC_EVERY_MS),
              ),
            ),
          ),
        )
        .limit(200),
      actions: await tx
        .selectDistinct({ tenantId: channelActions.tenantId })
        .from(channelActions)
        .where(and(eq(channelActions.status, 'pending'), lt(channelActions.nextAttemptAt, now)))
        .limit(500),
      boletos: await tx
        .select({ id: boletoCharges.id, tenantId: boletoCharges.tenantId })
        .from(boletoCharges)
        .where(inArray(boletoCharges.status, ['registered', 'overdue']))
        .limit(200),
    }));
    for (const i of work.integrations) {
      await this.channels.poll(i.tenantId, i.id).catch((e: Error) => this.logger.warn(e.message));
    }
    // Cardápio e estoque: a fila repete se o conector falhar; o que não mudou nem é reenviado.
    for (const c of work.catalogs) await this.channels.scheduleCatalogSync(c.tenantId, c.id);
    for (const a of work.actions) {
      await this.channels
        .requeueDue(a.tenantId, now)
        .catch((e: Error) => this.logger.warn(e.message));
    }
    for (const b of work.boletos) {
      await this.boletos.refresh(b.tenantId, b.id).catch((e: Error) => this.logger.warn(e.message));
    }
    return {
      integrations: work.integrations.length,
      catalogs: work.catalogs.length,
      actions: work.actions.length,
      boletos: work.boletos.length,
    };
  }
}
