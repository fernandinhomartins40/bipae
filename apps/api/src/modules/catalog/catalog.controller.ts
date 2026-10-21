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
  fiscalProfileInput,
  productListQuery,
  priceTableInput,
  productInput,
  unitInput,
} from '@bipae/domain';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { parse } from '../../common/errors';
import { CatalogService } from './catalog.service';

@Controller()
export class CatalogController {
  constructor(@Inject(CatalogService) private readonly catalog: CatalogService) {}

  @Get('products')
  @RequirePermission('catalog.read')
  listProducts(@Ctx() ctx: RequestContext, @Query() query: unknown) {
    return this.catalog.listProducts(ctx, parse(productListQuery, query));
  }

  /** Categorias já usadas, para sugerir no cadastro (F8-02). */
  @Get('products/categories')
  @RequirePermission('catalog.read')
  categories(@Ctx() ctx: RequestContext) {
    return this.catalog.categories(ctx);
  }

  @Get('products/:id')
  @RequirePermission('catalog.read')
  getProduct(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.catalog.getProduct(ctx, id);
  }

  @Post('products')
  @RequirePermission('catalog.write')
  createProduct(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.catalog.createProduct(ctx, parse(productInput, body));
  }

  @Put('products/:id')
  @RequirePermission('catalog.write')
  updateProduct(
    @Ctx() ctx: RequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.catalog.updateProduct(ctx, id, parse(productInput, body));
  }

  @Get('units')
  @RequirePermission('catalog.read')
  listUnits(@Ctx() ctx: RequestContext) {
    return this.catalog.listUnits(ctx);
  }

  @Post('units')
  @RequirePermission('catalog.write')
  createUnit(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.catalog.createUnit(ctx, parse(unitInput, body));
  }

  @Get('fiscal-profiles')
  @RequirePermission('catalog.read')
  listFiscalProfiles(@Ctx() ctx: RequestContext) {
    return this.catalog.listFiscalProfiles(ctx);
  }

  @Post('fiscal-profiles')
  @RequirePermission('fiscal.profile.write')
  createFiscalProfile(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.catalog.saveFiscalProfile(ctx, null, parse(fiscalProfileInput, body));
  }

  @Put('fiscal-profiles/:id')
  @RequirePermission('fiscal.profile.write')
  updateFiscalProfile(
    @Ctx() ctx: RequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.catalog.saveFiscalProfile(ctx, id, parse(fiscalProfileInput, body));
  }

  @Get('price-tables')
  @RequirePermission('catalog.read')
  listPriceTables(@Ctx() ctx: RequestContext) {
    return this.catalog.listPriceTables(ctx);
  }

  @Post('price-tables')
  @RequirePermission('catalog.price.write')
  createPriceTable(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.catalog.savePriceTable(ctx, null, parse(priceTableInput, body));
  }

  @Put('price-tables/:id')
  @RequirePermission('catalog.price.write')
  updatePriceTable(
    @Ctx() ctx: RequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.catalog.savePriceTable(ctx, id, parse(priceTableInput, body));
  }
}
