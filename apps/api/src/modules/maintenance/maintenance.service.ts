import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { and, lt, or, sql } from 'drizzle-orm';
import type { Config } from '../../config';
import { CONFIG, DB, QUEUE } from '../../common/di';
import type { JobQueue } from '../../common/queue';
import { asPlatform, type Db } from '../../db/client';
import { adminSessions, sessions } from '../../db/schema';

export const SESSIONS_CLEANUP = 'manutencao.limpar-sessoes';
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
  ) {}

  async onModuleInit() {
    this.queue.process(SESSIONS_CLEANUP, async () => {
      const removed = await this.cleanupSessions();
      if (removed > 0) this.logger.log(`${removed} registros de login antigos apagados`);
    });
    // Nos testes a rotina é chamada direto, sem agendamento. O agendamento não segura a subida
    // da API: se o Redis demorar, a API sobe e a tarefa é agendada quando ele responder.
    if (this.config.NODE_ENV !== 'test') {
      void this.queue
        .add(SESSIONS_CLEANUP, {}, { repeatEveryMs: SEIS_HORAS })
        .catch((error: Error) =>
          this.logger.warn(`Não foi possível agendar a limpeza: ${error.message}`),
        );
    }
  }

  async onModuleDestroy() {
    await this.queue.close();
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
}
