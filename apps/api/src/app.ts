import 'reflect-metadata';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { Controller, Get, Inject, Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  CLIENT_HEADER,
  parseClientHeader,
  requiresUpdate,
  TERMINAL_HEADER,
  type ApiErrorBody,
} from '@bipae/domain';
import { AuthGuard, Public } from './common/auth';
import { CONFIG, DB, QUEUE } from './common/di';
import { createQueue } from './common/queue';
import { ApiExceptionFilter } from './common/errors';
import { TokenService } from './common/tokens';
import type { Config } from './config';
import type { Database } from './db/client';
import { AccountController } from './modules/account/account.controller';
import { AdminAuthController } from './modules/admin/admin-auth.controller';
import { AdminAuthService } from './modules/admin/admin-auth.service';
import { AdminController } from './modules/admin/admin.controller';
import { AdminPlatformService } from './modules/admin/admin-platform.service';
import { AdminTenantsService } from './modules/admin/admin-tenants.service';
import { PlatformAuditService } from './modules/admin/platform-audit.service';
import { PlatformGuard } from './modules/admin/platform.guard';
import { DataExportService } from './modules/account/data-export.service';
import { LimitsService } from './modules/account/limits.service';
import { DownloadsController, DownloadsService } from './modules/downloads/downloads.controller';
import { FiscalController } from './modules/fiscal/fiscal.controller';
import { MERCADOFLOW_CLIENT, MercadoflowClient } from './modules/mercadoflow/mercadoflow.client';
import {
  MercadoflowCatalog,
  MercadoflowCatalogController,
} from './modules/mercadoflow/mercadoflow.catalog';
import { MercadoflowAccounts } from './modules/mercadoflow/mercadoflow.accounts';
import { MercadoflowConfere } from './modules/mercadoflow/mercadoflow.confere';
import {
  MercadoflowConfereController,
  SupplierIssuesController,
} from './modules/mercadoflow/mercadoflow.confere.controller';
import { MercadoflowController } from './modules/mercadoflow/mercadoflow.controller';
import { MercadoflowContributions } from './modules/mercadoflow/mercadoflow.contributions';
import { MercadoflowInsights } from './modules/mercadoflow/mercadoflow.insights';
import { MercadoflowMarketSync } from './modules/mercadoflow/mercadoflow.market-sync';
import { MercadoflowSales } from './modules/mercadoflow/mercadoflow.sales';
import {
  MercadoflowPendings,
  MercadoflowPendingsController,
} from './modules/mercadoflow/mercadoflow.pendings';
import { MercadoflowEncartes } from './modules/mercadoflow/mercadoflow.encartes';
import { MercadoflowOrders } from './modules/mercadoflow/mercadoflow.orders';
import { MercadoflowOutbox } from './modules/mercadoflow/mercadoflow.outbox';
import {
  MercadoflowWebhookController,
  MercadoflowWebhooks,
} from './modules/mercadoflow/mercadoflow.webhook';
import { PurchaseOrdersController } from './modules/purchases/purchase-orders.controller';
import { PurchaseOrdersService } from './modules/purchases/purchase-orders.service';
import { PurchasesController } from './modules/purchases/purchases.controller';
import { PurchasesService } from './modules/purchases/purchases.service';
import { CertificatesService } from './modules/fiscal/certificates.service';
import { HttpsSefazTransport } from './modules/fiscal/sefaz.transport';
import { SEFAZ_TRANSPORT, SefazService } from './modules/fiscal/sefaz.service';
import {
  NfceEmissionController,
  NfceEmissionService,
} from './modules/fiscal/nfce-emission.service';
import { NfeInvoicesController, NfeInvoicesService } from './modules/fiscal/nfe-invoices.service';
import { DfeController, DfeService } from './modules/fiscal/dfe.service';
import {
  NfseReceivedController,
  NfseReceivedService,
} from './modules/fiscal/nfse-received.service';
import {
  NFSE_TRANSPORT,
  NfseController,
  NfseParamsController,
  NfseService,
} from './modules/fiscal/nfse.service';
import { HttpsNfseTransport } from './modules/fiscal/nfse.transport';
import { MailService } from './modules/mail/mail.service';
import {
  AccountantExportController,
  AccountantExportService,
} from './modules/fiscal/accountant-export.service';
import { EfdController, EfdService } from './modules/fiscal/efd.service';
import {
  FiscalEventsController,
  FiscalEventsService,
} from './modules/fiscal/fiscal-events.service';
import { IcmsRulesService } from './modules/fiscal/icms-rules.service';
import { AuditController } from './modules/audit/audit.controller';
import { AuditService } from './modules/audit/audit.service';
import { AuthController } from './modules/auth/auth.controller';
import { AuthService } from './modules/auth/auth.service';
import { CatalogController } from './modules/catalog/catalog.controller';
import { CatalogService } from './modules/catalog/catalog.service';
import { PricingController, PricingService } from './modules/catalog/pricing.service';
import { BankController, BankService } from './modules/finance/bank.service';
import { FinanceController, FinanceService } from './modules/finance/finance.service';
import { ReportsController, ReportsService } from './modules/reports/reports.service';
import { LossesController, LossesService } from './modules/reports/losses.service';
import { TabsController } from './modules/sales/tabs.controller';
import { KitchenController, KitchenService } from './modules/sales/kitchen.service';
import { ConditionalsController, ConditionalsService } from './modules/sales/conditionals.service';
import {
  ServiceOrdersController,
  ServiceOrdersService,
  ServicesController,
} from './modules/sales/service-orders.service';
import { ApiKeysController, ApiKeysService } from './modules/public-api/api-keys.service';
import { WebhooksController, WebhooksService } from './modules/public-api/webhooks.service';
import { CrmController, CrmService } from './modules/crm/crm.service';
import { CampaignsController, CampaignsService } from './modules/crm/campaigns.service';
import { ClaudeProvider } from './modules/ai/ai.provider';
import { AI_PROVIDER, AiController, AiService } from './modules/ai/ai.service';
import { LoyaltyController, LoyaltyService } from './modules/crm/loyalty.service';
import { PublicApiController, PublicDataService } from './modules/public-api/public-api.controller';
import { TabOrdersController, TabOrdersService } from './modules/sales/tab-orders.service';
import { DeliveryController, DeliveryService } from './modules/sales/delivery.service';
import { SellersController, SellersService } from './modules/sales/sellers.service';
import { CommissionController, CommissionService } from './modules/sales/commission.service';
import { PixChargesController, PixChargesService } from './modules/payments/pix-charges.service';
import { CardChargesController, CardChargesService } from './modules/payments/card-charges.service';
import {
  PaymentSettingsController,
  PaymentSettingsService,
} from './modules/sales/payment-settings.service';
import { InventoryController, InventoryService } from './modules/stock/inventory.service';
import { TransferController, TransferService } from './modules/stock/transfer.service';
import { LotsController, LotsService } from './modules/stock/lots.service';
import { LabelsController, LabelsService } from './modules/catalog/labels.service';
import { PromotionsController, PromotionsService } from './modules/catalog/promotions.service';
import {
  IbsCbsSettlementController,
  IbsCbsSettlementService,
} from './modules/fiscal/ibs-cbs-settlement.service';
import { SettlementController, SettlementService } from './modules/finance/settlement.service';
import { MaintenanceService } from './modules/maintenance/maintenance.service';
import { OrganizationController } from './modules/organization/organization.controller';
import { OrganizationService } from './modules/organization/organization.service';
import { PartiesController } from './modules/parties/parties.controller';
import { PartiesService } from './modules/parties/parties.service';
import { TeamController } from './modules/team/team.controller';
import { TeamService } from './modules/team/team.service';
import { SalesController } from './modules/sales/sales.controller';
import { SalesService } from './modules/sales/sales.service';
import { SyncController } from './modules/sync/sync.controller';
import { SyncService } from './modules/sync/sync.service';

