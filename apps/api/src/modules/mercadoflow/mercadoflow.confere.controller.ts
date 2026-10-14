import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { z } from 'zod';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { parse } from '../../common/errors';
import { MercadoflowConfere } from './mercadoflow.confere';

const remoteId = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[\w-]+$/, 'Nota inválida');
const accessKey = z
  .string()
  .trim()
  .regex(/^\d{44}$/, 'A chave de acesso tem 44 números');
const checkInput = z.object({
  counts: z.record(
    z.string().regex(/^\d+$/),
    z.object({
      counted: z.number().nonnegative(),
      issue: z.enum(['AVARIA', 'VALIDADE', 'TROCADO']).optional(),
      note: z.string().trim().max(300).optional(),
    }),
  ),
  blind: z.boolean().default(true),
  finish: z.boolean().default(false),
  restart: z.boolean().optional(),
  summary: z.record(z.string(), z.number()).optional(),
});
const entryInput = z.object({
  /** Item da nota → produto do Bipaê, para os itens que não foram achados sozinhos. */
  mapping: z.record(z.string().regex(/^\d+$/), z.string().uuid()).default({}),
  /** Entrada direta pela nota, sem conferência (quando a loja escolhe). */
  direct: z.boolean().default(false),
});
const certificateInput = z.object({
  pfxBase64: z
    .string()
    .min(100, 'Escolha o arquivo do certificado (.pfx ou .p12)')
    .max(200_000)
    .regex(/^[A-Za-z0-9+/=]+$/, 'Arquivo do certificado em formato inválido'),
  password: z.string().min(1, 'Informe a senha do certificado').max(200),
  uf: z.string().trim().toUpperCase().length(2, 'Informe a UF'),
});

/**
 * Compras → Notas de entrada (Confere, seção 6 do contrato). Ler as notas pede a permissão de ver
 * o catálogo; conferir e dar entrada pedem a de cadastrar produtos; o certificado, a de
 * configuração fiscal.
 */
@Controller('mercadoflow/confere/:storeId')
export class MercadoflowConfereController {
  constructor(@Inject(MercadoflowConfere) private readonly confere: MercadoflowConfere) {}

  @Get('status')
  @RequirePermission('catalog.read')
  status(@Ctx() ctx: RequestContext, @Param('storeId', new ParseUUIDPipe()) storeId: string) {
    return this.confere.proxy(ctx, storeId, 'GET', '/status');
  }

  @Post('terms')
  @RequirePermission('catalog.write')
  terms(
    @Ctx() ctx: RequestContext,
    @Param('storeId', new ParseUUIDPipe()) storeId: string,
    @Body() body: unknown,
  ) {
    const { version } = parse(z.object({ version: z.string().trim().min(1).max(40) }), body);
    return this.confere.proxy(ctx, storeId, 'POST', '/terms', { version });
  }

  /** O certificado vai direto ao MercadoFlow: o Bipaê não guarda o arquivo nem a senha. */
  @Post('certificate')
  @RequirePermission('fiscal.profile.write')
  certificate(
    @Ctx() ctx: RequestContext,
    @Param('storeId', new ParseUUIDPipe()) storeId: string,
    @Body() body: unknown,
  ) {
    return this.confere.proxy(ctx, storeId, 'POST', '/certificate', parse(certificateInput, body));
  }

  @Delete('certificate')
  @RequirePermission('fiscal.profile.write')
  removeCertificate(
    @Ctx() ctx: RequestContext,
    @Param('storeId', new ParseUUIDPipe()) storeId: string,
  ) {
    return this.confere.proxy(ctx, storeId, 'DELETE', '/certificate', {});
  }

  @Get('documents')
  @RequirePermission('catalog.read')
  async documents(
    @Ctx() ctx: RequestContext,
    @Param('storeId', new ParseUUIDPipe()) storeId: string,
  ) {
    const [remote, local] = await Promise.all([
      this.confere.proxy(ctx, storeId, 'GET', '/documents') as Promise<{ items?: unknown[] }>,
      this.confere.entries(ctx, storeId),
    ]);
    return { items: remote?.items ?? [], entries: local };
  }

