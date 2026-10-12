import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  adminCreateTenantInput,
  announcementInput,
  changePlanInput,
  impersonateInput,
  limitOverridesInput,
  noteInput,
  planInput,
  platformAdminInput,
  PLATFORM_ROLES,
  statusChangeInput,
  TENANT_STATUSES,
} from '@bipae/domain';
import { z } from 'zod';
import { Public } from '../../common/auth';
import { parse } from '../../common/errors';
import { AdminPlatformService } from './admin-platform.service';
import { AdminTenantsService } from './admin-tenants.service';
import { PlatformAuditService } from './platform-audit.service';
import { Admin, PlatformGuard, PlatformPermission, type AdminContext } from './platform.guard';

const page = {
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
};
const tenantQuery = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(TENANT_STATUSES).optional(),
  planId: z.string().max(40).optional(),
  ...page,
});
const auditQuery = z.object({ tenantId: z.string().uuid().optional(), actorId: z.string().uuid().optional(), ...page });
const adminUpdate = z
  .object({ role: z.enum(PLATFORM_ROLES).optional(), active: z.boolean().optional() })
  .refine((v) => v.role !== undefined || v.active !== undefined, 'Nada para alterar.');

/** Super admin panel API. Client tokens never pass PlatformGuard (different audience). */
@Public()
@UseGuards(PlatformGuard)
@Controller('admin')
export class AdminController {
  constructor(
    @Inject(AdminTenantsService) private readonly tenants: AdminTenantsService,
    @Inject(AdminPlatformService) private readonly platform: AdminPlatformService,
    @Inject(PlatformAuditService) private readonly audit: PlatformAuditService,
  ) {}

  @Get('dashboard')
  @PlatformPermission('platform.read')
  dashboard() {
    return this.tenants.dashboard();
  }

  // ---------------------------------------------------------------- clients

  @Get('tenants')
  @PlatformPermission('platform.read')
  listTenants(@Query() query: unknown) {
    return this.tenants.list(parse(tenantQuery, query));
  }

  @Post('tenants')
  @PlatformPermission('platform.tenants.create')
  createTenant(@Admin() admin: AdminContext, @Body() body: unknown) {
    return this.tenants.create(admin, parse(adminCreateTenantInput, body));
  }

  @Get('tenants/:id')
  @PlatformPermission('platform.read')
  tenant(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.tenants.detail(id);
  }

  @Post('tenants/:id/plan')
  @HttpCode(200)
  @PlatformPermission('platform.tenants.manage')
  changePlan(@Admin() admin: AdminContext, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.tenants.changePlan(admin, id, parse(changePlanInput, body));
  }

  @Post('tenants/:id/suspend')
  @HttpCode(200)
  @PlatformPermission('platform.tenants.manage')
  suspend(@Admin() admin: AdminContext, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.tenants.setStatus(admin, id, 'suspended', parse(statusChangeInput, body).reason);
  }

  @Post('tenants/:id/reactivate')
  @HttpCode(200)
  @PlatformPermission('platform.tenants.manage')
  reactivate(@Admin() admin: AdminContext, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.tenants.setStatus(admin, id, 'active', parse(statusChangeInput, body).reason);
  }

  @Post('tenants/:id/cancel')
  @HttpCode(200)
  @PlatformPermission('platform.tenants.manage')
  cancel(@Admin() admin: AdminContext, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.tenants.setStatus(admin, id, 'cancelled', parse(statusChangeInput, body).reason);
  }

  @Post('tenants/:id/limits')
  @HttpCode(200)
  @PlatformPermission('platform.tenants.manage')
  limits(@Admin() admin: AdminContext, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    const input = parse(limitOverridesInput, body);
    return this.tenants.setLimits(admin, id, input.overrides, input.reason);
  }

  @Post('tenants/:id/notes')
  @PlatformPermission('platform.notes')
  note(@Admin() admin: AdminContext, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.tenants.addNote(admin, id, parse(noteInput, body).note);
  }

  @Post('tenants/:id/impersonate')
  @HttpCode(200)
  @PlatformPermission('platform.support')
  impersonate(@Admin() admin: AdminContext, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.tenants.impersonate(admin, id, parse(impersonateInput, body));
  }

