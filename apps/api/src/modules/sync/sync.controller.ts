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
      throw new AppError(400, 'terminal_mismatch', 'O caixa informado não confere com este aparelho.');
    }
    return this.sync.push(ctx, input.terminalId, input.events);
  }

  @Get('pull')
  @RequirePermission('pos.sell')
  pull(@Ctx() ctx: RequestContext, @Query() query: unknown) {
    const { cursor, limit } = parse(pullQuery, query);
    return this.sync.pull(ctx, cursor, limit);
  }

  @Get('status/:terminalId')
  @RequirePermission('pos.sell')
  status(@Ctx() ctx: RequestContext, @Param('terminalId', new ParseUUIDPipe()) terminalId: string) {
    return this.sync.status(ctx, terminalId);
  }
}
