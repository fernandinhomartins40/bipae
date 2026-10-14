import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { listQuery } from '@bipae/domain';
import { z } from 'zod';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { parse } from '../../common/errors';
import { SalesService, stockAdjustmentInput } from './sales.service';

@Controller()
export class SalesController {
  constructor(@Inject(SalesService) private readonly sales: SalesService) {}

  @Get('sales')
  @RequirePermission('catalog.read')
  list(@Ctx() ctx: RequestContext, @Query() query: unknown) {
    const { limit, offset } = parse(listQuery, query);
    return this.sales.list(ctx, limit, offset);
  }

  @Get('sales/:id')
  @RequirePermission('catalog.read')
  get(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.sales.get(ctx, id);
  }

  @Get('stock')
  @RequirePermission('catalog.read')
  balances(@Ctx() ctx: RequestContext, @Query() query: unknown) {
    const { productId } = parse(
      z.object({ productId: z.union([z.string().uuid(), z.array(z.string().uuid())]).optional() }),
      query,
    );
    return this.sales.balances(ctx, productId === undefined ? undefined : [productId].flat());
  }

  @Post('stock/adjustments')
  @RequirePermission('catalog.write')
  adjust(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.sales.adjust(ctx, parse(stockAdjustmentInput, body));
  }

  /** Terminals a register may be linked to (any user who sells, not only admins). */
  @Get('pos/terminals')
  @RequirePermission('pos.sell')
  terminals(@Ctx() ctx: RequestContext) {
    return this.sales.activeTerminals(ctx);
  }

  @Get('pos/terminals/:id/context')
  @RequirePermission('pos.sell')
  context(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.sales.terminalContext(ctx, id);
  }
}
