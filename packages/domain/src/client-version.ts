/**
 * Client identification and minimum-version policy (ADR-0012 §6).
 * Header format: `X-Bipae-Client: <kind>/<semver>`, e.g. `desktop/1.4.2`.
 */
export const CLIENT_HEADER = 'x-bipae-client';
export const TERMINAL_HEADER = 'x-bipae-terminal';

export const CLIENT_KINDS = ['web', 'desktop', 'connector'] as const;
export type ClientKind = (typeof CLIENT_KINDS)[number];

export interface ClientInfo {
  kind: ClientKind;
  version: [number, number, number];
}

export function parseClientHeader(header: string | undefined | null): ClientInfo | null {
  if (!header) return null;
  const match = /^(web|desktop|connector)\/(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(header.trim());
  if (!match) return null;
  return {
    kind: match[1] as ClientKind,
    version: [Number(match[2]), Number(match[3]), Number(match[4])],
  };
}

export function parseVersion(value: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value);
  if (!match) throw new Error(`Versão inválida: ${value}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareVersions(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < 3; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}

export type MinimumVersions = Partial<Record<ClientKind, string>>;

/**
 * Whether a request must be refused with "please update" (HTTP 426).
 * Sync event uploads are never refused: pending sales from old clients must always be accepted.
 */
export function requiresUpdate(
  client: ClientInfo | null,
  minimums: MinimumVersions,
  path: string,
): boolean {
  if (!client || isSyncUploadPath(path)) return false;
  const minimum = minimums[client.kind];
  if (!minimum) return false;
  return compareVersions(client.version, parseVersion(minimum)) < 0;
}

export function isSyncUploadPath(path: string): boolean {
  return /^\/v\d+\/sync(\/|$)/.test(path);
}
