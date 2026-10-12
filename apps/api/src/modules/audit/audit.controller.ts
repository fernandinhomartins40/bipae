import { Controller, Get, Inject, Query } from '@nestjs/common';
import { listQuery } from '@bipae/domain';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { parse } from '../../common/errors';
import { AuditService } from './audit.service';

@Controller('audit')
export class AuditController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @Get()
  @RequirePermission('audit.read')
  list(@Ctx() ctx: RequestContext, @Query() query: unknown) {
    const { limit, offset } = parse(listQuery, query);
    return this.audit.list(ctx, limit, offset);
  }

  @Get('verify')
  @RequirePermission('audit.read')
  verify(@Ctx() ctx: RequestContext) {
    return this.audit.verify(ctx);
  }
}
