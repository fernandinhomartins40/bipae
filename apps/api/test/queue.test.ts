import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MemoryQueue, RedisQueue, type JobQueue } from '../src/common/queue';
import { asPlatform } from '../src/db/client';
import { rowsOf } from '../src/db/migrate';
import { MaintenanceService } from '../src/modules/maintenance/maintenance.service';
import { createTestApp, signup, type TestApp } from './helpers';

/** F1-07: fila de tarefas com nova tentativa e a rotina de limpeza de logins antigos. */

/** O mesmo roteiro vale para as duas versões da fila. */
function roteiroDaFila(
  nome: string,
  criar: () => JobQueue,
  esperar: (fila: JobQueue, ok: () => boolean) => Promise<void>,
) {
  describe(nome, () => {
    it('tenta de novo quando a tarefa falha e para quando dá certo', async () => {
      const fila = criar();
      let tentativas = 0;
      const recebidos: unknown[] = [];
      fila.process('enviar', async (dados) => {
        tentativas++;
        if (tentativas < 3) throw new Error('servidor fora do ar');
        recebidos.push(dados);
      });
      await fila.add('enviar', { nota: 42 }, { attempts: 5, backoffMs: 20 });
      await esperar(fila, () => recebidos.length === 1);
      expect(tentativas).toBe(3);
      expect(recebidos).toEqual([{ nota: 42 }]);
      await fila.close();
    });

    it('desiste depois do número de tentativas combinado', async () => {
      const fila = criar();
      let tentativas = 0;
      fila.process('quebrada', async () => {
        tentativas++;
        throw new Error('sempre falha');
      });
      await fila.add('quebrada', {}, { attempts: 2, backoffMs: 20 });
      await esperar(fila, () => tentativas === 2);
      // Um tempo a mais: não pode haver uma terceira tentativa.
      await new Promise((r) => setTimeout(r, 150));
      expect(tentativas).toBe(2);
      await fila.close();
    });
  });
}

const ate = async (ok: () => boolean, limiteMs = 10_000) => {
  const fim = Date.now() + limiteMs;
  while (!ok()) {
    if (Date.now() > fim) throw new Error('a tarefa não terminou a tempo');
    await new Promise((r) => setTimeout(r, 20));
  }
};

roteiroDaFila(
  'fila em memória',
  () => new MemoryQueue(),
  async (fila, ok) => {
    await (fila as MemoryQueue).idle();
    await ate(ok);
  },
);

// A versão com Redis roda na CI (TEST_REDIS_URL); nesta máquina não há Redis.
const redis = process.env.TEST_REDIS_URL;
if (redis) {
  let n = 0;
  roteiroDaFila(
    'fila em Redis (BullMQ)',
    () => new RedisQueue(redis, undefined, `teste-${Date.now()}-${n++}`),
    (_fila, ok) => ate(ok),
  );
}

describe('limpeza de logins antigos', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('apaga só o que venceu ou foi encerrado há mais de 30 dias', async () => {
    const dono = await signup(t.app);
    const contar = async () =>
      Number(
        (
          await asPlatform(t.database.db, async (tx) =>
            rowsOf<{ n: number }>(
              await tx.execute(
                sql`select count(*) as n from sessions where user_id = ${dono.me.user.id}`,
              ),
            ),
          )
        )[0]!.n,
      );
    // O login do cadastro está ativo; cria um vencido há 40 dias e outro encerrado há 5 dias.
    await asPlatform(t.database.db, async (tx) => {
      for (const [vence, encerrado] of [
        ["now() - interval '40 days'", 'null'],
        ["now() + interval '10 days'", "now() - interval '5 days'"],
      ]) {
        await tx.execute(
          sql.raw(`insert into sessions (id, tenant_id, user_id, family_id, token_hash, expires_at, revoked_at)
                   values (gen_random_uuid(), '${dono.me.tenant.id}', '${dono.me.user.id}', gen_random_uuid(), 'x', ${vence}, ${encerrado})`),
        );
      }
    });
    expect(await contar()).toBe(3);

    const removidos = await t.app.get(MaintenanceService).cleanupSessions();
    expect(removidos).toBe(1);
    expect(await contar()).toBe(2);
    // O login em uso continua valendo.
    const eu = await t.app.inject({ method: 'GET', url: '/v1/auth/me', headers: dono.auth });
    expect(eu.statusCode).toBe(200);
  });
});
