/** Injection tokens. The API uses explicit @Inject everywhere (no decorator metadata). */
export const CONFIG = Symbol('CONFIG');
export const DB = Symbol('DB');
/** Fila de tarefas em segundo plano (common/queue.ts). */
export const QUEUE = Symbol('QUEUE');
