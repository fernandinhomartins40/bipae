/**
 * Contador de pedidos por janela fixa, na memória da API (uma instância). Serve de freio para
 * quem usa chave da API pública e para quem erra a chave (F7-02.c, ASVS 13.2). Com mais de uma
 * instância, o limite vale por instância; o Redis fica para a F7-02.b.
 */
export class RateWindow {
  private readonly hits = new Map<string, { count: number; start: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs = 60_000,
  ) {}

  /** Conta um pedido; devolve false quando a chave já passou do limite na janela atual. */
  allow(key: string, now = Date.now()): boolean {
    const entry = this.hits.get(key);
    if (!entry || now - entry.start >= this.windowMs) {
      this.hits.set(key, { count: 1, start: now });
      // Não deixa o mapa crescer sem limite com chaves inventadas.
      if (this.hits.size > 20_000) {
        for (const [k, v] of this.hits) if (now - v.start >= this.windowMs) this.hits.delete(k);
      }
      return true;
    }
    entry.count++;
    return entry.count <= this.max;
  }
}
