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
import { withTenant, type Db, type Tx } from '../../db/client';
import { productImages, products } from '../../db/schema';
import { FILE_STORAGE, type FileStorage } from '../../common/storage';
import { AuditService } from '../audit/audit.service';

/** A foto muda de endereço quando muda de conteúdo: pode ficar no cache do navegador por um ano. */
const IMAGE_CACHE = 'private, max-age=31536000, immutable';

/**
 * Foto do produto (F2-14). Uma por produto. Sem driver de armazenamento (padrão), os bytes ficam no
 * PostgreSQL; com `STORAGE_DRIVER=disk|s3` (F1-08) ficam no armazenamento de arquivos e a linha
 * guarda só a chave. O banco segue como fonte do hash e do tipo nos dois casos. Trocar ou tirar a foto muda o `updated_at` do produto, então a próxima
 * sincronização leva o hash novo ao caixa.
 */
@Injectable()
export class ProductImagesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage | null,
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
    const storageKey = this.storage ? `${ctx.tenantId}/products/${productId}.${sha256}` : null;
    let previousKey: string | null = null;
    try {
      const result = await withTenant(this.db, ctx, async (tx) => {
        const [product] = await tx
          .select({ id: products.id, name: products.name, previous: products.imageSha256 })
          .from(products)
          .where(eq(products.id, productId));
        if (!product) throw notFound('Produto');
        const [old] = await tx
          .select({ key: productImages.storageKey })
          .from(productImages)
          .where(eq(productImages.productId, productId));
        previousKey = old?.key ?? null;
        // O arquivo vai antes da linha: se o banco falhar, sobra um arquivo solto, nunca uma
        // linha apontando para o nada.
        if (this.storage && storageKey) await this.storage.put(storageKey, bytes, kind);
        return this.persist(tx, ctx, productId, product, {
          kind,
          bytes: storageKey ? null : bytes,
          storageKey,
          sha256,
          size: bytes.length,
        });
      });
      if (this.storage && previousKey && previousKey !== storageKey) {
        await this.storage.delete(previousKey).catch(() => undefined);
      }
      return result;
    } catch (e) {
      if (this.storage && storageKey && storageKey !== previousKey) {
        await this.storage.delete(storageKey).catch(() => undefined);
      }
      throw e;
    }
  }

  private async persist(
    tx: Tx,
    ctx: RequestContext,
    productId: string,
    product: { name: string; previous: string | null },
    image: {
      kind: string;
      bytes: Uint8Array | null;
      storageKey: string | null;
      sha256: string;
      size: number;
    },
  ) {
    const { kind, bytes, storageKey, sha256 } = image;
    {
      await tx
        .insert(productImages)
        .values({ productId, tenantId: ctx.tenantId, contentType: kind, bytes, storageKey, sha256 })
        .onConflictDoUpdate({
          target: productImages.productId,
          set: { contentType: kind, bytes, storageKey, sha256, updatedAt: sql`now()` },
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
          bytes: image.size,
          storage: storageKey ? this.storage?.driver : 'db',
          sha256,
          previous: product.previous,
        },
      });
      return { imageHash: sha256 };
    }
  }

  async remove(ctx: RequestContext, productId: string) {
    let key: string | null = null;
    await withTenant(this.db, ctx, async (tx) => {
      const [product] = await tx
        .select({ name: products.name, previous: products.imageSha256 })
        .from(products)
        .where(eq(products.id, productId));
      if (!product) throw notFound('Produto');
      if (!product.previous) return;
      const [old] = await tx
        .select({ key: productImages.storageKey })
        .from(productImages)
        .where(eq(productImages.productId, productId));
      key = old?.key ?? null;
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
    if (this.storage && key) await this.storage.delete(key).catch(() => undefined);
  }

  async read(ctx: RequestContext, productId: string) {
    return withTenant(this.db, ctx, async (tx) => {
      const [row] = await tx
        .select({
          contentType: productImages.contentType,
          bytes: productImages.bytes,
          storageKey: productImages.storageKey,
          sha256: productImages.sha256,
        })
        .from(productImages)
        .where(eq(productImages.productId, productId));
      if (!row) throw new AppError(404, 'not_found', 'Este produto não tem foto.');
      const bytes =
        row.bytes ??
        (row.storageKey && this.storage ? await this.storage.get(row.storageKey) : null);
      if (!bytes) throw new AppError(404, 'not_found', 'Este produto não tem foto.');
      return { contentType: row.contentType, sha256: row.sha256, bytes };
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
