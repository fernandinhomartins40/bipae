import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { jwtVerify, SignJWT } from 'jose';
import type { Config } from '../config';
import { CONFIG } from './di';
import { AppError } from './errors';

/** Client (tenant) access token claims. */
export interface AccessClaims {
  sub: string;
  tid: string;
  /** Bipaê staff member acting as this client (support session). */
  imp?: string;
  /** Support session limited to reading. */
  ro?: boolean;
}

/** Bipaê staff (super admin) access token claims. */
export interface AdminClaims {
  sub: string;
  /** Second factor verified in this session. */
  mfa: boolean;
}

const APP_AUDIENCE = 'bipae-app';
const ADMIN_AUDIENCE = 'bipae-admin';
const SESSION_EXPIRED = 'Sua sessão expirou. Entre novamente.';

/**
 * Short-lived JWT access tokens + opaque rotating refresh tokens (ADR-0002).
 * Client and staff tokens have different audiences, so one can never be used as the other.
 */
@Injectable()
export class TokenService {
  private readonly key: Uint8Array;

  constructor(@Inject(CONFIG) private readonly config: Config) {
    this.key = new TextEncoder().encode(config.JWT_SECRET);
  }

  get accessTtl() {
    return this.config.ACCESS_TOKEN_TTL_SECONDS;
  }

  async signAccess(
    claims: AccessClaims,
    ttlSeconds = this.config.ACCESS_TOKEN_TTL_SECONDS,
  ): Promise<string> {
    return new SignJWT({
      tid: claims.tid,
      ...(claims.imp && { imp: claims.imp }),
      ...(claims.ro && { ro: true }),
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.sub)
      .setIssuedAt()
      .setIssuer('bipae')
      .setAudience(APP_AUDIENCE)
      .setExpirationTime(`${ttlSeconds}s`)
      .sign(this.key);
  }

  async verifyAccess(token: string): Promise<AccessClaims> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: 'bipae',
        audience: APP_AUDIENCE,
        algorithms: ['HS256'],
      });
      if (typeof payload.sub !== 'string' || typeof payload.tid !== 'string') throw new Error();
      return {
        sub: payload.sub,
        tid: payload.tid,
        ...(typeof payload.imp === 'string' && { imp: payload.imp }),
        ...(payload.ro === true && { ro: true }),
      };
    } catch {
      throw new AppError(401, 'unauthenticated', SESSION_EXPIRED);
    }
  }

  async signAdmin(claims: AdminClaims): Promise<string> {
    return new SignJWT({ mfa: claims.mfa })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.sub)
      .setIssuedAt()
      .setIssuer('bipae')
      .setAudience(ADMIN_AUDIENCE)
      .setExpirationTime(`${this.config.ADMIN_ACCESS_TTL_SECONDS}s`)
      .sign(this.key);
  }

  async verifyAdmin(token: string): Promise<AdminClaims> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: 'bipae',
        audience: ADMIN_AUDIENCE,
        algorithms: ['HS256'],
      });
      if (typeof payload.sub !== 'string') throw new Error();
      return { sub: payload.sub, mfa: payload.mfa === true };
    } catch {
      throw new AppError(401, 'unauthenticated', SESSION_EXPIRED);
    }
  }

  /** Refresh token format: `<scope>.<sessionId>.<secret>`; only a hash of the secret is stored. */
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
      throw new AppError(401, 'unauthenticated', SESSION_EXPIRED);
    }
    return { tenantId, sessionId, secret };
  }
}
