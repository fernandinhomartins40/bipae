import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { companyInput, storeInput, storeUpdateInput, terminalInput } from '@bipae/domain';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { parse } from '../../common/errors';
import { OrganizationService } from './organization.service';

@Controller()
export class OrganizationController {
  constructor(@Inject(OrganizationService) private readonly org: OrganizationService) {}

  @Get('companies')
  listCompanies(@Ctx() ctx: RequestContext) {
    return this.org.listCompanies(ctx);
  }

  @Post('companies')
  @RequirePermission('admin.stores')
  createCompany(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.org.createCompany(ctx, parse(companyInput, body));
  }

  /** Receita do ano e avisos de limite do regime (F3-29). */
  @Get('companies/:id/revenue')
  @RequirePermission('admin.stores')
  revenue(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.org.revenue(ctx, id);
  }

  @Patch('companies/:id')
  @RequirePermission('admin.stores')
  updateCompany(
    @Ctx() ctx: RequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.org.updateCompany(ctx, id, parse(companyInput, body));
  }

  @Get('stores')
  listStores(@Ctx() ctx: RequestContext) {
    return this.org.listStores(ctx);
  }

  @Post('stores')
  @RequirePermission('admin.stores')
  createStore(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.org.createStore(ctx, parse(storeInput, body));
  }

  @Patch('stores/:id')
  @RequirePermission('admin.stores')
  updateStore(
    @Ctx() ctx: RequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.org.updateStore(ctx, id, parse(storeUpdateInput, body));
  }

  @Get('terminals')
  @RequirePermission('admin.terminals')
  listTerminals(@Ctx() ctx: RequestContext) {
    return this.org.listTerminals(ctx);
  }

  @Post('terminals')
  @RequirePermission('admin.terminals')
  createTerminal(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.org.createTerminal(ctx, parse(terminalInput, body));
  }

  @Post('terminals/:id/revoke')
  @RequirePermission('admin.terminals')
  revokeTerminal(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.org.revokeTerminal(ctx, id);
  }
}
