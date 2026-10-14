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
import { creditPaymentInput, customerInput, listQuery, partyInput } from '@bipae/domain';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { parse } from '../../common/errors';
import { PartiesService } from './parties.service';

@Controller()
export class PartiesController {
  constructor(@Inject(PartiesService) private readonly parties: PartiesService) {}

  @Get('customers')
  @RequirePermission('parties.read')
  listCustomers(@Ctx() ctx: RequestContext, @Query() query: unknown) {
    return this.parties.list(ctx, 'customer', parse(listQuery, query));
  }

  @Get('customers/:id')
  @RequirePermission('parties.read')
  getCustomer(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.parties.get(ctx, 'customer', id);
  }

  @Post('customers')
  @RequirePermission('parties.write')
  createCustomer(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.parties.save(ctx, 'customer', null, parse(customerInput, body));
  }

  /** Crediário do cliente (F2-02): limite, saldo e extrato. */
  @Get('customers/:id/credit')
  @RequirePermission('parties.read')
  customerCredit(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.parties.credit(ctx, id);
  }

  @Post('customers/:id/credit/payments')
  @RequirePermission('parties.credit')
  receiveCredit(
    @Ctx() ctx: RequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.parties.receiveCredit(ctx, id, parse(creditPaymentInput, body));
  }

  @Put('customers/:id')
  @RequirePermission('parties.write')
  updateCustomer(
    @Ctx() ctx: RequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.parties.save(ctx, 'customer', id, parse(customerInput, body));
  }

  @Get('suppliers')
  @RequirePermission('parties.read')
  listSuppliers(@Ctx() ctx: RequestContext, @Query() query: unknown) {
    return this.parties.list(ctx, 'supplier', parse(listQuery, query));
  }

  @Get('suppliers/:id')
  @RequirePermission('parties.read')
  getSupplier(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.parties.get(ctx, 'supplier', id);
  }

  @Post('suppliers')
  @RequirePermission('parties.write')
  createSupplier(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.parties.save(ctx, 'supplier', null, parse(partyInput, body));
  }

  @Put('suppliers/:id')
  @RequirePermission('parties.write')
  updateSupplier(
    @Ctx() ctx: RequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.parties.save(ctx, 'supplier', id, parse(partyInput, body));
  }
}
