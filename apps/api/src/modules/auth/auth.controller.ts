import { Body, Controller, Get, HttpCode, Headers, Inject, Post } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import { loginInput, refreshInput, signupInput } from '@bipae/domain';
import { z } from 'zod';
import { Ctx, Public, type RequestContext } from '../../common/auth';
import { parse } from '../../common/errors';
import { AuthService } from './auth.service';

/** Brute-force protection on credential endpoints: per IP, max from LOGIN_RATE_LIMIT_PER_MINUTE (app.ts). */
const LOGIN_RATE_LIMIT = { rateLimit: { timeWindow: '1 minute' } };

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Public()
  @Post('signup')
  @RouteConfig(LOGIN_RATE_LIMIT)
  signup(@Body() body: unknown, @Headers('user-agent') userAgent?: string) {
    return this.auth.signup(parse(signupInput, body), userAgent);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @RouteConfig(LOGIN_RATE_LIMIT)
  login(@Body() body: unknown, @Headers('user-agent') userAgent?: string) {
    return this.auth.login(parse(loginInput, body), userAgent);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() body: unknown, @Headers('user-agent') userAgent?: string) {
    return this.auth.refresh(parse(refreshInput, body).refreshToken, userAgent);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Body() body: unknown) {
    await this.auth.logout(parse(refreshInput, body).refreshToken);
  }

  @Post('switch-tenant')
  @HttpCode(200)
  switchTenant(
    @Ctx() ctx: RequestContext,
    @Body() body: unknown,
    @Headers('user-agent') userAgent?: string,
  ) {
    const { tenantId } = parse(z.object({ tenantId: z.string().uuid() }), body);
    return this.auth.switchTenant(ctx.userId, tenantId, userAgent);
  }

  @Post('authorize')
  @HttpCode(200)
  @RouteConfig(LOGIN_RATE_LIMIT)
  authorize(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const input = parse(
      z.object({
        email: z.string().trim().toLowerCase().email('E-mail inválido'),
        password: z.string().min(1, 'Informe a senha'),
        permission: z.enum(['pos.discount.above_limit', 'pos.sale.cancel', 'pos.cash.withdrawal']),
      }),
      body,
    );
    return this.auth.authorize(ctx.tenantId, input.email, input.password, input.permission);
  }

  @Get('me')
  async me(@Ctx() ctx: RequestContext) {
    const me = await this.auth.me(ctx.tenantId, ctx.userId, ctx.permissions);
    return ctx.impersonatedBy ? { ...me, support: { readOnly: Boolean(ctx.readOnly) } } : me;
  }
}
