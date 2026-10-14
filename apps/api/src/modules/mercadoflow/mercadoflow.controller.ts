import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { mercadoflowAccountInput, mercadoflowConnectInput } from '@bipae/domain';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { parse } from '../../common/errors';
import { MercadoflowAccounts } from './mercadoflow.accounts';

/**
 * Tela "MercadoFlow" nas configurações (seção 5): criar ou vincular a conta, situação, desconto,
 * fila e erros. Vincular é decisão do dono (autoriza o envio dos dados da loja), por isso exige a
 * permissão de gerenciar empresas e lojas e fica na auditoria.
 */
@Controller('mercadoflow')
export class MercadoflowController {
  constructor(@Inject(MercadoflowAccounts) private readonly accounts: MercadoflowAccounts) {}

  @Get()
  @RequirePermission('admin.stores')
  overview(@Ctx() ctx: RequestContext) {
    return this.accounts.overview(ctx);
  }

  @Post('accounts')
  @RequirePermission('admin.stores')
  createAccount(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.accounts.createAccount(ctx, parse(mercadoflowAccountInput, body));
  }

  @Post('connect')
  @RequirePermission('admin.stores')
  connect(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.accounts.connect(ctx, parse(mercadoflowConnectInput, body));
  }

  @Post('links/:storeId/refresh')
  @RequirePermission('admin.stores')
  refresh(@Ctx() ctx: RequestContext, @Param('storeId', new ParseUUIDPipe()) storeId: string) {
    return this.accounts.refresh(ctx, storeId);
  }
}
