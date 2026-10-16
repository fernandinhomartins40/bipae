import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { purchaseImportInput, purchasePersonalUseInput, purchaseXmlInput } from '@bipae/domain';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { parse } from '../../common/errors';
import { PurchasesService } from './purchases.service';

/** Compras pelo XML da NF-e do fornecedor (F3-19). */
@Controller('purchases')
export class PurchasesController {
  constructor(@Inject(PurchasesService) private readonly purchases: PurchasesService) {}

  @Get()
  @RequirePermission('catalog.read')
  list(@Ctx() ctx: RequestContext) {
    return this.purchases.list(ctx);
  }

  /** Lê o XML e mostra o que vai entrar, sem gravar nada. */
  @Post('preview')
  @RequirePermission('catalog.write')
  preview(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.purchases.preview(ctx, parse(purchaseXmlInput, body).xml);
  }

  @Post()
  @RequirePermission('catalog.write')
  import(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.purchases.import(ctx, parse(purchaseImportInput, body));
  }

  /** Uso ou consumo pessoal (LC 214/2025, art. 57): sem crédito de IBS e CBS na apuração. */
  @Put(':id/personal-use')
  @RequirePermission('fiscal.profile.write')
  personalUse(
    @Ctx() ctx: RequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.purchases.setPersonalUse(
      ctx,
      id,
      parse(purchasePersonalUseInput, body).personalUse,
    );
  }
}
