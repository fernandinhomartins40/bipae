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
import { CONFIG, DB } from './common/di';
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
import { LimitsService } from './modules/account/limits.service';
import { DownloadsController, DownloadsService } from './modules/downloads/downloads.controller';
import { AuditController } from './modules/audit/audit.controller';
import { AuditService } from './modules/audit/audit.service';
import { AuthController } from './modules/auth/auth.controller';
import { AuthService } from './modules/auth/auth.service';
import { CatalogController } from './modules/catalog/catalog.controller';
import { CatalogService } from './modules/catalog/catalog.service';
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
  constructor(@Inject(CONFIG) private readonly config: Config) {}

  @Public()
  @Get()
  health() {
    return {
      status: 'ok',
      version: API_VERSION,
      minimumClientVersions: this.config.minimumClientVersions,
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
        PartiesController,
        AuditController,
        SyncController,
        SalesController,
        AccountController,
        AdminAuthController,
        AdminController,
        DownloadsController,
      ],
      providers: [
        { provide: CONFIG, useValue: config },
        { provide: DB, useValue: database.db },
        TokenService,
        AuditService,
        AuthService,
        OrganizationService,
        TeamService,
        CatalogService,
        PartiesService,
        SyncService,
        SalesService,
        LimitsService,
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
    { logger: config.NODE_ENV === 'test' ? false : ['error', 'warn', 'log'] },
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
