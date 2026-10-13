import { Queue, Worker, type ConnectionOptions } from 'bullmq';

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
}

export type JobHandler = (data: unknown) => Promise<void>;

export interface JobQueue {
  readonly kind: 'memory' | 'redis';
  add(name: string, data?: unknown, options?: JobOptions): Promise<void>;
  process(name: string, handler: JobHandler): void;
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
  /** Tarefas que esgotaram as tentativas (para testes e diagnóstico). */
  readonly failed: { name: string; error: string }[] = [];

  constructor(private readonly log: (message: string) => void = () => undefined) {}

  process(name: string, handler: JobHandler) {
    this.handlers.set(name, handler);
  }

  async add(name: string, data?: unknown, options: JobOptions = {}) {
    if (this.closed) return;
    if (options.repeatEveryMs) {
      const timer = setInterval(() => this.run(name, data, options, 1), options.repeatEveryMs);
      timer.unref?.();
      this.timers.add(timer);
      return;
    }
    this.run(name, data, options, 1);
  }

  private run(name: string, data: unknown, options: JobOptions, attempt: number) {
    const handler = this.handlers.get(name);
    if (!handler || this.closed) return;
    this.running++;
    void handler(data)
      .then(
        () => undefined,
        (error: Error) => {
          const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
          if (attempt >= attempts) {
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
  private readonly connection: ConnectionOptions;

  constructor(
    redisUrl: string,
    private readonly log: (message: string) => void = () => undefined,
    queueName = 'bipae',
  ) {
    const url = new URL(redisUrl);
    this.connection = {
      host: url.hostname,
      port: Number(url.port || 6379),
      ...(url.password && { password: decodeURIComponent(url.password) }),
      // Exigido pelo BullMQ nos trabalhadores (comandos bloqueantes).
      maxRetriesPerRequest: null,
    };
    this.queue = new Queue(queueName, { connection: this.connection });
  }

  process(name: string, handler: JobHandler) {
    this.handlers.set(name, handler);
    this.worker ??= this.start();
  }

  private start() {
    const worker = new Worker(
      this.queue.name,
      async (job) => {
        const handler = this.handlers.get(job.name);
        if (!handler) throw new Error(`Nenhum tratador para a tarefa ${job.name}`);
        await handler(job.data);
      },
      { connection: this.connection },
    );
    worker.on('failed', (job, error) => {
      if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
        this.log(`Tarefa ${job.name} falhou ${job.attemptsMade} vezes: ${error.message}`);
      }
    });
    return worker;
  }

  async add(name: string, data?: unknown, options: JobOptions = {}) {
    await this.queue.add(name, data ?? {}, {
      attempts: options.attempts ?? DEFAULT_ATTEMPTS,
      backoff: { type: 'exponential', delay: options.backoffMs ?? DEFAULT_BACKOFF_MS },
      removeOnComplete: 100,
      removeOnFail: 500,
      // Tarefa repetida tem id fixo: reiniciar a API não agenda duas vezes.
      ...(options.repeatEveryMs && {
        repeat: { every: options.repeatEveryMs },
        jobId: `repetir:${name}`,
      }),
    });
  }

  async close() {
    await this.worker?.close();
    await this.queue.close();
  }
}

export function createQueue(
  redisUrl: string | undefined,
  log?: (message: string) => void,
): JobQueue {
  return redisUrl ? new RedisQueue(redisUrl, log) : new MemoryQueue(log);
}
