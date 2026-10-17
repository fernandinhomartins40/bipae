import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HELP_ARTICLES, HELP_CATEGORIES, searchHelp } from './articles';

/** F7-04: a central de ajuda não pode ter artigo quebrado nem link para tela que não existe. */

const routes = [
  ...readFileSync(resolve(process.cwd(), 'src/app.tsx'), 'utf8').matchAll(/path="([^"]+)"/g),
].map((m) => `/${m[1]!.replace(/^\/+/, '')}`);

describe('central de ajuda (F7-04)', () => {
  it('cada artigo tem endereço único, categoria conhecida e passos', () => {
    const slugs = HELP_ARTICLES.map((a) => a.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const a of HELP_ARTICLES) {
      expect(a.slug, a.slug).toMatch(/^[a-z0-9-]+$/);
      expect(HELP_CATEGORIES, a.slug).toContain(a.category);
      expect(a.body.length, a.slug).toBeGreaterThan(0);
    }
    // Toda categoria tem pelo menos um artigo.
    for (const c of HELP_CATEGORIES)
      expect(
        HELP_ARTICLES.some((a) => a.category === c),
        c,
      ).toBe(true);
  });

  it('o "Ir para" de cada artigo leva a uma tela que existe', () => {
    for (const a of HELP_ARTICLES) {
      if (a.screen) expect(routes, a.slug).toContain(a.screen.to);
    }
  });

  it('a busca acha pelo jeito que as pessoas escrevem (sem acento, várias palavras)', () => {
    expect(searchHelp('sangria').map((a) => a.slug)).toContain('sangria-e-fechamento');
    expect(searchHelp('DEVOLUCAO').map((a) => a.slug)).toContain('cancelar-e-devolver');
    expect(searchHelp('fiado').map((a) => a.slug)).toEqual(['crediario']);
    expect(searchHelp('nota recusada').map((a) => a.slug)).toContain('nfce');
    expect(searchHelp('  ')).toHaveLength(HELP_ARTICLES.length);
    expect(searchHelp('palavra-que-nao-existe')).toEqual([]);
  });
});
