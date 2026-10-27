import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONFIG } from '../src/common/di';
import type { Config } from '../src/config';
import type { AiProvider, AiRequest, AiResponse } from '../src/modules/ai/ai.provider';
import { AiService } from '../src/modules/ai/ai.service';
import { api, createTestApp, signup, type TestApp } from './helpers';

/** F6-07: assistente de IA com confirmação humana (ADR-0011), contra um provedor simulado. */

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

/** Provedor simulado: devolve as respostas da fila e guarda os pedidos para conferir. */
class FakeProvider implements AiProvider {
  readonly model = 'claude-teste';
  readonly requests: AiRequest[] = [];
  constructor(private readonly replies: (AiResponse | Error)[]) {}
  async complete(request: AiRequest) {
    this.requests.push(structuredClone(request));
    const next = this.replies.shift();
    if (!next) throw new Error('sem resposta simulada');
    if (next instanceof Error) throw next;
    return next;
  }
}
const usage = { inputTokens: 100, outputTokens: 50 };
const toolReply = (name: string, input: Record<string, unknown>): AiResponse => ({
  content: [{ type: 'tool_use', id: `toolu_${name}`, name, input }],
  stopReason: 'tool_use',
  usage,
});
const textReply = (text: string): AiResponse => ({
  content: [{ type: 'text', text }],
  stopReason: 'end_turn',
  usage,
});
const useProvider = (p: AiProvider | null) => Object.assign(t.app.get(AiService), { provider: p });

async function loja() {
  const dono = await signup(t.app);
  const admin = api(t.app, dono.auth);
  return { dono, admin };
}

