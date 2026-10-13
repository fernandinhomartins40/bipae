import { Secret, TOTP } from 'otpauth';

/** Time-based one-time codes (RFC 6238): 2FA of the Bipaê staff and of client users. */

export function newTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

function totp(secret: string, label: string, issuer = 'Bipaê Admin') {
  return new TOTP({
    issuer,
    label,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  });
}

/** otpauth:// link for the QR code; the issuer is the name shown in the authenticator app. */
export function totpUri(secret: string, label: string, issuer?: string): string {
  return totp(secret, label, issuer).toString();
}

/** Accepts the current code and the neighbours (±30 s) for clock drift. */
export function verifyTotp(secret: string, code: string): boolean {
  return totp(secret, 'x').validate({ token: code, window: 1 }) !== null;
}

/** For tests and the CLI only. */
export function currentTotp(secret: string): string {
  return totp(secret, 'x').generate();
}
