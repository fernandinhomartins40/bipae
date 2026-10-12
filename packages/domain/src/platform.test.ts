import { describe, expect, it } from 'vitest';
import {
  accountAccess,
  adminLoginInput,
  describeLimit,
  effectiveLimits,
  limitMessage,
  planInput,
  platformCan,
  withinLimit,
  type PlanLimits,
} from './platform';

const GRATIS: PlanLimits = { companies: 1, stores: 1, terminals: 2, users: 3, products: 2000 };

describe('plan limits', () => {
  it('overrides replace only the informed resources (null lifts the limit)', () => {
    expect(effectiveLimits(GRATIS, { terminals: 5, products: null })).toEqual({
      ...GRATIS,
      terminals: 5,
      products: null,
    });
    expect(effectiveLimits(GRATIS, null)).toEqual(GRATIS);
    expect(effectiveLimits(GRATIS)).toEqual(GRATIS);
  });

  it('withinLimit allows while below the limit and always when unlimited', () => {
    expect(withinLimit(2, 1)).toBe(true);
    expect(withinLimit(2, 2)).toBe(false);
    expect(withinLimit(null, 1_000_000)).toBe(true);
  });

  it('messages use singular and plural in plain Portuguese', () => {
    expect(limitMessage('companies', 1, 'Grátis')).toMatch(
      /^O plano Grátis permite até 1 empresa\. /,
    );
    expect(limitMessage('terminals', 3, 'Essencial')).toContain('até 3 caixas.');
    expect(describeLimit('stores', 1)).toBe('1 loja');
    expect(describeLimit('products', 5000)).toBe('5.000 produtos');
    expect(describeLimit('users', null)).toBe('usuários sem limite');
  });
});

describe('account access', () => {
  const now = new Date('2026-10-12T12:00:00Z');

  it('active accounts and running trials are allowed', () => {
    expect(accountAccess('active', null, now)).toEqual({ allowed: true });
    expect(accountAccess('trial', '2026-10-20T00:00:00Z', now).allowed).toBe(true);
    expect(accountAccess('trial', null, now).allowed).toBe(true);
  });

  it('suspended, cancelled and expired trials are blocked with a reason', () => {
    expect(accountAccess('suspended', null, now)).toMatchObject({
      allowed: false,
      code: 'suspended',
    });
    expect(accountAccess('cancelled', null, now)).toMatchObject({
      allowed: false,
      code: 'cancelled',
    });
    expect(accountAccess('trial', new Date('2026-10-01T00:00:00Z'), now)).toMatchObject({
      allowed: false,
      code: 'trial_expired',
    });
    expect(accountAccess('suspended', null).message).toContain('Nenhuma venda foi perdida');
  });
});

describe('Bipaê staff', () => {
  it('owner can everything, support can help, viewer only reads', () => {
    expect(platformCan('owner', 'platform.admins.manage')).toBe(true);
    expect(platformCan('support', 'platform.support')).toBe(true);
    expect(platformCan('support', 'platform.tenants.manage')).toBe(false);
    expect(platformCan('viewer', 'platform.read')).toBe(true);
    expect(platformCan('viewer', 'platform.notes')).toBe(false);
  });

  it('validates the login code and plan ids', () => {
    expect(
      adminLoginInput.safeParse({ email: 'a@b.com.br', password: 'x', totp: '123456' }).success,
    ).toBe(true);
    expect(
      adminLoginInput.safeParse({ email: 'a@b.com.br', password: 'x', totp: '12a' }).success,
    ).toBe(false);
    const plan = { id: 'essencial', name: 'Essencial', priceCents: 4990, limits: GRATIS };
    expect(planInput.parse(plan)).toMatchObject({ public: true, active: true, features: [] });
    expect(planInput.safeParse({ ...plan, id: 'Plano Novo' }).success).toBe(false);
  });
});
