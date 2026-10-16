import { createHash, randomBytes } from 'node:crypto';

/**
 * Chave da API pública (ADR-0016): `bpk_<id do cliente sem hífens>_<32 bytes em base64url>`.
 * O id do cliente dentro da chave deixa a busca rodar em `withTenant`, com RLS. O banco guarda
 * só o SHA-256 e o prefixo para mostrar na tela.
 */
const KEY = /^bpk_([0-9a-f]{32})_([A-Za-z0-9_-]{43})$/;

export function isApiKey(token: string): boolean {
  return token.startsWith('bpk_');
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function generateApiKey(tenantId: string): { key: string; prefix: string; hash: string } {
  const key = `bpk_${tenantId.replace(/-/g, '')}_${randomBytes(32).toString('base64url')}`;
  return { key, prefix: `${key.slice(0, 12)}…${key.slice(-4)}`, hash: hashApiKey(key) };
}

/** O id do cliente (com hífens) de uma chave bem formada; null se o formato não bate. */
export function apiKeyTenant(key: string): string | null {
  const m = KEY.exec(key);
  if (!m) return null;
  const h = m[1]!;
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
