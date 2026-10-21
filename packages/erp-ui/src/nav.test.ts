import { describe, expect, it } from 'vitest';
import { groupOf, NAV_GROUPS, searchNav, visibleGroups } from './nav';

const ALL = [
  'catalog.read',
  'catalog.write',
  'pos.sell',
  'finance.read',
  'parties.read',
  'audit.read',
  'admin.terminals',
  'admin.users',
  'admin.stores',
  'admin.integrations',
];

describe('menu agrupado', () => {
  it('cada tela aparece uma vez só, em um grupo', () => {
    const routes = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.to));
    expect(new Set(routes).size).toBe(routes.length);
    expect(routes).toHaveLength(49);
  });

  it('cada grupo fica pequeno o bastante para ler de uma vez', () => {
    for (const group of NAV_GROUPS) expect(group.items.length).toBeLessThanOrEqual(10);
  });

  it('só mostra o que a pessoa pode acessar e some com grupo vazio', () => {
    const operator = visibleGroups(['pos.sell']);
    const routes = operator.flatMap((g) => g.items.map((i) => i.to));
    expect(routes).toContain('/comandas');
    expect(routes).toContain('/configuracoes');
    expect(routes).not.toContain('/equipe');
    expect(routes).not.toContain('/produtos');
    expect(operator.map((g) => g.id)).not.toContain('financeiro');
  });

  it('esconde itens pelo filtro extra (o desktop não oferece baixar o desktop)', () => {
    const routes = visibleGroups(ALL, (i) => i.to === '/baixar').flatMap((g) =>
      g.items.map((i) => i.to),
    );
    expect(routes).not.toContain('/baixar');
  });
});

describe('busca no menu', () => {
  const groups = visibleGroups(ALL);
  const found = (q: string) => searchNav(groups, q).map((r) => r.item.to);

  it('acha pelo nome sem precisar de acento nem maiúscula', () => {
    expect(found('promocoes')).toEqual(['/promocoes']);
    expect(found('INVENTÁRIO')).toEqual(['/inventario']);
  });

  it('acha pela palavra do dia a dia, não só pelo nome da tela', () => {
    expect(found('boleto')).toContain('/financeiro');
    expect(found('fiado')).toEqual(expect.arrayContaining(['/clientes', '/inadimplencia']));
    expect(found('impressora')).toContain('/perifericos');
    expect(found('nota fiscal')).toContain('/nfe');
  });

  it('todas as palavras precisam casar', () => {
    expect(found('lote vencido')).toEqual(['/lotes']);
    expect(found('lote pizza')).toEqual([]);
  });

  it('busca vazia não lista nada', () => {
    expect(found('   ')).toEqual([]);
  });

  it('não acha o que a pessoa não pode acessar', () => {
    expect(searchNav(visibleGroups(['pos.sell']), 'equipe')).toEqual([]);
  });
});

describe('grupo da tela aberta', () => {
  it('abre o grupo certo, inclusive em subtelas', () => {
    expect(groupOf('/fluxo-de-caixa')).toBe('financeiro');
    expect(groupOf('/ajuda/crediario')).toBeNull();
    expect(groupOf('/')).toBeNull();
    expect(groupOf('/nfe')).toBe('fiscal');
  });
});
