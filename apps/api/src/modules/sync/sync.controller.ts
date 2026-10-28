import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { syncPushInput } from '@bipae/domain';
import { z } from 'zod';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { AppError, parse } from '../../common/errors';
import { SyncService } from './sync.service';

const pullQuery = z.object({
  cursor: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
  /** Versão de preços que o caixa já tem (F1-03); o retrato só é reenviado quando muda. */
  pricingVersion: z.string().max(64).optional(),
  /** Versão dos dados fiscais que o caixa já tem (F3-06); mesma ideia. */
  fiscalVersion: z.string().max(64).optional(),
});

@Controller('sync')
export class SyncController {
  constructor(@Inject(SyncService) private readonly sync: SyncService) {}

  /** Never blocked by the minimum-version policy: pending sales are always accepted. */
  @Post('events')
  @HttpCode(200)
  @RequirePermission('pos.sell')
  push(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const input = parse(syncPushInput, body);
    if (ctx.terminalId && ctx.terminalId !== input.terminalId) {
      throw new AppError(
        400,
        'terminal_mismatch',
        'O caixa informado não confere com este aparelho.',
      );
    }
    return this.sync.push(ctx, input.terminalId, input.events);
  }

  @Get('pull')
  @RequirePermission('pos.sell')
  pull(@Ctx() ctx: RequestContext, @Query() query: unknown) {
    const { cursor, limit, pricingVersion, fiscalVersion } = parse(pullQuery, query);
    return this.sync.pull(ctx, cursor, limit, pricingVersion, fiscalVersion);
  }

  /** Eventos de caixa que não entraram (PIE ACH-04): o dono vê e manda processar de novo. */
  @Get('quarantine')
  @RequirePermission('admin.terminals')
  quarantine(@Ctx() ctx: RequestContext) {
    return this.sync.quarantine(ctx);
  }

  @Post('quarantine/:id/retry')
  @HttpCode(200)
  @RequirePermission('admin.terminals')
  retry(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.sync.retryQuarantined(ctx, id);
  }

  @Get('status/:terminalId')
  @RequirePermission('pos.sell')
  status(@Ctx() ctx: RequestContext, @Param('terminalId', new ParseUUIDPipe()) terminalId: string) {
    return this.sync.status(ctx, terminalId);
  }
}
