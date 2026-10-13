import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { inviteUserInput, roleInput } from '@bipae/domain';
import { z } from 'zod';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { parse } from '../../common/errors';
import { TeamService } from './team.service';

const memberUpdate = z
  .object({
    roleId: z.string().uuid().optional(),
    active: z.boolean().optional(),
    /** Lojas que a pessoa pode usar (F1-05); null = todas as lojas. */
    storeIds: z.array(z.string().uuid()).max(500).nullable().optional(),
  })
  .refine(
    (v) => v.roleId !== undefined || v.active !== undefined || v.storeIds !== undefined,
    'Nada para alterar.',
  );

@Controller()
export class TeamController {
  constructor(@Inject(TeamService) private readonly team: TeamService) {}

  @Get('roles')
  @RequirePermission('admin.users')
  listRoles(@Ctx() ctx: RequestContext) {
    return this.team.listRoles(ctx);
  }

  @Post('roles')
  @RequirePermission('admin.users')
  createRole(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.team.createRole(ctx, parse(roleInput, body));
  }

  @Patch('roles/:id')
  @RequirePermission('admin.users')
  updateRole(
    @Ctx() ctx: RequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.team.updateRole(ctx, id, parse(roleInput, body));
  }

  @Get('members')
  @RequirePermission('admin.users')
  listMembers(@Ctx() ctx: RequestContext) {
    return this.team.listMembers(ctx);
  }

  @Post('members')
  @RequirePermission('admin.users')
  addMember(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.team.addMember(ctx, parse(inviteUserInput, body));
  }

  @Patch('members/:userId')
  @RequirePermission('admin.users')
  updateMember(
    @Ctx() ctx: RequestContext,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() body: unknown,
  ) {
    return this.team.updateMember(ctx, userId, parse(memberUpdate, body));
  }
}