  @Post('tenants/:id/users/:userId/revoke-sessions')
  @HttpCode(200)
  @PlatformPermission('platform.tenants.manage')
  revokeTenantUser(
    @Admin() admin: AdminContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ) {
    return this.tenants.revokeUserSessions(admin, id, userId);
  }

  // ---------------------------------------------------------------- people

  @Get('users')
  @PlatformPermission('platform.read')
  users(@Query() query: unknown) {
    return this.platform.searchUsers(parse(z.object({ q: z.string().trim().min(2, 'Digite pelo menos 2 letras').max(120) }), query).q);
  }

  @Post('users/:userId/revoke-sessions')
  @HttpCode(200)
  @PlatformPermission('platform.tenants.manage')
  revokeUser(@Admin() admin: AdminContext, @Param('userId', new ParseUUIDPipe()) userId: string) {
    return this.platform.revokeAllSessions(admin, userId);
  }

  // ---------------------------------------------------------------- plans

  @Get('plans')
  @PlatformPermission('platform.read')
  plans() {
    return this.platform.listPlans();
  }

  @Post('plans')
  @PlatformPermission('platform.plans.manage')
  createPlan(@Admin() admin: AdminContext, @Body() body: unknown) {
    return this.platform.savePlan(admin, parse(planInput, body), true);
  }

  @Put('plans/:id')
  @PlatformPermission('platform.plans.manage')
  updatePlan(@Admin() admin: AdminContext, @Param('id') id: string, @Body() body: unknown) {
    return this.platform.savePlan(admin, parse(planInput, { ...(body as object), id }), false);
  }

  // ---------------------------------------------------------------- announcements

  @Get('announcements')
  @PlatformPermission('platform.read')
  announcements() {
    return this.platform.listAnnouncements();
  }

  @Post('announcements')
  @PlatformPermission('platform.announcements.manage')
  createAnnouncement(@Admin() admin: AdminContext, @Body() body: unknown) {
    return this.platform.saveAnnouncement(admin, null, parse(announcementInput, body));
  }

  @Put('announcements/:id')
  @PlatformPermission('platform.announcements.manage')
  updateAnnouncement(@Admin() admin: AdminContext, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.platform.saveAnnouncement(admin, id, parse(announcementInput, body));
  }

  @Post('announcements/:id/end')
  @HttpCode(200)
  @PlatformPermission('platform.announcements.manage')
  endAnnouncement(@Admin() admin: AdminContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.platform.endAnnouncement(admin, id);
  }

  // ---------------------------------------------------------------- Bipaê team

  @Get('admins')
  @PlatformPermission('platform.read')
  admins() {
    return this.platform.listAdmins();
  }

  @Post('admins')
  @PlatformPermission('platform.admins.manage')
  addAdmin(@Admin() admin: AdminContext, @Body() body: unknown) {
    const input = parse(platformAdminInput, body);
    return this.platform.addAdmin(admin, input.email, input.role);
  }

  @Patch('admins/:userId')
  @PlatformPermission('platform.admins.manage')
  updateAdmin(@Admin() admin: AdminContext, @Param('userId', new ParseUUIDPipe()) userId: string, @Body() body: unknown) {
    return this.platform.updateAdmin(admin, userId, parse(adminUpdate, body));
  }

  @Post('admins/:userId/reset-totp')
  @HttpCode(200)
  @PlatformPermission('platform.admins.manage')
  resetTotp(@Admin() admin: AdminContext, @Param('userId', new ParseUUIDPipe()) userId: string) {
    return this.platform.resetAdminTotp(admin, userId);
  }

  // ---------------------------------------------------------------- audit and system

  @Get('audit')
  @PlatformPermission('platform.read')
  listAudit(@Query() query: unknown) {
    return this.audit.list(parse(auditQuery, query));
  }

  @Get('audit/verify')
  @PlatformPermission('platform.read')
  verifyAudit() {
    return this.audit.verify();
  }

  @Get('system')
  @PlatformPermission('platform.read')
  system() {
    return this.platform.system();
  }
}
