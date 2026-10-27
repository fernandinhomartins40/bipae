import { ModulesContainer } from '@nestjs/core';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

const DECLARED = ['bipae:public', 'bipae:permission', 'bipae:public-api'];

/** Rotas de cliente (fora do painel /admin) sem nenhuma declaração de quem pode acessar. */
function undeclaredRoutes() {
  const found: string[] = [];
  for (const mod of t.app.get(ModulesContainer).values()) {
    for (const wrapper of mod.controllers.values()) {
      const type = wrapper.metatype as (new (...args: never[]) => unknown) | null;
      if (!type) continue;
      const base = String(Reflect.getMetadata(PATH_METADATA, type) ?? '');
      // O painel do Bipaê nega por padrão: sem @PlatformPermission só o papel owner passa.
      if (base.startsWith('admin')) continue;
      for (const name of Object.getOwnPropertyNames(type.prototype)) {
        const handler = (type.prototype as Record<string, unknown>)[name];
        if (typeof handler !== 'function' || name === 'constructor') continue;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
        if (method === undefined) continue;
        const declared = DECLARED.some(
          (key) =>
            Reflect.getMetadata(key, handler) !== undefined ||
            Reflect.getMetadata(key, type) !== undefined,
        );
        if (!declared) {
          const path = String(Reflect.getMetadata(PATH_METADATA, handler) ?? '');
          const full = [base, path]
            .flatMap((part) => part.split('/'))
            .filter(Boolean)
            .join('/');
          found.push(`${RequestMethod[method]} /${full}`);
        }
      }
    }
  }
  return found.sort();
}

/**
 * Rotas abertas a qualquer pessoa logada na empresa, de propósito: são da própria conta ou
 * sessão (quem sou eu, minhas empresas, meu 2FA, trocar de empresa) ou avisos para todos.
 * Rota nova sem @RequirePermission, @Public ou @PublicApi só entra aqui com justificativa.
 */
const OPEN_TO_ANY_MEMBER = [
  'GET /account',
  'GET /account/billing',
  'GET /announcements',
  'GET /auth/me',
  'GET /auth/totp',
  'GET /companies',
  'GET /stores',
  'POST /auth/authorize',
  'POST /auth/email/resend',
  'POST /auth/operator',
  'POST /auth/switch-tenant',
  'POST /auth/totp/disable',
  'POST /auth/totp/enable',
  'POST /auth/totp/setup',
];

describe('toda rota declara quem pode acessar (PIE R4-03)', () => {
  it('nenhuma rota de cliente fica aberta a qualquer membro sem estar na lista justificada', () => {
    expect(undeclaredRoutes()).toEqual(OPEN_TO_ANY_MEMBER);
  });
});
