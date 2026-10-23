import { createHash } from 'node:crypto';
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Injectable,
  Param,
  ParseUUIDPipe,
  Put,
  Res,
  StreamableFile,
} from '@nestjs/common';
import {
  PRODUCT_IMAGE_MAX_BYTES,
  productImageInput,
  sniffImageType,
  type ProductImageInput,
} from '@bipae/domain';
import { eq, sql } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { DB } from '../../common/di';
import { AppError, notFound, parse } from '../../common/errors';
import { withTenant, type Db } from '../../db/client';
import { productImages, products } from '../../db/schema';
import { AuditService } from '../audit/audit.service';

/** A foto muda de endereço quando muda de conteúdo: pode ficar no cache do navegador por um ano. */
const IMAGE_CACHE = 'private, max-age=31536000, immutable';

/**
 * Foto do produto (F2-14). Uma por produto, guardada no PostgreSQL (a API não tem armazenamento
 * de arquivos à parte). Trocar ou tirar a foto muda o `updated_at` do produto, então a próxima
 * sincronização leva o hash novo ao caixa.
 */
@Injectable()
export class ProductImagesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async save(ctx: RequestContext, productId: string, input: ProductImageInput) {
    const bytes = new Uint8Array(Buffer.from(input.data, 'base64'));
    if (bytes.length === 0 || bytes.length > PRODUCT_IMAGE_MAX_BYTES) {
      throw new AppError(422, 'invalid_image', 'A foto precisa ter até 200 KB.');
    }
    const kind = sniffImageType(bytes);
    if (!kind) {
      throw new AppError(
        422,
        'invalid_image',
        'Esse arquivo não é uma foto. Envie WebP, JPEG ou PNG.',
      );
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    return withTenant(this.db, ctx, async (tx) => {
      const [product] = await tx
        .select({ id: products.id, name: products.name, previous: products.imageSha256 })
        .from(products)
        .where(eq(products.id, productId));
      if (!product) throw notFound('Produto');
      await tx
        .insert(productImages)
        .values({ productId, tenantId: ctx.tenantId, contentType: kind, bytes, sha256 })
        .onConflictDoUpdate({
          target: productImages.productId,
          set: { contentType: kind, bytes, sha256, updatedAt: sql`now()` },
        });
      await tx
        .update(products)
        .set({ imageSha256: sha256, updatedAt: sql`now()` })
        .where(eq(products.id, productId));
      await this.audit.record(tx, ctx, {
        action: 'product.image_saved',
        entity: 'product',
        entityId: productId,
        data: {
          name: product.name,
          contentType: kind,
          bytes: bytes.length,
          sha256,
          previous: product.previous,
        },
      });
      return { imageHash: sha256 };
    });
  }

  async remove(ctx: RequestContext, productId: string) {
    await withTenant(this.db, ctx, async (tx) => {
      const [product] = await tx
        .select({ name: products.name, previous: products.imageSha256 })
        .from(products)
        .where(eq(products.id, productId));
      if (!product) throw notFound('Produto');
      if (!product.previous) return;
      await tx.delete(productImages).where(eq(productImages.productId, productId));
      await tx
        .update(products)
        .set({ imageSha256: null, updatedAt: sql`now()` })
        .where(eq(products.id, productId));
      await this.audit.record(tx, ctx, {
        action: 'product.image_removed',
        entity: 'product',
        entityId: productId,
        data: { name: product.name, previous: product.previous },
      });
    });
  }

  async read(ctx: RequestContext, productId: string) {
    return withTenant(this.db, ctx, async (tx) => {
      const [row] = await tx
        .select({
          contentType: productImages.contentType,
          bytes: productImages.bytes,
          sha256: productImages.sha256,
        })
        .from(productImages)
        .where(eq(productImages.productId, productId));
      if (!row) throw new AppError(404, 'not_found', 'Este produto não tem foto.');
      return row;
    });
  }
}

@Controller('products/:id/image')
export class ProductImagesController {
  constructor(@Inject(ProductImagesService) private readonly images: ProductImagesService) {}

  @Put()
  @RequirePermission('catalog.write')
  save(
    @Ctx() ctx: RequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.images.save(ctx, id, parse(productImageInput, body));
  }

  @Delete()
  @HttpCode(204)
  @RequirePermission('catalog.write')
  async remove(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.images.remove(ctx, id);
  }

  /** A foto em si, com ETag pelo hash: quem já tem a foto recebe 304 sem os bytes. */
  @Get()
  @RequirePermission('catalog.read')
  async read(
    @Ctx() ctx: RequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const image = await this.images.read(ctx, id);
    const etag = `"${image.sha256}"`;
    reply.header('etag', etag);
    reply.header('cache-control', IMAGE_CACHE);
    if (ifNoneMatch?.split(',').some((tag) => tag.trim().replace(/^W\//, '') === etag)) {
      reply.status(304);
      return;
    }
    reply.header('content-type', image.contentType);
    return new StreamableFile(Buffer.from(image.bytes));
  }
}
