import { COMPANY_TAX_REGIMES } from '@bipae/domain';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asPlatform } from '../src/db/client';
import { api, createTestApp, signup, type TestApp } from './helpers';

/** F3-06.a: consulta às tabelas fiscais oficiais e conferência dos códigos do cadastro. */

let t: TestApp;
let cliente: ReturnType<typeof api>;

beforeAll(async () => {
  t = await createTestApp();
  cliente = api(t.app, (await signup(t.app)).auth);
});
afterAll(() => t.close());

describe('consulta às tabelas fiscais', () => {
  it('busca NCM por palavras e mostra o caminho até o código', async () => {
    const res = await cliente.get(`/fiscal/ncm?q=${encodeURIComponent('arroz polido')}`);
    expect(res.statusCode).toBe(200);
    const arroz = res.json().items.find((n: { code: string }) => n.code === '10063021');
    expect(arroz).toMatchObject({ description: 'Polido ou brunido' });
    expect(arroz.path).toContain('Arroz.');
  });

  it('busca NCM pelo começo do código e respeita o limite', async () => {
    const res = await cliente.get('/fiscal/ncm?q=2203&limit=5');
    expect(res.json().items.map((n: { code: string }) => n.code)).toEqual(['22030000']);
    const limitado = await cliente.get('/fiscal/ncm?q=1006&limit=2');
    expect(limitado.json().items).toHaveLength(2);
  });

  it('pede pelo menos 2 caracteres na busca', async () => {
    const res = await cliente.get('/fiscal/ncm?q=a');
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe('Digite pelo menos 2 caracteres para buscar o NCM');
  });

  it('consulta um NCM, com ou sem pontos', async () => {
    const res = await cliente.get('/fiscal/ncm/2203.00.00');
    expect(res.json()).toMatchObject({ code: '22030000', description: 'Cervejas de malte.' });
    const inexistente = await cliente.get('/fiscal/ncm/99999999');
    expect(inexistente.statusCode).toBe(404);
    expect(inexistente.json().message).toBe('NCM não encontrado.');
  });

  it('sugere os CEST de um NCM, com o nome do segmento', async () => {
    const res = await cliente.get('/fiscal/cest?ncm=2203.00.00');
    expect(res.statusCode).toBe(200);
    const garrafa = res.json().items.find((c: { cest: string }) => c.cest === '0302100');
    expect(garrafa).toMatchObject({
      description: 'Cerveja em garrafa de vidro retornável',
      segment: 'Cervejas, chopes, refrigerantes, águas e outras bebidas',
      ncm: '22030000',
    });
    expect((await cliente.get('/fiscal/cest?ncm=01012100')).json().items).toEqual([]);
    expect((await cliente.get('/fiscal/cest?ncm=2203')).statusCode).toBe(400);
  });

  it('entrega as listas do perfil fiscal, só com o que serve para venda', async () => {
    const res = await cliente.get('/fiscal/options');
    expect(res.statusCode).toBe(200);
    const opcoes = res.json();
    const codigos = (lista: { code: string }[]) => lista.map((item) => item.code);
    expect(opcoes.origins).toHaveLength(9);
    expect(codigos(opcoes.cfopInterna)).toContain('5102');
    expect(codigos(opcoes.cfopInterna).every((c: string) => c.startsWith('5'))).toBe(true);
    expect(codigos(opcoes.cfopInterestadual)).toContain('6102');
    expect(codigos(opcoes.cfopInterestadual).every((c: string) => c.startsWith('6'))).toBe(true);
    expect(codigos(opcoes.csosn)).toContain('102');
    expect(codigos(opcoes.cstIcms)).toContain('00');
    expect(codigos(opcoes.classTrib)).toContain('000001');
    // Os códigos de vigência indefinida (dúvida D-016) não são oferecidos.
    expect(codigos(opcoes.classTrib)).not.toContain('220001');
    expect(opcoes.sources.cfop.title).toContain('CFOP');
  });

  it('exige login', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/v1/fiscal/options' });
    expect(res.statusCode).toBe(401);
  });
});

describe('conferência dos códigos fiscais do produto', () => {
  it('recusa NCM e CEST que não existem na tabela, com mensagem clara', async () => {
    const ncm = await cliente.post('/products', { name: 'Produto A', priceCents: 100, ncm: '99999999' });
    expect(ncm.statusCode).toBe(400);
    expect(ncm.json().message).toBe('O NCM 99999999 não existe na tabela vigente. Confira o código.');
    expect(ncm.json().issues[0].path).toBe('ncm');

    const cest = await cliente.post('/products', { name: 'Produto B', priceCents: 100, cest: '9999999' });
    expect(cest.statusCode).toBe(400);
    expect(cest.json().message).toBe('O CEST 9999999 não existe na tabela vigente. Confira o código.');
  });

  it('aceita NCM e CEST válidos e produto sem código fiscal', async () => {
    const cerveja = await cliente.post('/products', {
      name: 'Cerveja 600ml',
      priceCents: 990,
      ncm: '22030000',
      cest: '0302100',
    });
    expect(cerveja.statusCode).toBe(201);
    expect(cerveja.json()).toMatchObject({ ncm: '22030000', cest: '0302100' });
    expect((await cliente.post('/products', { name: 'Sem fiscal', priceCents: 100 })).statusCode).toBe(201);
  });

  it('NCM antigo já gravado não impede alterar o produto; trocar por outro inválido, sim', async () => {
    const criado = (await cliente.post('/products', { name: 'Antigo', priceCents: 100, ncm: '22030000' })).json();
    // Simula um NCM que foi extinto depois do cadastro.
    await asPlatform(t.database.db, (tx) =>
      tx.execute(sql`update products set ncm = '99999999' where id = ${criado.id}`),
    );
    const novoPreco = await cliente.put(`/products/${criado.id}`, { ...criado, ncm: '99999999', priceCents: 150 });
    expect(novoPreco.statusCode).toBe(200);
    expect(novoPreco.json().priceCents).toBe(150);

    const outroInvalido = await cliente.put(`/products/${criado.id}`, { ...criado, ncm: '88888888' });
    expect(outroInvalido.statusCode).toBe(400);
    const corrigido = await cliente.put(`/products/${criado.id}`, { ...criado, ncm: '10063021' });
    expect(corrigido.statusCode).toBe(200);
  });
});

