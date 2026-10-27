import {
  Body,
  Controller,
  Get,
  Inject,
  Injectable,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import {
  cents,
  formatBRL,
  hasPermission,
  uuidv7,
  type AiActionView,
  type AiAnswer,
  type AiFiscalSuggestion,
  type AiStatus,
  type AiSuggestionView,
} from '@bipae/domain';
import { cestsForNcm, findCest, findClassTrib } from '@bipae/fiscal/tables';
import { findNcm, isNcmValidOn, ncmPath, searchNcm } from '@bipae/fiscal/tables/ncm';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { CONFIG, DB } from '../../common/di';
import { AppError, notFound, parse } from '../../common/errors';
import type { Config } from '../../config';
import { withTenant, type Db, type Tx } from '../../db/client';
import { aiActions, aiRequests, aiSettings, aiSuggestions, fiscalProfiles } from '../../db/schema';
import { AuditService } from '../audit/audit.service';
import { CatalogService } from '../catalog/catalog.service';
import { productInput } from '@bipae/domain';
import { FinanceService, todayBr } from '../finance/finance.service';
import { LossesService } from '../reports/losses.service';
import { ReportsService } from '../reports/reports.service';
import {
  AiProviderError,
  type AiContent,
  type AiMessage,
  type AiProvider,
  type AiTool,
} from './ai.provider';

export const AI_PROVIDER = Symbol('AI_PROVIDER');

const CONFIDENCE = ['alta', 'media', 'baixa'] as const;
const MAX_TOOL_ROUNDS = 5;

const askInput = z.object({
  question: z
    .string()
    .trim()
    .min(3, 'Escreva a pergunta.')
    .max(500, 'A pergunta vai até 500 caracteres.'),
  /** Conversa anterior, só texto, para perguntas de continuação. */
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(4000) }))
    .max(10)
    .default([]),
});

const settingsInput = z.object({ enabled: z.boolean() });

const FISCAL_TOOL: AiTool = {
  name: 'sugerir_classificacao',
  description: 'Devolve a classificação fiscal sugerida para o produto.',
  input_schema: {
    type: 'object',
    properties: {
      ncm: { type: 'string', description: 'NCM com 8 dígitos, só números.' },
      cest: { type: 'string', description: 'CEST com 7 dígitos, se o produto tiver; senão vazio.' },
      cClassTrib: {
        type: 'string',
        description: 'cClassTrib do IBS/CBS com 6 dígitos (000001 para tributação integral).',
      },
      justification: {
        type: 'string',
        description: 'Por que esta classificação, em português, em até 3 frases.',
      },
      confidence: { type: 'string', enum: [...CONFIDENCE] },
    },
    required: ['ncm', 'justification', 'confidence'],
  },
};

const fiscalAnswer = z.object({
  ncm: z.string(),
  cest: z.string().optional(),
  cClassTrib: z.string().optional(),
  justification: z.string().max(1000),
  confidence: z.enum(CONFIDENCE),
});

/** Ferramentas de relatório (ADR-0011): tipadas, com o escopo da conta e sem dado de cliente. */
const period = {
  from: { type: 'string', description: 'Primeiro dia, AAAA-MM-DD.' },
  to: { type: 'string', description: 'Último dia, AAAA-MM-DD.' },
};
const REPORT_TOOLS: AiTool[] = [
  {
    name: 'vendas',
    description:
      'Vendas concluídas no período, agrupadas por produto, forma de pagamento, dia, loja ou operador: receita, custo, margem, quantidade, número de vendas e ticket médio (valores em centavos).',
    input_schema: {
      type: 'object',
      properties: {
        ...period,
        group: { type: 'string', enum: ['product', 'payment', 'day', 'store', 'operator'] },
      },
      required: ['from', 'to', 'group'],
    },
  },
  {
    name: 'resultado_mensal',
    description:
      'DRE gerencial por mês: receita, impostos estimados, custo das mercadorias, despesas e lucro (centavos).',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Primeiro mês, AAAA-MM.' },
        to: { type: 'string', description: 'Último mês, AAAA-MM.' },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'contas',
    description:
      'Resumo das contas a pagar e a receber: vencidas, de hoje e dos próximos 7 dias (centavos).',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'perdas',
    description:
      'Perdas no período: cancelamentos, devoluções, sangrias, diferenças de caixa e perdas de estoque (centavos).',
    input_schema: { type: 'object', properties: period, required: ['from', 'to'] },
  },
];