export { API_VERSION } from './version';
import { API_VERSION } from './version';

@Controller('health')
class HealthController {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(MailService) private readonly mail: MailService,
  ) {}

  @Public()
  @Get()
  health() {
    return {
      status: 'ok',
      version: API_VERSION,
      minimumClientVersions: this.config.minimumClientVersions,
      /** O que depende de configuração externa (P-04): as telas só oferecem o que está ligado. */
      features: { email: this.mail.enabled },
    };
  }
}

@Module({})
class AppModule {
  static forRoot(config: Config, database: Database): DynamicModule {
    return {
      module: AppModule,
      controllers: [
        HealthController,
        AuthController,
        OrganizationController,
        TeamController,
        CatalogController,
        PricingController,
        FinanceController,
        BankController,
        SettlementController,
        ReportsController,
        LossesController,
        TabsController,
        KitchenController,
        TabOrdersController,
        ConditionalsController,
        ServicesController,
        ServiceOrdersController,
        ApiKeysController,
        WebhooksController,
        CrmController,
        CampaignsController,
        AiController,
        LoyaltyController,
        PublicApiController,
        DeliveryController,
        SellersController,
        CommissionController,
        PaymentSettingsController,
        PixChargesController,
        CardChargesController,
        InventoryController,
        TransferController,
        NfceEmissionController,
        NfeInvoicesController,
        DfeController,
        NfseReceivedController,
        NfseController,
        NfseParamsController,
        FiscalEventsController,
        AccountantExportController,
        EfdController,
        LotsController,
        LabelsController,
        PromotionsController,
        IbsCbsSettlementController,
        PartiesController,
        AuditController,
        SyncController,
        SalesController,
        AccountController,
        AdminAuthController,
        AdminController,
        DownloadsController,
        FiscalController,
        PurchasesController,
        PurchaseOrdersController,
        MercadoflowWebhookController,
        MercadoflowCatalogController,
        MercadoflowController,
        MercadoflowPendingsController,
        MercadoflowConfereController,
        SupplierIssuesController,
      ],
      providers: [
        { provide: CONFIG, useValue: config },
        { provide: DB, useValue: database.db },
        {
          provide: QUEUE,
          useValue: createQueue(config.REDIS_URL, (m) => console.warn(`[fila] ${m}`)),
        },
        MaintenanceService,
        TokenService,
        AuditService,
        AuthService,
        OrganizationService,
        TeamService,
        CatalogService,
        PricingService,
        FinanceService,
        BankService,
        SettlementService,
        ReportsService,
        LossesService,
        KitchenService,
        TabOrdersService,
        ConditionalsService,
        ServiceOrdersService,
        ApiKeysService,
        WebhooksService,
        CrmService,
        CampaignsService,
        AiService,
        {
          provide: AI_PROVIDER,
          useValue: config.AI_API_KEY
            ? new ClaudeProvider(config.AI_API_KEY, config.AI_MODEL)
            : null,
        },
        LoyaltyService,
        PublicDataService,
        DeliveryService,
        SellersService,
        CommissionService,
        PaymentSettingsService,
        PixChargesService,
        CardChargesService,
        InventoryService,
        TransferService,
        LotsService,
        LabelsService,
        PromotionsService,
        IbsCbsSettlementService,
        IcmsRulesService,
        CertificatesService,
        { provide: SEFAZ_TRANSPORT, useValue: new HttpsSefazTransport() },
        { provide: NFSE_TRANSPORT, useValue: new HttpsNfseTransport() },
        SefazService,
        NfceEmissionService,
        NfeInvoicesService,
        DfeService,
        NfseReceivedService,
        NfseService,
        MailService,
        FiscalEventsService,
        AccountantExportService,
        EfdService,
        PurchasesService,
        PurchaseOrdersService,
        {
          provide: MERCADOFLOW_CLIENT,
          useValue: new MercadoflowClient({
            apiUrl: config.MERCADOFLOW_API_URL,
            clientId: config.MERCADOFLOW_CLIENT_ID,
            clientSecret: config.MERCADOFLOW_CLIENT_SECRET,
          }),
        },
        MercadoflowOutbox,
        MercadoflowCatalog,
        MercadoflowContributions,
        MercadoflowSales,
        MercadoflowEncartes,
        MercadoflowOrders,
        MercadoflowPendings,
        MercadoflowMarketSync,
        MercadoflowInsights,
        MercadoflowAccounts,
        MercadoflowConfere,
        MercadoflowWebhooks,
        PartiesService,
        SyncService,
        SalesService,
        LimitsService,
        DataExportService,
        PlatformAuditService,
        PlatformGuard,
        AdminAuthService,
        AdminTenantsService,
        AdminPlatformService,
        DownloadsService,
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
      ],
    };
  }
}

