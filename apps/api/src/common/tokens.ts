import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { jwtVerify, SignJWT } from 'jose';
import type { Config } from '../config';
import { CONFIG } from './di';
import { AppError } from './errors';

export interface AccessClaims {
  sub: string;
  tid: string;
}

/** Short-lived JWT access tokens + opaque rotating refresh tokens (ADR-0002). */
@Injectable()
export class TokenService {
  private readonly key: Uint8Array;

  constructor(@Inject(CONFIG) private readonly config: Config) {
    this.key = new TextEncoder().encode(config.JWT_SECRET);
  }

  get accessTtl() {
    return this.config.ACCESS_TOKEN_TTL_SECONDS;
  }

  async signAccess(claims: AccessClaims): Promise<string> {
    return new SignJWT({ tid: claims.tid })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.sub)
      .setIssuedAt()
      .setIssuer('bipae')
      .setExpirationTime(`${this.config.ACCESS_TOKEN_TTL_SECONDS}s`)
      .sign(this.key);
  }

  async verifyAccess(token: string): Promise<AccessClaims> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: 'bipae',
        algorithms: ['HS256'],
      });
      if (typeof payload.sub !== 'string' || typeof payload.tid !== 'string') throw new Error();
      return { sub: payload.sub, tid: payload.tid };
    } catch {
      throw new AppError(401, 'unauthenticated', 'Sua sessão expirou. Entre novamente.');
    }
  }

  /** Refresh token format: `<tenantId>.<sessionId>.<secret>`; only a hash of the secret is stored. */
  newRefreshSecret(): string {
    return randomBytes(32).toString('base64url');
  }

  hashSecret(secret: string): string {
    return createHash('sha256').update(secret).digest('hex');
  }

  secretMatches(secret: string, hash: string): boolean {
    const a = Buffer.from(this.hashSecret(secret), 'hex');
    const b = Buffer.from(hash, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  parseRefreshToken(token: string): { tenantId: string; sessionId: string; secret: string } {
    const [tenantId, sessionId, secret, ...rest] = token.split('.');
    if (!tenantId || !sessionId || !secret || rest.length > 0) {
      throw new AppError(401, 'unauthenticated', 'Sua sessão expirou. Entre novamente.');
    }
    return { tenantId, sessionId, secret };
  }
}