/**
 * Ferramentas de proposta (ADR-0011): só PROPÕEM. A proposta fica pendente na conta e uma pessoa
 * com permissão confirma ou recusa na tela; o assistente nunca grava no cadastro.
 */
const PROPOSAL_TOOLS: AiTool[] = [
  {
    name: 'buscar_produto',
    description:
      'Procura produtos pelo nome, SKU ou código de barras e devolve id, nome e preço atual (centavos). Use antes de propor um preço.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Parte do nome, SKU ou código.' } },
      required: ['query'],
    },
  },
  {
    name: 'propor_preco',
    description:
      'Propõe um novo preço de venda para um produto. Não altera nada: registra a proposta para uma pessoa confirmar.',
    input_schema: {
      type: 'object',
      properties: {
        productId: { type: 'string', description: 'Id do produto, vindo de buscar_produto.' },
        newPriceCents: { type: 'integer', description: 'Novo preço em centavos.' },
        reason: { type: 'string', description: 'Por que, em português, em até 2 frases.' },
      },
      required: ['productId', 'newPriceCents', 'reason'],
    },
  },
];

const proposeInput = z.object({
  productId: z.string().uuid(),
  newPriceCents: z.number().int().positive().max(100_000_000_00),
  reason: z.string().trim().min(1).max(500),
});

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoMonth = z.string().regex(/^\d{4}-\d{2}$/);

/**
 * Assistente de IA (F6-07, ADR-0011). Opcional por conta e desligado não muda nada. Sugestão
 * fiscal só sugere: nada grava sem a aprovação de uma pessoa, que fica na auditoria com a
 * sugestão original e o modelo. Perguntas sobre o negócio viram chamadas às ferramentas de
 * relatório acima, nunca SQL livre. Dados pessoais de clientes não vão ao provedor.
 */