describe('assistente de IA (F6-07)', () => {
  it('sem o provedor: "falta configurar"; desligado na conta: explica; ligar fica na auditoria', async () => {
    const { admin } = await loja();
    useProvider(null);
    const status = (await admin.get('/ai/status')).json();
    expect(status).toMatchObject({ configured: false, enabled: false });
    const r = await admin.post('/ai/ask', { question: 'Quanto vendi hoje?' });
    expect(r.statusCode).toBe(503);
    expect(r.json().message).toContain('Falta configurar');

    useProvider(new FakeProvider([]));
    const desligado = await admin.post('/ai/ask', { question: 'Quanto vendi hoje?' });
    expect(desligado.statusCode).toBe(409);
    expect(desligado.json().message).toContain('desligado');
    const ligado = (await admin.put('/ai/settings', { enabled: true })).json();
    expect(ligado).toMatchObject({ configured: true, enabled: true, model: 'claude-teste' });
    const audit = JSON.stringify((await admin.get('/audit?action=ai.enabled')).json());
    expect(audit).toContain('ai.enabled');
  });

  it('sugere NCM, CEST e cClassTrib conferidos na tabela oficial; só grava com aprovação', async () => {
    const { admin } = await loja();
    const perfil = (
      await admin.post('/fiscal-profiles', { name: 'Bebidas', csosn: '500', cClassTrib: '000001' })
    ).json();
    const cerveja = (
      await admin.post('/products', { name: 'Cerveja Pilsen lata 350 ml', priceCents: 499 })
    ).json();
    const fake = new FakeProvider([
      toolReply('sugerir_classificacao', {
        ncm: '2203.00.00',
        cest: '0302100',
        cClassTrib: '000001',
        justification: 'Cerveja de malte, posição 22.03; sujeita à ST de bebidas.',
        confidence: 'alta',
      }),
    ]);
    useProvider(fake);
    await admin.put('/ai/settings', { enabled: true });
    const r = await admin.post(`/ai/products/${cerveja.id}/fiscal-suggestions`);
    expect(r.statusCode).toBe(201);
    const sugestao = r.json();
    expect(sugestao).toMatchObject({
      status: 'pending',
      model: 'claude-teste',
      suggestion: {
        ncm: '22030000',
        cest: '0302100',
        cClassTrib: '000001',
        fiscalProfileId: perfil.id,
        confidence: 'alta',
        warnings: [],
      },
    });
    expect(sugestao.suggestion.ncmDescription).toContain('Cervejas de malte');
    // A IA recebeu o produto e candidatos da tabela oficial, sem dado de cliente.
    const pedido = JSON.stringify(fake.requests[0]);
    expect(pedido).toContain('Cerveja Pilsen lata 350 ml');
    expect(pedido).toContain('22030000');
    expect(fake.requests[0]!.forceTool).toBe('sugerir_classificacao');

    // Nada mudou no produto antes da aprovação.
    expect((await admin.get(`/products/${cerveja.id}`)).json().ncm).toBeNull();
    const aprovada = await admin.post(`/ai/fiscal-suggestions/${sugestao.id}/approve`);
    expect(aprovada.statusCode).toBe(201);
    expect(aprovada.json().status).toBe('approved');
    const produto = (await admin.get(`/products/${cerveja.id}`)).json();
    expect(produto).toMatchObject({ ncm: '22030000', cest: '0302100', fiscalProfileId: perfil.id });
    expect((await admin.post(`/ai/fiscal-suggestions/${sugestao.id}/approve`)).statusCode).toBe(
      409,
    );
    // Auditoria: quem aprovou, a sugestão original e o modelo.
    const audit = JSON.stringify((await admin.get('/audit?action=ai.fiscal_approved')).json());
    expect(audit).toContain('claude-teste');
    expect(audit).toContain('"before":{"ncm":null');
    const lista = (await admin.get(`/ai/products/${cerveja.id}/fiscal-suggestions`)).json();
    expect(lista).toHaveLength(1);
  });

  it('código inventado sai da sugestão com aviso; recusar não muda o produto', async () => {
    const { admin } = await loja();
    const item = (
      await admin.post('/products', { name: 'Coisa estranha', priceCents: 100 })
    ).json();
    useProvider(
      new FakeProvider([
        toolReply('sugerir_classificacao', {
          ncm: '99999999',
          cest: '0302100',
          cClassTrib: '999999',
          justification: 'Chute.',
          confidence: 'baixa',
        }),
        toolReply('sugerir_classificacao', { nada: true }),
        new Error('rede'),
      ]),
    );
    await admin.put('/ai/settings', { enabled: true });
    const s = (await admin.post(`/ai/products/${item.id}/fiscal-suggestions`)).json();
    expect(s.suggestion).toMatchObject({
      ncm: null,
      cest: null,
      cClassTrib: null,
      confidence: 'baixa',
    });
    expect(s.suggestion.warnings).toHaveLength(3);
    expect((await admin.post(`/ai/fiscal-suggestions/${s.id}/approve`)).statusCode).toBe(400);
    expect((await admin.post(`/ai/fiscal-suggestions/${s.id}/reject`)).json().status).toBe(
      'rejected',
    );
    expect((await admin.post(`/ai/fiscal-suggestions/${s.id}/reject`)).statusCode).toBe(409);
    // Resposta fora do formato e provedor fora do ar: mensagem clara, nada gravado.
    const invalida = await admin.post(`/ai/products/${item.id}/fiscal-suggestions`);
    expect(invalida.statusCode).toBe(502);
    const fora = await admin.post(`/ai/products/${item.id}/fiscal-suggestions`);
    expect(fora.statusCode).toBe(502);
    expect(fora.json().message).toContain('não respondeu');
    expect((await admin.get(`/products/${item.id}`)).json().ncm).toBeNull();
  });

  it('pergunta sobre o negócio vira consulta aos relatórios da conta, com o limite do dia', async () => {
    const { admin } = await loja();
    const fake = new FakeProvider([
      toolReply('vendas', { from: '2026-10-12', to: '2026-10-18', group: 'product' }),
      toolReply('vendas', { from: 'ontem', to: 'hoje', group: 'product' }),
      textReply('Nesta semana você ainda não vendeu nada.'),
    ]);
    useProvider(fake);
    await admin.put('/ai/settings', { enabled: true });
    const r = await admin.post('/ai/ask', { question: 'Quanto vendi esta semana?' });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toEqual({
      answer: 'Nesta semana você ainda não vendeu nada.',
      tools: ['vendas', 'vendas'],
      proposals: [],
      model: 'claude-teste',
    });
    // A segunda chamada recebeu o resultado do relatório; a terceira, o erro do parâmetro ruim.
    const resultado = fake.requests[1]!.messages.at(-1)!.content[0]!;
    expect(resultado).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_vendas' });
    expect(JSON.parse((resultado as { content: string }).content)).toMatchObject({ rows: [] });
    expect(fake.requests[2]!.messages.at(-1)!.content[0]).toMatchObject({ is_error: true });
    expect(fake.requests[0]!.system).toContain('centavos');

    // Limite do dia: as três chamadas acima contam.
    const config = t.app.get<Config>(CONFIG);
    const limite = config.AI_DAILY_LIMIT;
    Object.assign(config, { AI_DAILY_LIMIT: 3 });
    try {
      const status = (await admin.get('/ai/status')).json();
      expect(status.usedToday).toBe(3);
      const r2 = await admin.post('/ai/ask', { question: 'E ontem?' });
      expect(r2.statusCode).toBe(429);
    } finally {
      Object.assign(config, { AI_DAILY_LIMIT: limite });
    }
  });

  it('operador de caixa não pergunta sobre as finanças nem liga o assistente', async () => {
    const { admin } = await loja();
    const roles = (await admin.get('/roles')).json() as { id: string; systemKey: string | null }[];
    const email = `caixa-ia-${Date.now()}@exemplo.com.br`;
    await admin.post('/members', {
      name: 'Caixa',
      email,
      password: 'senha-forte-123',
      roleId: roles.find((r) => r.systemKey === 'cashier')!.id,
    });
    const login = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password: 'senha-forte-123' },
    });
    const operador = api(t.app, { authorization: `Bearer ${login.json().accessToken}` });
    expect((await operador.post('/ai/ask', { question: 'Quanto lucrei?' })).statusCode).toBe(403);
    expect((await operador.put('/ai/settings', { enabled: true })).statusCode).toBe(403);
  });
});

