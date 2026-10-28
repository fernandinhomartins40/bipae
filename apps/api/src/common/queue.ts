import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';

/**
 * Fila de tarefas em segundo plano (F1-07), com nova tentativa automática. Duas versões com o
 * mesmo contrato: em memória (desenvolvimento e testes, sem Redis) e BullMQ + Redis (produção,
 * onde a tarefa sobrevive a uma reinicialização da API).
 */
export interface JobOptions {
  /** Quantas vezes tentar no total (padrão 3). */
  attempts?: number;
  /** Espera antes da 2ª tentativa; dobra a cada nova tentativa (padrão 1 s). */
  backoffMs?: number;
  /** Repete a tarefa neste intervalo (tarefas de manutenção). */
  repeatEveryMs?: number;
  /**
   * Tarefa com o mesmo id ainda na fila (esperando, rodando ou aguardando nova tentativa) faz esta
   * ser ignorada (PIE ACH-21): a varredura e o "tentar de novo" não empilham a mesma nota.
   */
  dedupeId?: string;
}

export type JobHandler = (data: unknown) => Promise<void>;

export interface JobQueue {
  readonly kind: 'memory' | 'redis';
  add(name: string, data?: unknown, options?: JobOptions): Promise<void>;
  process(name: string, handler: JobHandler): void;
  /** A fila consegue receber tarefas agora? (verificação de prontidão, PIE ACH-25) */
  ready(): boolean;
  close(): Promise<void>;
}

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BACKOFF_MS = 1000;

/** Fila em memória: as tarefas se perdem se o processo parar. Só para desenvolvimento e testes. */
export class MemoryQueue implements JobQueue {
  readonly kind = 'memory' as const;
  private readonly handlers = new Map<string, JobHandler>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private running = 0;
  private waiters: (() => void)[] = [];
  private closed = false;
  /** Ids de tarefas ainda na fila, para ignorar as repetidas. */
  private readonly queued = new Set<string>();
  /** Tarefas que esgotaram as tentativas (para testes e diagnóstico). */
  readonly failed: { name: string; error: string }[] = [];

  constructor(private readonly log: (message: string) => void = () => undefined) {}

  process(name: string, handler: JobHandler) {
    this.handlers.set(name, handler);
  }

  ready() {
    return !this.closed;
  }

  async add(name: string, data?: unknown, options: JobOptions = {}) {
    if (this.closed) return;
    if (options.repeatEveryMs) {
      const timer = setInterval(() => this.run(name, data, options, 1), options.repeatEveryMs);
      timer.unref?.();
      this.timers.add(timer);
      return;
    }
    if (options.dedupeId) {
      if (this.queued.has(options.dedupeId)) return;
      this.queued.add(options.dedupeId);
    }
    this.run(name, data, options, 1);
  }

  private release(options: JobOptions) {
    if (options.dedupeId) this.queued.delete(options.dedupeId);
  }

  private run(name: string, data: unknown, options: JobOptions, attempt: number) {
    const handler = this.handlers.get(name);
    if (!handler || this.closed) {
      this.release(options);
      return;
    }
    this.running++;
    void handler(data)
      .then(
        () => this.release(options),
        (error: Error) => {
          const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
          if (attempt >= attempts) {
            this.release(options);
            this.failed.push({ name, error: error.message });
            this.log(`Tarefa ${name} falhou ${attempts} vezes: ${error.message}`);
            return;
          }
          const wait = (options.backoffMs ?? DEFAULT_BACKOFF_MS) * 2 ** (attempt - 1);
          this.running++;
          const timer = setTimeout(() => {
            this.timers.delete(timer);
            this.run(name, data, options, attempt + 1);
            this.done();
          }, wait);
          this.timers.add(timer);
        },
      )
      .finally(() => this.done());
  }

  private done() {
    this.running--;
    if (this.running === 0) {
      for (const resolve of this.waiters.splice(0)) resolve();
    }
  }

  /** Resolve quando não há tarefa rodando nem aguardando nova tentativa (usado nos testes). */
  idle(): Promise<void> {
    return this.running === 0
      ? Promise.resolve()
      : new Promise((resolve) => this.waiters.push(resolve));
  }

  async close() {
    this.closed = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }
}