@Injectable()
export class AiService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(AI_PROVIDER) private readonly provider: AiProvider | null,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(ReportsService) private readonly reports: ReportsService,
    @Inject(FinanceService) private readonly finance: FinanceService,
    @Inject(LossesService) private readonly losses: LossesService,
  ) {}

  private async usedToday(tx: Tx) {
    const since = new Date(`${todayBr()}T00:00:00-03:00`);
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(aiRequests)
      .where(gte(aiRequests.createdAt, since));
    return Number(row?.n ?? 0);
  }

  async status(ctx: RequestContext): Promise<AiStatus> {
    return withTenant(this.db, ctx, async (tx) => {
      const [settings] = await tx.select().from(aiSettings);
      return {
        configured: this.provider !== null,
        enabled: settings?.enabled ?? false,
        model: this.provider?.model ?? null,
        usedToday: await this.usedToday(tx),
        dailyLimit: this.config.AI_DAILY_LIMIT,
      };
    });
  }

  async setEnabled(ctx: RequestContext, body: unknown) {
    const { enabled } = parse(settingsInput, body);
    await withTenant(this.db, ctx, async (tx) => {
      await tx
        .insert(aiSettings)
        .values({ tenantId: ctx.tenantId, enabled, updatedBy: ctx.userId })
        .onConflictDoUpdate({
          target: aiSettings.tenantId,
          set: { enabled, updatedBy: ctx.userId, updatedAt: new Date() },
        });
      await this.audit.record(tx, ctx, {
        action: enabled ? 'ai.enabled' : 'ai.disabled',
        entity: 'ai_settings',
      });
    });
    return this.status(ctx);
  }

  /** Confere se a conta pode usar agora: provedor configurado, assistente ligado e limite do dia. */
  private async guard(ctx: RequestContext): Promise<AiProvider> {
    const provider = this.provider;
    if (!provider) {
      throw new AppError(
        503,
        'ai_not_configured',
        'O assistente de IA ainda não está ligado no Bipaê. Falta configurar o provedor.',
      );
    }
    await withTenant(this.db, ctx, async (tx) => {
      const [settings] = await tx.select().from(aiSettings);
      if (!settings?.enabled) {
        throw new AppError(
          409,
          'ai_disabled',
          'O assistente está desligado nesta conta. Ligue em Assistente para usar.',
        );
      }
      if ((await this.usedToday(tx)) >= this.config.AI_DAILY_LIMIT) {
        throw new AppError(
          429,
          'ai_daily_limit',
          'O limite de uso do assistente hoje acabou. Amanhã tem mais.',
        );
      }
    });
    return provider;
  }

  private async call(
    ctx: RequestContext,
    kind: 'fiscal' | 'question',
    provider: AiProvider,
    request: Parameters<AiProvider['complete']>[0],
  ) {
    let response;
    try {
      response = await provider.complete(request);
    } catch (e) {
      const status = e instanceof AiProviderError ? e.status : 0;
      throw new AppError(
        502,
        'ai_unavailable',
        status === 429
          ? 'O assistente está ocupado agora. Tente de novo em instantes.'
          : 'O assistente não respondeu. Tente de novo em instantes.',
      );
    }
    // Medição do uso (custo por plano, ADR-0011).
    await withTenant(this.db, ctx, (tx) =>
      tx.insert(aiRequests).values({
        id: uuidv7(),
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        kind,
        model: provider.model,
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
      }),
    );
    return response;
  }

  // ---------------------------------------------------------------- sugestão fiscal

  async suggestFiscal(ctx: RequestContext, productId: string): Promise<AiSuggestionView> {
    const provider = await this.guard(ctx);
    const product = await this.catalog.getProduct(ctx, productId);
    const date = todayBr();
    // Candidatos da tabela oficial pelas palavras do nome: a IA escolhe com base neles.
    const words = product.name
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !/\d/.test(w))
      .slice(0, 4);
    const candidates = new Map<string, string>();
    for (const query of [words.join(' '), ...words]) {
      for (const n of searchNcm(query, 8)) {
        if (candidates.size < 25 && isNcmValidOn(n, date)) {
          candidates.set(
            n.code,
            ncmPath(n.code)
              .map((p) => p.description)
              .join(' > '),
          );
        }
      }
    }
    const catalog = product.catalog ?? {};
    const description = [
      `Produto: ${product.name}`,
      `Unidade: ${product.unit}`,
      product.barcodes.length ? `Código de barras: ${product.barcodes.join(', ')}` : '',
      Object.entries(catalog)
        .filter(([, v]) => typeof v === 'string' && v)
        .map(([k, v]) => `${k}: ${String(v)}`)
        .join('\n'),
      product.ncm ? `NCM atual no cadastro: ${product.ncm}` : 'Sem NCM no cadastro.',
      candidates.size
        ? `NCMs da tabela oficial que parecem próximos:\n${[...candidates].map(([c, d]) => `${c}: ${d}`).join('\n')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');
    const response = await this.call(ctx, 'fiscal', provider, {
      system:
        'Você ajuda lojistas brasileiros a classificar produtos para a nota fiscal. Sugira o NCM (tabela vigente do Siscomex), o CEST quando o produto estiver sujeito à substituição tributária (Convênio ICMS 142/2018) e o cClassTrib do IBS/CBS (LC 214/2025). Se não tiver certeza, diga confiança baixa. Responda sempre com a ferramenta sugerir_classificacao, em português do Brasil.',
      messages: [{ role: 'user', content: [{ type: 'text', text: description }] }],
      tools: [FISCAL_TOOL],
      forceTool: FISCAL_TOOL.name,
      maxTokens: 800,
    });
    const use = response.content.find((c) => c.type === 'tool_use');
    const parsed = use ? fiscalAnswer.safeParse(use.input) : null;
    if (!parsed?.success) {
      throw new AppError(
        502,
        'ai_invalid',
        'O assistente não trouxe uma sugestão que dê para usar. Tente de novo.',
      );
    }
    const suggestion = await this.checkSuggestion(ctx, parsed.data, date);
    const id = uuidv7();
    await withTenant(this.db, ctx, async (tx) => {
      await tx.insert(aiSuggestions).values({
        id,
        tenantId: ctx.tenantId,
        productId,
        suggestion,
        model: provider.model,
        createdBy: ctx.userId,
      });
      await this.audit.record(tx, ctx, {
        action: 'ai.fiscal_suggested',
        entity: 'product',
        entityId: productId,
        data: { suggestionId: id, model: provider.model, ncm: suggestion.ncm },
      });
    });
    return this.suggestionView(ctx, id);
  }

  /**
   * Confere a resposta contra as tabelas oficiais: código que não existe ou não vale hoje sai da
   * sugestão, com o aviso. A IA nunca inventa código que chegue ao cadastro.
   */
  private async checkSuggestion(
    ctx: RequestContext,
    raw: z.output<typeof fiscalAnswer>,
    date: string,
  ): Promise<AiFiscalSuggestion> {
    const warnings: string[] = [];
    const digits = (v: string | undefined) => (v ?? '').replace(/\D/g, '');
    const ncmCode = digits(raw.ncm);
    const ncm = findNcm(ncmCode);
    const ncmOk = ncm !== null && isNcmValidOn(ncm, date);
    if (!ncmOk)
      warnings.push(
        `O NCM ${raw.ncm} não existe ou não vale hoje na tabela oficial; ficou de fora.`,
      );
    let cest: string | null = null;
    const cestCode = digits(raw.cest);
    if (cestCode) {
      const allowed = ncmOk ? cestsForNcm(ncmCode, date).map((c) => c.cest) : [];
      if (findCest(cestCode, date) && allowed.includes(cestCode)) cest = cestCode;
      else
        warnings.push(`O CEST ${raw.cest} não combina com o NCM na tabela oficial; ficou de fora.`);
    }
    let cClassTrib: string | null = null;
    let fiscalProfileId: string | null = null;
    const classCode = digits(raw.cClassTrib);
    if (classCode) {
      if (findClassTrib(classCode)) {
        cClassTrib = classCode;
        const profiles = await withTenant(this.db, ctx, (tx) => tx.select().from(fiscalProfiles));
        fiscalProfileId =
          profiles.find((p) => (p.data as { cClassTrib?: string | null }).cClassTrib === classCode)
            ?.id ?? null;
        if (!fiscalProfileId) {
          warnings.push(
            `Nenhum perfil fiscal da conta usa o cClassTrib ${classCode}. Crie um em Perfis fiscais para aplicar.`,
          );
        }
      } else {
        warnings.push(
          `O cClassTrib ${raw.cClassTrib} não existe na tabela oficial; ficou de fora.`,
        );
      }
    }
    return {
      ncm: ncmOk ? ncmCode : null,
      ncmDescription: ncmOk
        ? ncmPath(ncmCode)
            .map((p) => p.description)
            .join(' > ')
        : null,
      cest,
      cClassTrib,
      fiscalProfileId,
      justification: raw.justification,
      confidence: raw.confidence,
      warnings,
    };
  }

  private async suggestionView(ctx: RequestContext, id: string): Promise<AiSuggestionView> {
    return withTenant(this.db, ctx, async (tx) => {
      const [row] = await tx.select().from(aiSuggestions).where(eq(aiSuggestions.id, id));
      if (!row) throw notFound('Sugestão');
      return {
        id: row.id,
        productId: row.productId,
        status: row.status,
        suggestion: row.suggestion,
        model: row.model,
        createdAt: row.createdAt.toISOString(),
        decidedAt: row.decidedAt?.toISOString() ?? null,
      };
    });
  }

  async listSuggestions(ctx: RequestContext, productId: string): Promise<AiSuggestionView[]> {
    const ids = await withTenant(this.db, ctx, (tx) =>
      tx
        .select({ id: aiSuggestions.id })
        .from(aiSuggestions)
        .where(eq(aiSuggestions.productId, productId))
        .orderBy(desc(aiSuggestions.createdAt))
        .limit(10),
    );
    return Promise.all(ids.map((r) => this.suggestionView(ctx, r.id)));
  }

  /** Aprovar grava no produto pela atualização normal do cadastro e registra quem aprovou. */
  async approve(ctx: RequestContext, id: string): Promise<AiSuggestionView> {
    const current = await this.suggestionView(ctx, id);
    if (current.status !== 'pending') {
      throw new AppError(409, 'ai_decided', 'Esta sugestão já foi aprovada ou recusada.');
    }
    const s = current.suggestion;
    if (!s.ncm && !s.cest && !s.fiscalProfileId) {
      throw new AppError(400, 'ai_empty', 'Esta sugestão não tem nada que dê para aplicar.');
    }
    const product = await this.catalog.getProduct(ctx, current.productId);
    const before = {
      ncm: product.ncm,
      cest: product.cest,
      fiscalProfileId: product.fiscalProfileId,
    };
    const after = {
      ncm: s.ncm ?? product.ncm,
      cest: s.ncm ? s.cest : product.cest,
      fiscalProfileId: s.fiscalProfileId ?? product.fiscalProfileId,
    };
    await this.catalog.updateProduct(
      ctx,
      product.id,
      parse(productInput, { ...product, ...after }),
    );
    await withTenant(this.db, ctx, async (tx) => {
      const [done] = await tx
        .update(aiSuggestions)
        .set({ status: 'approved', decidedBy: ctx.userId, decidedAt: new Date() })
        .where(and(eq(aiSuggestions.id, id), eq(aiSuggestions.status, 'pending')))
        .returning({ id: aiSuggestions.id });
      if (!done)
        throw new AppError(409, 'ai_decided', 'Esta sugestão já foi aprovada ou recusada.');
      await this.audit.record(tx, ctx, {
        action: 'ai.fiscal_approved',
        entity: 'product',
        entityId: product.id,
        data: { suggestionId: id, model: current.model, suggestion: s, before, after },
      });
    });
    return this.suggestionView(ctx, id);
  }

  async reject(ctx: RequestContext, id: string): Promise<AiSuggestionView> {
    await withTenant(this.db, ctx, async (tx) => {
      const [done] = await tx
        .update(aiSuggestions)
        .set({ status: 'rejected', decidedBy: ctx.userId, decidedAt: new Date() })
        .where(and(eq(aiSuggestions.id, id), eq(aiSuggestions.status, 'pending')))
        .returning({ productId: aiSuggestions.productId, model: aiSuggestions.model });
      if (!done)
        throw new AppError(409, 'ai_decided', 'Esta sugestão já foi aprovada ou recusada.');
      await this.audit.record(tx, ctx, {
        action: 'ai.fiscal_rejected',
        entity: 'product',
        entityId: done.productId,
        data: { suggestionId: id, model: done.model },
      });
    });
    return this.suggestionView(ctx, id);
  }

  // ---------------------------------------------------------------- perguntas sobre o negócio

  // ---------------------------------------------------------------- ações propostas

  private async propose(
    ctx: RequestContext,
    model: string,
    input: Record<string, unknown>,
  ): Promise<AiActionView> {
    const data = proposeInput.parse(input);
    const product = await this.catalog.getProduct(ctx, data.productId);
    if (product.priceCents === data.newPriceCents) {
      throw new AppError(400, 'ai_same_price', 'O preço proposto é igual ao atual.');
    }
    const id = uuidv7();
    const payload = {
      currentCents: product.priceCents,
      newCents: data.newPriceCents,
      reason: data.reason,
    };
    const summary = `Preço de ${product.name}: de ${formatBRL(cents(product.priceCents))} para ${formatBRL(cents(data.newPriceCents))}.`;
    await withTenant(this.db, ctx, async (tx) => {
      await tx.insert(aiActions).values({
        id,
        tenantId: ctx.tenantId,
        kind: 'price_change',
        productId: product.id,
        summary,
        payload,
        model,
        createdBy: ctx.userId,
      });
      await this.audit.record(tx, ctx, {
        action: 'ai.action_proposed',
        entity: 'product',
        entityId: product.id,
        data: { actionId: id, kind: 'price_change', model, ...payload },
      });
    });
    return this.actionView(ctx, id);
  }

  private async actionView(ctx: RequestContext, id: string): Promise<AiActionView> {
    return withTenant(this.db, ctx, async (tx) => {
      const [row] = await tx
        .select({
          a: aiActions,
          productName: sql<string>`(select name from products p where p.id = ${aiActions.productId})`,
        })
        .from(aiActions)
        .where(eq(aiActions.id, id));
      if (!row) throw notFound('Proposta');
      return {
        id: row.a.id,
        kind: row.a.kind,
        status: row.a.status,
        productId: row.a.productId,
        productName: row.productName,
        summary: row.a.summary,
        payload: row.a.payload,
        model: row.a.model,
        createdAt: row.a.createdAt.toISOString(),
        decidedAt: row.a.decidedAt?.toISOString() ?? null,
      };
    });
  }

  async listActions(ctx: RequestContext): Promise<AiActionView[]> {
    const ids = await withTenant(this.db, ctx, (tx) =>
      tx
        .select({ id: aiActions.id })
        .from(aiActions)
        .where(eq(aiActions.status, 'pending'))
        .orderBy(desc(aiActions.createdAt))
        .limit(20),
    );
    return Promise.all(ids.map((r) => this.actionView(ctx, r.id)));
  }

  /** Confirmar aplica pela atualização normal do cadastro (que confere a permissão de preço). */
  async approveAction(ctx: RequestContext, id: string): Promise<AiActionView> {
    const current = await this.actionView(ctx, id);
    if (current.status !== 'pending') {
      throw new AppError(409, 'ai_decided', 'Esta proposta já foi confirmada ou recusada.');
    }
    const product = await this.catalog.getProduct(ctx, current.productId);
    if (product.priceCents !== current.payload.currentCents) {
      throw new AppError(
        409,
        'ai_stale',
        'O preço do produto mudou depois da proposta. Recuse e peça de novo.',
      );
    }
    await this.catalog.updateProduct(
      ctx,
      product.id,
      parse(productInput, { ...product, priceCents: current.payload.newCents }),
    );
    await withTenant(this.db, ctx, async (tx) => {
      const [done] = await tx
        .update(aiActions)
        .set({ status: 'approved', decidedBy: ctx.userId, decidedAt: new Date() })
        .where(and(eq(aiActions.id, id), eq(aiActions.status, 'pending')))
        .returning({ id: aiActions.id });
      if (!done)
        throw new AppError(409, 'ai_decided', 'Esta proposta já foi confirmada ou recusada.');
      await this.audit.record(tx, ctx, {
        action: 'ai.action_approved',
        entity: 'product',
        entityId: product.id,
        data: { actionId: id, model: current.model, ...current.payload },
      });
    });
    return this.actionView(ctx, id);
  }

  async rejectAction(ctx: RequestContext, id: string): Promise<AiActionView> {
    await withTenant(this.db, ctx, async (tx) => {
      const [done] = await tx
        .update(aiActions)
        .set({ status: 'rejected', decidedBy: ctx.userId, decidedAt: new Date() })
        .where(and(eq(aiActions.id, id), eq(aiActions.status, 'pending')))
        .returning({ productId: aiActions.productId, model: aiActions.model });
      if (!done)
        throw new AppError(409, 'ai_decided', 'Esta proposta já foi confirmada ou recusada.');
      await this.audit.record(tx, ctx, {
        action: 'ai.action_rejected',
        entity: 'product',
        entityId: done.productId,
        data: { actionId: id, model: done.model },
      });
    });
    return this.actionView(ctx, id);
  }

  private async runTool(
    ctx: RequestContext,
    name: string,
    input: Record<string, unknown>,
    model: string,
    proposals: AiActionView[],
  ): Promise<unknown> {
    const day = (v: unknown) => isoDay.parse(v);
    const canPropose = hasPermission(ctx.permissions, 'catalog.price.write');
    switch (name) {
      case 'buscar_produto': {
        if (!canPropose) throw new Error('sem permissão');
        const page = await this.catalog.listProducts(ctx, {
          q: z.string().min(1).max(100).parse(input.query),
          limit: 8,
          offset: 0,
        });
        return page.items.map((p) => ({ id: p.id, name: p.name, priceCents: p.priceCents }));
      }
      case 'propor_preco': {
        if (!canPropose) throw new Error('sem permissão');
        const view = await this.propose(ctx, model, input);
        proposals.push(view);
        return { ok: true, message: 'Proposta registrada. Uma pessoa precisa confirmar na tela.' };
      }
      case 'vendas': {
        const group = z.enum(['product', 'payment', 'day', 'store', 'operator']).parse(input.group);
        const report = await this.reports.sales(ctx, {
          from: day(input.from),
          to: day(input.to),
          group,
        });
        return { ...report, rows: report.rows.slice(0, 30), totalRows: report.rows.length };
      }
      case 'resultado_mensal':
        return this.finance.dre(ctx, isoMonth.parse(input.from), isoMonth.parse(input.to));
      case 'contas':
        return this.finance.summary(ctx);
      case 'perdas': {
        const dashboard = await this.losses.dashboard(ctx, {
          from: day(input.from),
          to: day(input.to),
        });
        return dashboard;
      }
      default:
        throw new Error(`Ferramenta desconhecida: ${name}`);
    }
  }

  async ask(ctx: RequestContext, body: unknown): Promise<AiAnswer> {
    const input = parse(askInput, body);
    if (!hasPermission(ctx.permissions, 'finance.read')) {
      throw new AppError(
        403,
        'forbidden',
        'Você não tem permissão para ver os relatórios da conta.',
      );
    }
    const provider = await this.guard(ctx);
    const today = todayBr();
    const messages: AiMessage[] = [
      ...input.history.map((h) => ({
        role: h.role,
        content: [{ type: 'text' as const, text: h.text }],
      })),
      { role: 'user', content: [{ type: 'text', text: input.question }] },
    ];
    const used: string[] = [];
    const proposals: AiActionView[] = [];
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const response = await this.call(ctx, 'question', provider, {
        system: `Você é o assistente do Bipaê, sistema de caixa e gestão de uma loja brasileira. Hoje é ${today} (horário de Brasília). Responda em português do Brasil, curto e direto, com valores em reais (R$ 1.234,56) e datas dd/mm/aaaa. Os valores das ferramentas vêm em centavos. Use só os números das ferramentas; se elas não respondem a pergunta, diga o que dá para responder. Não invente números. Você nunca altera o cadastro: para mudar um preço, use propor_preco e avise que a pessoa precisa confirmar na tela.`,
        messages,
        tools: hasPermission(ctx.permissions, 'catalog.price.write')
          ? [...REPORT_TOOLS, ...PROPOSAL_TOOLS]
          : REPORT_TOOLS,
        maxTokens: 1000,
      });
      const calls = response.content.filter(
        (c): c is Extract<AiContent, { type: 'tool_use' }> => c.type === 'tool_use',
      );
      if (calls.length === 0 || round === MAX_TOOL_ROUNDS) {
        const text = response.content
          .filter((c): c is Extract<AiContent, { type: 'text' }> => c.type === 'text')
          .map((c) => c.text)
          .join('\n')
          .trim();
        return {
          answer:
            text ||
            'Não consegui responder com os relatórios da conta. Tente perguntar de outro jeito.',
          tools: used,
          model: provider.model,
          proposals,
        };
      }
      messages.push({ role: 'assistant', content: response.content });
      const results: AiContent[] = [];
      for (const call of calls) {
        used.push(call.name);
        try {
          const result = await this.runTool(ctx, call.name, call.input, provider.model, proposals);
          results.push({
            type: 'tool_result',
            tool_use_id: call.id,
            content: JSON.stringify(result),
          });
        } catch {
          results.push({
            type: 'tool_result',
            tool_use_id: call.id,
            content: 'Não deu para consultar com esses parâmetros.',
            is_error: true,
          });
        }
      }
      messages.push({ role: 'user', content: results });
    }
    /* c8 ignore next */
    throw new AppError(
      502,
      'ai_unavailable',
      'O assistente não respondeu. Tente de novo em instantes.',
    );
  }
}

@Controller('ai')
export class AiController {
  constructor(@Inject(AiService) private readonly ai: AiService) {}

  @Get('status')
  @RequirePermission('catalog.read')
  status(@Ctx() ctx: RequestContext) {
    return this.ai.status(ctx);
  }

  @Put('settings')
  @RequirePermission('admin.integrations')
  settings(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.ai.setEnabled(ctx, body);
  }

  @Post('products/:id/fiscal-suggestions')
  @RequirePermission('catalog.write')
  suggest(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.ai.suggestFiscal(ctx, id);
  }

  @Get('products/:id/fiscal-suggestions')
  @RequirePermission('catalog.read')
  suggestions(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.ai.listSuggestions(ctx, id);
  }

  @Post('fiscal-suggestions/:id/approve')
  @RequirePermission('catalog.write')
  approve(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.ai.approve(ctx, id);
  }

  @Post('fiscal-suggestions/:id/reject')
  @RequirePermission('catalog.write')
  reject(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.ai.reject(ctx, id);
  }

  @Get('actions')
  @RequirePermission('catalog.read')
  actions(@Ctx() ctx: RequestContext) {
    return this.ai.listActions(ctx);
  }

  @Post('actions/:id/approve')
  @RequirePermission('catalog.price.write')
  approveAction(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.ai.approveAction(ctx, id);
  }

  @Post('actions/:id/reject')
  @RequirePermission('catalog.price.write')
  rejectAction(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.ai.rejectAction(ctx, id);
  }

  @Post('ask')
  @RequirePermission('finance.read')
  ask(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.ai.ask(ctx, body);
  }
}