describe('cliente dos modelos Claude (F6-07)', () => {
  it('a IA só propõe o novo preço: o cadastro só muda quando uma pessoa confirma, com auditoria', async () => {
    const { admin } = await loja();
    const item = (
      await admin.post('/products', { name: 'Suco de uva 1 L', priceCents: 1000 })
    ).json();
    useProvider(
      new FakeProvider([
        toolReply('buscar_produto', { query: 'suco' }),
        toolReply('propor_preco', {
          productId: item.id,
          newPriceCents: 1190,
          reason: 'Custo subiu.',
        }),
        textReply('Propus R$ 11,90. Confirme na tela.'),
      ]),
    );
    await admin.put('/ai/settings', { enabled: true });
    const r = (await admin.post('/ai/ask', { question: 'Sugira reajuste do suco de uva' })).json();
    expect(r.tools).toEqual(['buscar_produto', 'propor_preco']);
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0]).toMatchObject({ status: 'pending', productName: 'Suco de uva 1 L' });
    // Nada mudou no cadastro.
    expect((await admin.get(`/products/${item.id}`)).json().priceCents).toBe(1000);
    const pendentes = (await admin.get('/ai/actions')).json();
    expect(pendentes).toHaveLength(1);

    const id = r.proposals[0].id;
    expect((await admin.post(`/ai/actions/${id}/approve`)).json().status).toBe('approved');
    expect((await admin.get(`/products/${item.id}`)).json().priceCents).toBe(1190);
    expect((await admin.post(`/ai/actions/${id}/approve`)).statusCode).toBe(409);
    expect((await admin.get('/ai/actions')).json()).toHaveLength(0);
    const audit = JSON.stringify((await admin.get('/audit?limit=50')).json());
    expect(audit).toContain('ai.action_proposed');
    expect(audit).toContain('ai.action_approved');
  });

  it('proposta recusada não muda nada; preço que mudou antes da confirmação barra', async () => {
    const { admin } = await loja();
    const item = (await admin.post('/products', { name: 'Água 500 ml', priceCents: 300 })).json();
    const propor = (cents: number) =>
      new FakeProvider([
        toolReply('propor_preco', { productId: item.id, newPriceCents: cents, reason: 'Teste.' }),
        textReply('Feito.'),
      ]);
    await admin.put('/ai/settings', { enabled: true });
    useProvider(propor(350));
    const a = (await admin.post('/ai/ask', { question: 'Reajuste a água' })).json().proposals[0];
    expect((await admin.post(`/ai/actions/${a.id}/reject`)).json().status).toBe('rejected');
    expect((await admin.get(`/products/${item.id}`)).json().priceCents).toBe(300);

    useProvider(propor(400));
    const b = (await admin.post('/ai/ask', { question: 'Reajuste a água de novo' })).json()
      .proposals[0];
    const produto = (await admin.get(`/products/${item.id}`)).json();
    await admin.put(`/products/${item.id}`, { ...produto, priceCents: 320 });
    const stale = await admin.post(`/ai/actions/${b.id}/approve`);
    expect(stale.statusCode).toBe(409);
    expect(stale.json().message).toContain('mudou');
    // Preço igual ao atual não vira proposta.
    useProvider(propor(320));
    const c = (await admin.post('/ai/ask', { question: 'Reajuste a água outra vez' })).json();
    expect(c.proposals).toEqual([]);
  });

  it('monta o pedido da API de mensagens e traduz a resposta; erro vira AiProviderError', async () => {
    const { ClaudeProvider, AiProviderError } = await import('../src/modules/ai/ai.provider');
    const calls: { url: string; init: RequestInit }[] = [];
    const ok = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({
          content: [
            { type: 'thinking', thinking: 'x' },
            { type: 'text', text: 'Oi' },
          ],
          stop_reason: 'end_turn',
          usage: { input_tokens: 12, output_tokens: 3 },
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const claude = new ClaudeProvider('chave-teste', 'claude-sonnet-5-5', 'https://ia.exemplo', ok);
    const r = await claude.complete({
      system: 'sistema',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Olá' }] }],
      tools: [{ name: 'f', description: 'd', input_schema: { type: 'object' } }],
      forceTool: 'f',
      maxTokens: 100,
    });
    expect(r).toEqual({
      content: [{ type: 'text', text: 'Oi' }],
      stopReason: 'end_turn',
      usage: { inputTokens: 12, outputTokens: 3 },
    });
    expect(calls[0]!.url).toBe('https://ia.exemplo/v1/messages');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('chave-teste');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(JSON.parse(calls[0]!.init.body as string)).toMatchObject({
      model: 'claude-sonnet-5-5',
      max_tokens: 100,
      system: 'sistema',
      tool_choice: { type: 'tool', name: 'f' },
    });

    const fail = (async () => new Response('{}', { status: 429 })) as unknown as typeof fetch;
    const busy = new ClaudeProvider('k', 'm', 'https://ia.exemplo', fail);
    const error = await busy
      .complete({ system: '', messages: [], maxTokens: 1 })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiProviderError);
    expect((error as InstanceType<typeof AiProviderError>).status).toBe(429);
  });
});
