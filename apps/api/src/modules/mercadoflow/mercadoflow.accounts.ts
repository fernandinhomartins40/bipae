import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { accountAccess, uuidv7, type MercadoflowLinkView } from '@bipae/domain';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Config } from '../../config';
import type { RequestContext } from '../../common/auth';
import { CONFIG, DB, QUEUE } from '../../common/di';
import { AppError, notFound } from '../../common/errors';
import type { JobQueue } from '../../common/queue';
import { asPlatform, withTenant, type Db, type Tx } from '../../db/client';
import {
  companies,
  mercadoflowLinks,
  mercadoflowOutbox,
  stores,
  tenants,
  users,
} from '../../db/schema';
import { AuditService } from '../audit/audit.service';
import {
  MERCADOFLOW_CLIENT,
  MercadoflowError,
  MercadoflowUnavailableError,
  type MercadoflowClient,
} from './mercadoflow.client';
import { MercadoflowMarketSync } from './mercadoflow.market-sync';
import { MercadoflowWebhooks } from './mercadoflow.webhook';

/** Permissões que o Bipaê pede ao criar ou vincular a conta (seção 5.2 do contrato). */
export const MERCADOFLOW_SCOPES = [
  'sales:write',
  'catalog:read',
  'insights:read',
  'promotions:read',
  'confere:use',
  'catalog:write',
  'prices:write',
  'costs:write',
  'stock:write',
  'orders:read',
  'prices:read',
  'inbound:read',
];

const DAILY_JOB = 'mercadoflow.customer-daily';
const DAY_MS = 86_400_000;
const POLL_EVERY_MS = 30_000;

type Link = typeof mercadoflowLinks.$inferSelect;
interface Discount {
  active: boolean;
  partner?: string;
  percent?: number;
}

/**
 * Contas vinculadas e desconto (seção 5 do contrato). O Bipaê nunca define nem vê a senha do
 * MercadoFlow: a conta criada recebe o link de senha por e-mail. O desconto vale enquanto o
 * Bipaê disser que a loja é cliente ativo, então isso é enviado sempre que a assinatura muda e
 * uma vez por dia.
 */