/** Fila em Redis (BullMQ): uma fila "bipae" com um trabalhador que despacha pelo nome da tarefa. */
export class RedisQueue implements JobQueue {
  readonly kind = 'redis' as const;
  private readonly handlers = new Map<string, JobHandler>();
  private readonly queue: Queue;
  private worker: Worker | null = null;
  private readonly client: IORedis;
  private lastError = '';

  constructor(
    redisUrl: string,
    private readonly log: (message: string) => void = () => undefined,
    queueName = 'bipae',
    /**
     * Tarefas rodando ao mesmo tempo (PIE ACH-21). Com uma só, uma SEFAZ lenta segurava e-mails,
     * cobranças e limpezas; toda tarefa já precisa aguentar rodar duas vezes.
     */
    private readonly concurrency = 4,
  ) {
    // O cliente é criado aqui e entregue pronto ao BullMQ: no pacote de produção (ESM) ele não
    // consegue carregar o `ioredis` sozinho, e a API não subia.
    this.client = new IORedis(redisUrl, {
      // Exigido pelo BullMQ nos trabalhadores (comandos bloqueantes).
      maxRetriesPerRequest: null,
    });
    // Redis fora do ar não pode derrubar a API: o cliente tenta reconectar sozinho.
    this.client.on('error', (error: Error) => this.warn(`Redis: ${error.message}`));
    this.queue = new Queue(queueName, { connection: this.connection });
    this.queue.on('error', (error) => this.warn(error.message));
  }

  private get connection(): ConnectionOptions {
    return this.client as unknown as ConnectionOptions;
  }

  /** Avisa uma vez por tipo de erro seguido, para a reconexão não encher o log. */
  private warn(message: string) {
    if (message === this.lastError) return;
    this.lastError = message;
    this.log(message);
  }

  process(name: string, handler: JobHandler) {
    this.handlers.set(name, handler);
    this.worker ??= this.start();
  }

  ready() {
    return this.client.status === 'ready';
  }

  private start() {
    const worker = new Worker(
      this.queue.name,
      async (job) => {
        const handler = this.handlers.get(job.name);
        if (!handler) throw new Error(`Nenhum tratador para a tarefa ${job.name}`);
        await handler(job.data);
      },
      { connection: this.connection, concurrency: this.concurrency },
    );
    worker.on('error', (error) => this.warn(error.message));
    worker.on('failed', (job, error) => {
      if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
        this.log(`Tarefa ${job.name} falhou ${job.attemptsMade} vezes: ${error.message}`);
      }
    });
    return worker;
  }

  async add(name: string, data?: unknown, options: JobOptions = {}) {
    const opts = {
      attempts: options.attempts ?? DEFAULT_ATTEMPTS,
      backoff: { type: 'exponential' as const, delay: options.backoffMs ?? DEFAULT_BACKOFF_MS },
      removeOnComplete: 100,
      removeOnFail: 500,
      // Ignora a repetida enquanto a primeira não termina (sucesso ou última falha).
      ...(options.dedupeId && { deduplication: { id: options.dedupeId } }),
    };
    if (options.repeatEveryMs) {
      // Tarefa repetida é um "agendador" do BullMQ com id fixo: reiniciar a API atualiza o mesmo
      // agendador em vez de criar outro. O id não pode ter dois-pontos (separador das chaves dele).
      await this.queue.upsertJobScheduler(
        `repetir-${name.replaceAll(':', '-')}`,
        { every: options.repeatEveryMs },
        { name, data: data ?? {}, opts },
      );
      return;
    }
    await this.queue.add(name, data ?? {}, opts);
  }

  async close() {
    await this.worker?.close();
    await this.queue.close();
    // O BullMQ não fecha um cliente que recebeu pronto.
    this.client.disconnect();
  }
}

/**
 * Cria a fila conforme a configuração. Se a versão com Redis não puder ser montada, a API sobe
 * com a fila em memória e avisa no log: tarefa em segundo plano nunca derruba o sistema.
 */
export function createQueue(
  redisUrl: string | undefined,
  log: (message: string) => void = () => undefined,
  concurrency = 4,
): JobQueue {
  if (!redisUrl) return new MemoryQueue(log);
  try {
    return new RedisQueue(redisUrl, log, 'bipae', concurrency);
  } catch (error) {
    log(`Fila em Redis indisponível, usando a fila em memória: ${(error as Error).message}`);
    return new MemoryQueue(log);
  }
}
