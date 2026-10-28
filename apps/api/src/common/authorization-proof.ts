import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Prova de que um gerente autorizou uma ação sensível no caixa (PIE ACH-03). O servidor assina
 * empresa, gerente, permissão e horário quando o gerente digita a senha; o caixa guarda a prova no
 * evento, e o sync confere. Sem a prova, o evento entra do mesmo jeito (o caixa nunca perde venda),
 * mas a trilha de auditoria marca para revisão: ninguém consegue inventar um "autorizado por"
 * só escrevendo o id do gerente no evento.
 *
 * Formato: `v1.<emitida em ms>.<hmac base64url>`.
 */
export class AuthorizationProofs {
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = createHash('sha256').update(`bipae-authorization:${secret}`).digest();
  }

  issue(tenantId: string, userId: string, permission: string, at: Date = new Date()): string {
    const issuedAt = at.getTime();
    return `v1.${issuedAt}.${this.sign(tenantId, userId, permission, issuedAt)}`;
  }

  /**
   * A prova confere com a empresa, o gerente e a permissão, e foi emitida perto da hora do evento:
   * até 5 minutos depois (relógio do caixa adiantado) e até 30 minutos antes.
   */
  verify(
    tenantId: string,
    userId: string,
    permission: string,
    proof: string | null | undefined,
    occurredAt: Date,
  ): boolean {
    const [version, issued, mac] = (proof ?? '').split('.');
    if (version !== 'v1' || !issued || !mac || !/^\d{1,15}$/.test(issued)) return false;
    const issuedAt = Number(issued);
    const delta = occurredAt.getTime() - issuedAt;
    if (delta < -5 * 60_000 || delta > 30 * 60_000) return false;
    const expected = Buffer.from(this.sign(tenantId, userId, permission, issuedAt));
    const given = Buffer.from(mac);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  private sign(tenantId: string, userId: string, permission: string, issuedAt: number) {
    return createHmac('sha256', this.key)
      .update(`${tenantId}|${userId}|${permission}|${issuedAt}`)
      .digest('base64url');
  }
}
