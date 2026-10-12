import { Body, Controller, Get, Headers, HttpCode, Inject, Ip, Post, UseGuards } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import { adminLoginInput, refreshInput, totpCodeInput } from '@bipae/domain';
import { Public } from '../../common/auth';
import { parse } from '../../common/errors';
import { AdminAuthService } from './admin-auth.service';
import { Admin, AllowWithoutMfa, PlatformGuard, type AdminContext } from './platform.guard';

const RATE_LIMIT = { rateLimit: { timeWindow: '1 minute' } };

/** Bipaê staff sign-in. Separate from the client login: own session, own token audience. */
@Public()
@Controller('admin/auth')
export class AdminAuthController {
  constructor(@Inject(AdminAuthService) private readonly auth: AdminAuthService) {}

  @Post('login')
  @HttpCode(200)
  @RouteConfig(RATE_LIMIT)
  login(@Body() body: unknown, @Ip() ip: string, @Headers('user-agent') userAgent?: string) {
    const input = parse(adminLoginInput, body);
    return this.auth.login(input.email, input.password, input.totp, { ip, ...(userAgent && { userAgent }) });
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() body: unknown, @Ip() ip: string, @Headers('user-agent') userAgent?: string) {
    return this.auth.refresh(parse(refreshInput, body).refreshToken, { ip, ...(userAgent && { userAgent }) });
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Body() body: unknown) {
    await this.auth.logout(parse(refreshInput, body).refreshToken);
  }

  @Get('me')
  @UseGuards(PlatformGuard)
  @AllowWithoutMfa()
  me(@Admin() admin: AdminContext) {
    return this.auth.me(admin.userId);
  }

  @Post('totp/setup')
  @HttpCode(200)
  @UseGuards(PlatformGuard)
  @AllowWithoutMfa()
  totpSetup(@Admin() admin: AdminContext) {
    return this.auth.totpSetup(admin.userId, admin.ip);
  }

  @Post('totp/enable')
  @HttpCode(200)
  @UseGuards(PlatformGuard)
  @AllowWithoutMfa()
  @RouteConfig(RATE_LIMIT)
  totpEnable(@Admin() admin: AdminContext, @Body() body: unknown, @Headers('user-agent') userAgent?: string) {
    return this.auth.totpEnable(admin.userId, parse(totpCodeInput, body).code, {
      ip: admin.ip,
      ...(userAgent && { userAgent }),
    });
  }
}
