import { Secret, TOTP } from 'otpauth';

/** Time-based one-time codes (RFC 6238) for the Bipaê staff 2FA (Google Authenticator etc.). */

export function newTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

function totp(secret: string, label: string) {
  return new TOTP({ issuer: 'Bipaê Admin', label, algorithm: 'SHA1', digits: 6, period: 30, secret: Secret.fromBase32(secret) });
}

export function totpUri(secret: string, label: string): string {
  return totp(secret, label).toString();
}

/** Accepts the current code and the neighbours (±30 s) for clock drift. */
export function verifyTotp(secret: string, code: string): boolean {
  return totp(secret, 'x').validate({ token: code, window: 1 }) !== null;
}

/** For tests and the CLI only. */
export function currentTotp(secret: string): string {
  return totp(secret, 'x').generate();
}