  @Get('documents/:documentId')
  @RequirePermission('catalog.read')
  document(
    @Ctx() ctx: RequestContext,
    @Param('storeId', new ParseUUIDPipe()) storeId: string,
    @Param('documentId') id: string,
  ) {
    return this.confere.proxy(ctx, storeId, 'GET', `/documents/${parse(remoteId, id)}`);
  }

  @Post('read')
  @RequirePermission('catalog.write')
  read(
    @Ctx() ctx: RequestContext,
    @Param('storeId', new ParseUUIDPipe()) storeId: string,
    @Body() body: unknown,
  ) {
    const input = parse(z.object({ accessKey }), body);
    return this.confere.proxy(ctx, storeId, 'POST', '/read', input);
  }

  @Post('upload')
  @RequirePermission('catalog.write')
  upload(
    @Ctx() ctx: RequestContext,
    @Param('storeId', new ParseUUIDPipe()) storeId: string,
    @Body() body: unknown,
  ) {
    const input = parse(
      z.object({ xml: z.string().min(50, 'Escolha o arquivo XML da nota').max(5_000_000) }),
      body,
    );
    return this.confere.proxy(ctx, storeId, 'POST', '/upload', input);
  }

  @Post('sync')
  @RequirePermission('catalog.write')
  sync(@Ctx() ctx: RequestContext, @Param('storeId', new ParseUUIDPipe()) storeId: string) {
    return this.confere.proxy(ctx, storeId, 'POST', '/sync', {});
  }

  @Get('ledger')
  @RequirePermission('catalog.read')
  ledger(@Ctx() ctx: RequestContext, @Param('storeId', new ParseUUIDPipe()) storeId: string) {
    return this.confere.proxy(ctx, storeId, 'GET', '/ledger');
  }

  /** Compra de leituras por Pix: decisão de gasto, por isso só quem gerencia as lojas. */
  @Post('orders')
  @RequirePermission('admin.stores')
  order(
    @Ctx() ctx: RequestContext,
    @Param('storeId', new ParseUUIDPipe()) storeId: string,
    @Body() body: unknown,
  ) {
    const input = parse(z.object({ planId: z.string().trim().min(1).max(80) }), body);
    return this.confere.proxy(ctx, storeId, 'POST', '/orders', input);
  }

  @Get('orders/:orderId')
  @RequirePermission('catalog.read')
  orderStatus(
    @Ctx() ctx: RequestContext,
    @Param('storeId', new ParseUUIDPipe()) storeId: string,
    @Param('orderId') id: string,
  ) {
    return this.confere.proxy(ctx, storeId, 'GET', `/orders/${parse(remoteId, id)}`);
  }

  /** Conferência: salva a cada item contado; finish conclui e devolve a entrada. */
  @Put('documents/:documentId/check')
  @RequirePermission('catalog.write')
  check(
    @Ctx() ctx: RequestContext,
    @Param('storeId', new ParseUUIDPipe()) storeId: string,
    @Param('documentId') id: string,
    @Body() body: unknown,
  ) {
    return this.confere.proxy(
      ctx,
      storeId,
      'PUT',
      `/documents/${parse(remoteId, id)}/check`,
      parse(checkInput, body),
    );
  }

  /** Dá entrada no estoque do Bipaê. */
  @Post('documents/:documentId/entry')
  @RequirePermission('catalog.write')
  entry(
    @Ctx() ctx: RequestContext,
    @Param('storeId', new ParseUUIDPipe()) storeId: string,
    @Param('documentId') id: string,
    @Body() body: unknown,
  ) {
    const input = parse(entryInput, body ?? {});
    return this.confere.enter(ctx, storeId, parse(remoteId, id), input.mapping, input.direct);
  }
}

/** Pendências com fornecedor (faltas, sobras, avarias) vindas das conferências. */
@Controller('mercadoflow/supplier-issues')
export class SupplierIssuesController {
  constructor(@Inject(MercadoflowConfere) private readonly confere: MercadoflowConfere) {}

  @Get()
  @RequirePermission('catalog.read')
  list(@Ctx() ctx: RequestContext) {
    return this.confere.issues(ctx);
  }

  @Post(':id/resolve')
  @RequirePermission('catalog.write')
  resolve(
    @Ctx() ctx: RequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    const { note } = parse(z.object({ note: z.string().trim().max(300).nullish() }), body ?? {});
    return this.confere.resolveIssue(ctx, id, note ?? null);
  }
}
