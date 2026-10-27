import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import {
  CHANNEL_ACTIONS,
  CHANNEL_ORDER_STATUSES,
  type ChannelAction,
  type ChannelOrderStatus,
} from '@bipae/domain';
import type { FastifyRequest } from 'fastify';
import { Ctx, Public, RequirePermission, type RequestContext } from '../../common/auth';
import { AppError } from '../../common/errors';
import { ChannelsService } from './channels.service';

const MAX_BODY = 256 * 1024;
const RATE_LIMIT = { rateLimit: { max: 300, timeWindow: '1 minute' } };

/** Telas e ações da retaguarda: ligar a integração, ver os pedidos e mudar o status. */
@Controller('channels')
export class ChannelsController {
  constructor(@Inject(ChannelsService) private readonly channels: ChannelsService) {}

  @Get('integrations')
  @RequirePermission('pos.order')
  list(@Ctx() ctx: RequestContext) {
    return this.channels.list(ctx);
  }

  @Post('integrations')
  @RequirePermission('admin.integrations')
  create(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.channels.create(ctx, body);
  }

  @Put('integrations/:id')
  @RequirePermission('admin.integrations')
  update(
    @Ctx() ctx: RequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.channels.update(ctx, id, body);
  }

  @Post('integrations/:id/secret')
  @RequirePermission('admin.integrations')
  rotate(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.channels.rotateSecret(ctx, id);
  }

  @Post('integrations/:id/poll')
  @RequirePermission('admin.integrations')
  poll(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.channels.poll(ctx.tenantId, id);
  }

  @Post('integrations/:id/catalog-sync')
  @RequirePermission('admin.integrations')
  sync(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.channels.syncCatalog(ctx, id);
  }

  @Post('integrations/:id/simulate')
  @RequirePermission('admin.integrations')
  simulate(
    @Ctx() ctx: RequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: { unmapped?: boolean; prepaid?: boolean } | undefined,
  ) {
    return this.channels.simulate(ctx, id, {
      unmapped: !!body?.unmapped,
      prepaid: !!body?.prepaid,
    });
  }

  @Get('integrations/:id/links')
  @RequirePermission('pos.order')
  links(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.channels.links(ctx, id);
  }

  @Post('integrations/:id/links')
  @RequirePermission('admin.integrations')
  link(
    @Ctx() ctx: RequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.channels.link(ctx, id, body);
  }

  @Delete('integrations/:id/links/:sku')
  @RequirePermission('admin.integrations')
  unlink(
    @Ctx() ctx: RequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('sku') sku: string,
  ) {
    return this.channels.unlink(ctx, id, sku);
  }

  @Get('orders')
  @RequirePermission('pos.order')
  orders(
    @Ctx() ctx: RequestContext,
    @Query('status') status?: string,
    @Query('open') open?: string,
  ) {
    if (status && !CHANNEL_ORDER_STATUSES.includes(status as ChannelOrderStatus)) {
      throw new AppError(422, 'invalid_status', 'Situação inválida.');
    }
    return this.channels.listOrders(ctx, {
      ...(status && { status: status as ChannelOrderStatus }),
      open: open === '1',
    });
  }

  @Post('orders/:id/:action')
  @RequirePermission('pos.order')
  act(
    @Ctx() ctx: RequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('action') action: string,
    @Body() body: unknown,
  ) {
    if (action === 'retry') return this.channels.retry(ctx, id);
    if (!CHANNEL_ACTIONS.includes(action as ChannelAction)) {
      throw new AppError(404, 'not_found', 'Ação não encontrada.');
    }
    return this.channels.act(ctx, id, action as ChannelAction, body);
  }

  /**
   * Entrada de pedidos dos conectores de marketplace (F6-06). Sem login: a prova é a assinatura
   * HMAC do corpo com o segredo da integração (cabeçalho x-bipae-signature, "t=...,v1=...").
   */
  @Public()
  @Post('inbound/:tenantId/:key')
  @HttpCode(200)
  @RouteConfig(RATE_LIMIT)
  inbound(
    @Req() request: RawBodyRequest<FastifyRequest>,
    @Param('tenantId', new ParseUUIDPipe()) tenantId: string,
    @Param('key') key: string,
    @Headers('x-bipae-signature') signature: string | undefined,
  ) {
    const raw = request.rawBody;
    if (!raw || raw.length > MAX_BODY) {
      throw new AppError(413, 'payload_too_large', 'Corpo ausente ou grande demais.');
    }
    return this.channels.inbound(tenantId, key, signature, raw.toString('utf8'), request.body);
  }
}