describe('conferência dos códigos do perfil fiscal', () => {
  const valido = {
    name: 'Revenda Simples',
    origem: 0,
    cfopInterna: '5102',
    cfopInterestadual: '6102',
    csosn: '102',
    cClassTrib: '000001',
  };

  it('aceita um perfil com códigos oficiais', async () => {
    const res = await cliente.post('/fiscal-profiles', valido);
    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({ cfopInterna: '5102', csosn: '102', cClassTrib: '000001' });
  });

  it('explica o que está errado em cada código', async () => {
    const casos: [Record<string, unknown>, string][] = [
      [{ cfopInterna: '6102' }, 'O CFOP 6102 não é de venda dentro do estado. Os CFOP de venda dentro do estado começam com 5.'],
      [{ cfopInterestadual: '5102' }, 'O CFOP 5102 não é de venda para outro estado. Os CFOP de venda para outro estado começam com 6.'],
      [{ cfopInterna: '1102' }, 'O CFOP 1102 não é de venda dentro do estado. Os CFOP de venda dentro do estado começam com 5.'],
      [{ cfopInterna: '5999' }, 'O CFOP 5999 não existe na tabela vigente.'],
      [{ csosn: '999' }, 'O CSOSN 999 não existe.'],
      [{ csosn: null, cstIcms: '99' }, 'O CST de ICMS 99 não existe.'],
      [{ cClassTrib: '999999' }, 'A classificação tributária 999999 não existe na tabela oficial.'],
      [{ cClassTrib: '220001' }, 'A classificação tributária 220001 não está em vigor.'],
    ];
    for (const [troca, mensagem] of casos) {
      const res = await cliente.post('/fiscal-profiles', { ...valido, name: `Perfil ${mensagem.slice(0, 30)}`, ...troca });
      expect(res.statusCode, mensagem).toBe(400);
      expect(res.json().message, mensagem).toBe(mensagem);
    }
  });

  it('confere também na alteração', async () => {
    const criado = (await cliente.post('/fiscal-profiles', { ...valido, name: 'Para alterar' })).json();
    const res = await cliente.put(`/fiscal-profiles/${criado.id}`, { ...valido, name: 'Para alterar', csosn: '777' });
    expect(res.statusCode).toBe(400);
    const ok = await cliente.put(`/fiscal-profiles/${criado.id}`, { ...valido, name: 'Para alterar', csosn: '500' });
    expect(ok.statusCode).toBe(200);
  });
});

describe('regime tributário e UF da empresa (F3-06.c)', () => {
  it('as opções trazem os cinco regimes e a situação das 27 UFs', async () => {
    const opcoes = (await cliente.get('/fiscal/options')).json();
    // O domínio e o motor fiscal precisam listar os mesmos regimes.
    expect(opcoes.regimes.map((r: { id: string }) => r.id)).toEqual([...COMPANY_TAX_REGIMES]);
    expect(opcoes.regimes.find((r: { id: string }) => r.id === 'mei')).toMatchObject({ crt: 4, icmsCode: 'csosn' });
    expect(opcoes.ufRates).toHaveLength(27);
    expect(opcoes.ufRates.find((u: { uf: string }) => u.uf === 'SP')).toMatchObject({ status: 'confirmado', rate: '18' });
    // UF sem confirmação oficial vem sem número, nunca com valor suposto.
    expect(opcoes.ufRates.find((u: { uf: string }) => u.uf === 'AL')).toMatchObject({ status: 'divergente', rate: null });
  });

  it('a empresa guarda o regime e recusa valor fora da lista', async () => {
    const [empresa] = (await cliente.get('/companies')).json();
    expect(empresa.taxRegime).toBeNull();

    const salvo = await cliente.patch(`/companies/${empresa.id}`, {
      legalName: empresa.legalName,
      uf: 'SP',
      taxRegime: 'simples-excesso',
    });
    expect(salvo.statusCode).toBe(200);
    expect(salvo.json()).toMatchObject({ uf: 'SP', taxRegime: 'simples-excesso' });
    expect((await cliente.get('/companies')).json()[0].taxRegime).toBe('simples-excesso');

    const invalido = await cliente.patch(`/companies/${empresa.id}`, {
      legalName: empresa.legalName,
      taxRegime: 'ltda',
    });
    expect(invalido.statusCode).toBe(400);
    expect(invalido.json().message).toBe('Regime tributário inválido');
  });
});
