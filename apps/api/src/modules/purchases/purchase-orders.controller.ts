import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  purchaseOrderCancelInput,
  purchaseOrderInput,
  purchaseOrderReceiveInput,
  type PurchaseOrderStatus,
} from '@bipae/domain';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { AppError, parse } from '../../common/errors';
import { PurchaseOrdersService } from './purchase-orders.service';

const STATUSES: PurchaseOrderStatus[] = ['draft', 'sent', 'received', 'cancelled'];

/** Pedidos de compra (F4-01). */
@Controller('purchase-orders')
export class PurchaseOrdersController {
  constructor(@Inject(PurchaseOrdersService) private readonly orders: PurchaseOrdersService) {}

  @Get()
  @RequirePermission('catalog.read')
  list(@Ctx() ctx: RequestContext, @Query('status') status?: string) {
    if (status && !STATUSES.includes(status as PurchaseOrderStatus)) {
      throw new AppError(422, 'invalid_status', 'Situação do pedido inválida.');
    }
    return this.orders.list(ctx, status as PurchaseOrderStatus | undefined);
  }

  @Get(':id')
  @RequirePermission('catalog.read')
  get(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.orders.get(ctx, id);
  }

  @Post()
  @RequirePermission('catalog.write')
  create(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.orders.create(ctx, parse(purchaseOrderInput, body));
  }

  @Put(':id')
  @RequirePermission('catalog.write')
  update(
    @Ctx() ctx: RequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.orders.update(ctx, id, parse(purchaseOrderInput, body));
  }

  @Post(':id/send')
  @RequirePermission('catalog.write')
  send(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.orders.send(ctx, id);
  }

  /** Entrada da mercadoria do pedido, conferida (F4-02). */
  @Post(':id/receive')
  @RequirePermission('catalog.write')
  receive(
    @Ctx() ctx: RequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.orders.receive(ctx, id, parse(purchaseOrderReceiveInput, body));
  }

  @Post(':id/cancel')
  @RequirePermission('catalog.write')
  cancel(
    @Ctx() ctx: RequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.orders.cancel(ctx, id, parse(purchaseOrderCancelInput, body).reason);
  }
}