export async function createApp(config: Config, database: Database) {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot(config, database),
    new FastifyAdapter({ trustProxy: true, bodyLimit: 2 * 1024 * 1024 }),
    // rawBody: o aviso do MercadoFlow é conferido pela assinatura do corpo como chegou.
    { logger: config.NODE_ENV === 'test' ? false : ['error', 'warn', 'log'], rawBody: true },
  );
  app.setGlobalPrefix('v1');

  await app.register(helmet);
  await app.register(cors, {
    origin: config.CORS_ORIGINS,
    credentials: false,
    // @fastify/cors only allows GET/HEAD/POST by default: edits (PUT/PATCH) from the desktop app,
    // which calls the API cross-origin, were blocked by the browser engine.
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['content-type', 'authorization', CLIENT_HEADER, TERMINAL_HEADER],
  });
  await app.register(rateLimit, { global: false, max: config.LOGIN_RATE_LIMIT_PER_MINUTE });
  // Respostas da API trazem dados da conta: nada de guardar em cache do navegador ou de
  // proxy (F7-02, OWASP ASVS 8.2.1). Quem quiser cache diz o seu próprio Cache-Control.
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onSend', async (_request, reply, payload) => {
      if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
      return payload;
    });

  // Minimum client version (ADR-0012 §6). Sync uploads are never refused.
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRequest', async (request, reply) => {
      const client = parseClientHeader(request.headers[CLIENT_HEADER] as string | undefined);
      const path = request.url.split('?')[0] ?? '';
      if (requiresUpdate(client, config.minimumClientVersions, path)) {
        const body: ApiErrorBody = {
          statusCode: 426,
          code: 'update_required',
          message:
            'Há uma nova versão do Bipaê. Atualize para continuar; suas vendas pendentes estão guardadas e serão enviadas.',
        };
        return reply.status(426).send(body);
      }
    });

  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