@Injectable()
export class MercadoflowAccounts implements OnModuleInit {
  private readonly logger = new Logger('MercadoFlow');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(QUEUE) private readonly queue: JobQueue,
    @Inject(MERCADOFLOW_CLIENT) private readonly client: MercadoflowClient,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(MercadoflowWebhooks) webhooks: MercadoflowWebhooks,
    @Inject(MercadoflowMarketSync) private readonly marketSync: MercadoflowMarketSync,
  ) {
    // Depois que o webhook ativa o vínculo, avisa que a loja é cliente ativo.
    webhooks.after('connection.authorized', (event) => this.afterActivation(event.marketId));
  }

  onModuleInit() {
    if (!this.client.enabled) return;
    try {
      this.queue.process(DAILY_JOB, async () => {
        await this.syncAllCustomers();
      });
    } catch (error) {
      this.logger.error(`Rotina diária do MercadoFlow não iniciou: ${(error as Error).message}`);
      return;
    }
    if (this.config.NODE_ENV !== 'test') {
      void this.queue
        .add(DAILY_JOB, {}, { repeatEveryMs: DAY_MS })
        .catch((error: Error) =>
          this.logger.warn(`Não foi possível agendar a rotina diária: ${error.message}`),
        );
    }
  }

  private ensureEnabled() {
    if (!this.client.enabled) {
      throw new AppError(
        400,
        'mercadoflow_disabled',
        'A integração com o MercadoFlow ainda não está ligada no Bipaê.',
      );
    }
  }

  /** Mensagem do MercadoFlow para o usuário, ou "tente de novo" quando ele está fora do ar. */
  private friendly(error: unknown): never {
    if (error instanceof MercadoflowError) throw new AppError(400, 'mercadoflow', error.message);
    if (error instanceof MercadoflowUnavailableError) {
      throw new AppError(
        502,
        'mercadoflow_unavailable',
        'O MercadoFlow não respondeu agora. Tente de novo em alguns minutos.',
      );
    }
    throw error;
  }

  private async storeData(tx: Tx, ctx: RequestContext, storeId: string) {
    const [row] = await tx
      .select({ store: stores, company: companies })
      .from(stores)
      .innerJoin(companies, eq(companies.id, stores.companyId))
      .where(eq(stores.id, storeId));
    if (!row) throw notFound('Loja');
    if (!row.company.taxId || row.company.taxId.length !== 14) {
      throw new AppError(
        400,
        'missing_cnpj',
        'Informe o CNPJ da empresa desta loja em Empresas e lojas.',
      );
    }
    const [user] = await tx.select().from(users).where(eq(users.id, ctx.userId!));
    return { ...row, user };
  }

  private view(
    link: Link | undefined,
    store: { id: string; name: string },
    discount: Discount | null,
  ): MercadoflowLinkView {
    return {
      storeId: store.id,
      storeName: store.name,
      status: link?.status ?? null,
      marketId: link?.marketId ?? null,
      scopes: link?.scopes ?? [],
      createdVia: link?.createdVia ?? null,
      connectUrl: link?.status === 'PENDENTE' ? (link.connectUrl ?? null) : null,
      connectedAt: link?.connectedAt?.toISOString() ?? null,
      lastError: link?.lastError ?? null,
      customerActive: link?.customerActiveSent ?? null,
      discount,
    };
  }

  /** Situação de cada loja: vínculo, desconto, fila e erros. */
  async overview(ctx: RequestContext) {
    const rows = await withTenant(this.db, ctx, async (tx) => {
      const list = await tx.select({ id: stores.id, name: stores.name }).from(stores);
      const links = await tx.select().from(mercadoflowLinks);
      const queue = await tx
        .select({ status: mercadoflowOutbox.status, n: sql<number>`count(*)::int` })
        .from(mercadoflowOutbox)
        .groupBy(mercadoflowOutbox.status);
      const errors = await tx
        .select({ kind: mercadoflowOutbox.kind, error: mercadoflowOutbox.lastError })
        .from(mercadoflowOutbox)
        .where(eq(mercadoflowOutbox.status, 'rejected'))
        .limit(10);
      return { list, links, queue, errors };
    });
    const stores_ = await Promise.all(
      rows.list.map(async (store) => {
        const link = rows.links.find((l) => l.storeId === store.id);
        let discount: Discount | null = null;
        if (link?.status === 'ATIVA' && link.marketId && this.client.enabled) {
          discount = await this.client
            .get<{ discount?: Discount }>(`/markets/${link.marketId}/benefit`, {
              timeoutMs: 4000,
              attempts: 1,
            })
            .then((r) => r?.discount ?? null)
            .catch(() => null);
        }
        return this.view(link, store, discount);
      }),
    );
    const count = (status: string) => rows.queue.find((q) => q.status === status)?.n ?? 0;
    return {
      enabled: this.client.enabled,
      termsUrl: this.config.MERCADOFLOW_TERMS_URL || null,
      publicUrl: this.config.MERCADOFLOW_PUBLIC_URL,
      stores: stores_,
      queue: { pending: count('pending'), sent: count('sent'), rejected: count('rejected') },
      errors: rows.errors.map((e) => ({ kind: e.kind, error: e.error ?? '' })),
    };
  }

  /** "Criar minha conta MercadoFlow" (POST /accounts), com o aceite do dono. */
  async createAccount(
    ctx: RequestContext,
    input: { storeId: string; phone: string; acceptTerms: true },
  ) {
    this.ensureEnabled();
    const data = await withTenant(this.db, ctx, (tx) => this.storeData(tx, ctx, input.storeId));
    const acceptedAt = new Date().toISOString();
    try {
      const created = await this.client.post<{
        status: string;
        marketId: string;
        scopes?: string[];
        message?: string;
      }>(
        '/accounts',
        {
          cnpj: data.company.taxId,
          storeName: data.company.tradeName ?? data.company.legalName,
          ownerName: data.user!.name,
          ownerEmail: data.user!.email,
          phone: input.phone,
          externalStoreId: input.storeId,
          termsAcceptedAt: acceptedAt,
          customerActive: await this.customerActive(ctx.tenantId),
          scopes: MERCADOFLOW_SCOPES,
        },
        { attempts: 1 },
      );
      await withTenant(this.db, ctx, async (tx) => {
        await this.saveLink(tx, ctx, input.storeId, data.company.id, {
          status: 'ATIVA',
          marketId: created.marketId,
          scopes: created.scopes ?? MERCADOFLOW_SCOPES,
          createdVia: 'ACCOUNT',
          connectedAt: new Date(),
        });
        await this.audit.record(tx, ctx, {
          action: 'mercadoflow.account_created',
          entity: 'store',
          entityId: input.storeId,
          data: { marketId: created.marketId, termsAcceptedAt: acceptedAt },
        });
      });
      await this.afterActivation(created.marketId);
      return { status: 'CRIADA' as const, email: data.user!.email };
    } catch (error) {
      // Já existe conta para o CNPJ ou o e-mail: segue para o vínculo com o link que veio junto.
      if (error instanceof MercadoflowError && error.status === 409) {
        const body = (error.body ?? {}) as {
          message?: string;
          connect?: { code: string; connectUrl: string };
        };
        if (body.connect?.code) {
          await withTenant(this.db, ctx, (tx) =>
            this.saveLink(tx, ctx, input.storeId, data.company.id, {
              status: 'PENDENTE',
              connectCode: body.connect!.code,
              connectUrl: body.connect!.connectUrl,
              createdVia: 'CONNECT',
            }),
          );
          return {
            status: 'JA_TEM_CONTA' as const,
            message:
              body.message ??
              'Esta loja já tem conta no MercadoFlow. Entre nela para autorizar o vínculo.',
            connectUrl: body.connect.connectUrl,
          };
        }
      }
      this.friendly(error);
    }
  }

  /** "Já tenho conta MercadoFlow": pede o link de vínculo (POST /connect). */
  async connect(ctx: RequestContext, input: { storeId: string; returnUrl: string }) {
    this.ensureEnabled();
    const data = await withTenant(this.db, ctx, (tx) => this.storeData(tx, ctx, input.storeId));
    let started: { code: string; connectUrl: string; expiresAt?: string; scopes?: string[] };
    try {
      started = await this.client.post('/connect', {
        cnpj: data.company.taxId,
        storeName: data.company.tradeName ?? data.company.legalName,
        ownerEmail: data.user!.email,
        externalStoreId: input.storeId,
        returnUrl: input.returnUrl,
        scopes: MERCADOFLOW_SCOPES,
      });
    } catch (error) {
      this.friendly(error);
    }
    await withTenant(this.db, ctx, async (tx) => {
      await this.saveLink(tx, ctx, input.storeId, data.company.id, {
        status: 'PENDENTE',
        connectCode: started.code,
        connectUrl: started.connectUrl,
        createdVia: 'CONNECT',
      });
      await this.audit.record(tx, ctx, {
        action: 'mercadoflow.connect_started',
        entity: 'store',
        entityId: input.storeId,
        data: { code: started.code },
      });
    });
    return { connectUrl: started.connectUrl, expiresAt: started.expiresAt ?? null };
  }

  /** Consulta o vínculo pendente (GET /connect/{code}); a tela chama a cada 30 s. */
  async refresh(ctx: RequestContext, storeId: string) {
    this.ensureEnabled();
    const link = await withTenant(this.db, ctx, async (tx) => {
      const [row] = await tx
        .select()
        .from(mercadoflowLinks)
        .where(eq(mercadoflowLinks.storeId, storeId));
      return row;
    });
    if (!link) throw notFound('Vínculo');
    if (link.status !== 'PENDENTE' || !link.connectCode) return { status: link.status };
    let result: { status: string; marketId?: string; scopes?: string[] };
    try {
      result = await this.client.get(`/connect/${link.connectCode}`, {
        timeoutMs: 6000,
        attempts: 1,
      });
    } catch (error) {
      this.friendly(error);
    }
    const next =
      result.status === 'APROVADO'
        ? 'ATIVA'
        : result.status === 'RECUSADO'
          ? 'RECUSADA'
          : result.status === 'EXPIRADO'
            ? 'EXPIRADA'
            : 'PENDENTE';
    if (next !== 'PENDENTE') {
      await withTenant(this.db, ctx, (tx) =>
        tx
          .update(mercadoflowLinks)
          .set({
            status: next,
            ...(next === 'ATIVA' && {
              marketId: result.marketId ?? link.marketId,
              scopes: result.scopes ?? link.scopes,
              connectedAt: link.connectedAt ?? new Date(),
              lastError: null,
            }),
            ...(next === 'RECUSADA' && { lastError: 'O dono recusou o vínculo no MercadoFlow.' }),
            ...(next === 'EXPIRADA' && { lastError: 'O link de vínculo expirou. Peça um novo.' }),
            updatedAt: new Date(),
          })
          .where(eq(mercadoflowLinks.id, link.id)),
      );
      if (next === 'ATIVA' && result.marketId) await this.afterActivation(result.marketId);
    }
    return { status: next, pollEveryMs: POLL_EVERY_MS };
  }

  private async saveLink(
    tx: Tx,
    ctx: RequestContext,
    storeId: string,
    companyId: string,
    values: Partial<typeof mercadoflowLinks.$inferInsert> &
      Pick<typeof mercadoflowLinks.$inferInsert, 'status' | 'createdVia'>,
  ) {
    await tx
      .insert(mercadoflowLinks)
      .values({ id: uuidv7(), tenantId: ctx.tenantId, companyId, storeId, ...values })
      .onConflictDoUpdate({
        target: mercadoflowLinks.storeId,
        set: { ...values, revokedAt: null, lastError: null, updatedAt: new Date() },
      });
  }

  /** O cliente pode usar o Bipaê? É isso que liga o desconto no MercadoFlow. */
  private async customerActive(tenantId: string): Promise<boolean> {
    const [tenant] = await asPlatform(this.db, (tx) =>
      tx
        .select({ status: tenants.status, trialEndsAt: tenants.trialEndsAt })
        .from(tenants)
        .where(eq(tenants.id, tenantId)),
    );
    return !!tenant && accountAccess(tenant.status, tenant.trialEndsAt).allowed;
  }

  /** Avisa o MercadoFlow se as lojas vinculadas são cliente ativo (PUT /markets/{id}/customer). */
  async syncCustomers(tenantId: string) {
    if (!this.client.enabled) return;
    const links = await asPlatform(this.db, (tx) =>
      tx
        .select()
        .from(mercadoflowLinks)
        .where(and(eq(mercadoflowLinks.tenantId, tenantId), eq(mercadoflowLinks.status, 'ATIVA'))),
    );
    const active = await this.customerActive(tenantId);
    for (const link of links.filter((l) => l.marketId)) {
      try {
        await this.client.put(`/markets/${link.marketId}/customer`, { active });
        await asPlatform(this.db, (tx) =>
          tx
            .update(mercadoflowLinks)
            .set({ customerActiveSent: active, updatedAt: new Date() })
            .where(eq(mercadoflowLinks.id, link.id)),
        );
      } catch (error) {
        await asPlatform(this.db, (tx) =>
          tx
            .update(mercadoflowLinks)
            .set({
              lastError: `Não foi possível avisar o MercadoFlow: ${(error as Error).message}`.slice(
                0,
                500,
              ),
            })
            .where(eq(mercadoflowLinks.id, link.id)),
        );
      }
    }
  }

  /** Rotina diária: todas as lojas vinculadas de todos os clientes. */
  async syncAllCustomers() {
    const tenantIds = await asPlatform(this.db, (tx) =>
      tx
        .selectDistinct({ id: mercadoflowLinks.tenantId })
        .from(mercadoflowLinks)
        .where(eq(mercadoflowLinks.status, 'ATIVA')),
    );
    for (const { id } of tenantIds) await this.syncCustomers(id);
  }

  private async afterActivation(marketId: string | null) {
    if (!marketId) return;
    const [link] = await asPlatform(this.db, (tx) =>
      tx
        .select({ tenantId: mercadoflowLinks.tenantId, storeId: mercadoflowLinks.storeId })
        .from(mercadoflowLinks)
        .where(inArray(mercadoflowLinks.marketId, [marketId])),
    );
    if (!link) return;
    await this.syncCustomers(link.tenantId);
    // Carga inicial (seção 7.4): vai pela fila, sem segurar quem ativou.
    await this.marketSync.initialLoad(link.tenantId, link.storeId);
  }
}
