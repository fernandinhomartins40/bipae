import { Body, Controller, Get, HttpCode, Headers, Inject, Param, Post } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import {
  inviteAcceptInput,
  emailVerifyInput,
  loginInput,
  passwordForgotInput,
  passwordResetInput,
  refreshInput,
  signupInput,
  totpCodeInput,
} from '@bipae/domain';
import { z } from 'zod';
import { Ctx, Public, type RequestContext } from '../../common/auth';
import { AppError, parse } from '../../common/errors';
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
  @Post('email/verify')
  @HttpCode(200)
  @RouteConfig(LOGIN_RATE_LIMIT)
  verifyEmail(@Body() body: unknown) {
    return this.auth.verifyEmail(parse(emailVerifyInput, body).token);
  }

  @Post('email/resend')
  @HttpCode(202)
  @RouteConfig(LOGIN_RATE_LIMIT)
  resendEmail(@Ctx() ctx: RequestContext) {
    return this.auth.resendEmailVerification(ctx.tenantId, ctx.userId);
  }

  @Public()
  @Post('password/forgot')
  @HttpCode(202)
  @RouteConfig(LOGIN_RATE_LIMIT)
  forgot(@Body() body: unknown) {
    return this.auth.forgotPassword(parse(passwordForgotInput, body).email);
  }

  @Public()
  @Post('password/reset')
  @HttpCode(200)
  @RouteConfig(LOGIN_RATE_LIMIT)
  reset(@Body() body: unknown) {
    const input = parse(passwordResetInput, body);
    return this.auth.resetPassword(input.token, input.password);
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

  /** Troca de operador no caixa (F2-03): confere a senha de quem entra e devolve as permissões. */
  @Post('operator')
  @HttpCode(200)
  @RouteConfig(LOGIN_RATE_LIMIT)
  operator(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const input = parse(
      z.object({
        email: z.string().trim().toLowerCase().email('E-mail inválido'),
        password: z.string().min(1, 'Informe a senha'),
      }),
      body,
    );
    return this.auth.operator(ctx.tenantId, input.email, input.password);
  }

  // Convite por link (F1-06): quem abre o link ainda não tem sessão.
  @Public()
  @Get('invites/:token')
  inviteInfo(@Param('token') token: string) {
    return this.auth.inviteInfo(token);
  }

  @Public()
  @Post('invites/:token/accept')
  @HttpCode(200)
  @RouteConfig(LOGIN_RATE_LIMIT)
  acceptInvite(
    @Param('token') token: string,
    @Body() body: unknown,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.auth.acceptInvite(token, parse(inviteAcceptInput, body), userAgent);
  }

  // Verificação em duas etapas do próprio usuário (F1-01). Não vale em sessão de suporte.
  @Get('totp')
  totpStatus(@Ctx() ctx: RequestContext) {
    return this.auth.totpStatus(ctx.tenantId, ctx.userId);
  }

  @Post('totp/setup')
  @HttpCode(200)
  totpSetup(@Ctx() ctx: RequestContext) {
    this.ownerOnly(ctx);
    return this.auth.totpSetup(ctx.tenantId, ctx.userId);
  }

  @Post('totp/enable')
  @HttpCode(200)
  @RouteConfig(LOGIN_RATE_LIMIT)
  totpEnable(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    this.ownerOnly(ctx);
    return this.auth.totpEnable(ctx.tenantId, ctx.userId, parse(totpCodeInput, body).code);
  }

  @Post('totp/disable')
  @HttpCode(200)
  @RouteConfig(LOGIN_RATE_LIMIT)
  totpDisable(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    this.ownerOnly(ctx);
    return this.auth.totpDisable(ctx.tenantId, ctx.userId, parse(totpCodeInput, body).code);
  }

  /** Only the person themselves changes their 2FA, never Bipaê support acting as them. */
  private ownerOnly(ctx: RequestContext) {
    if (ctx.impersonatedBy) {
      throw new AppError(
        403,
        'forbidden',
        'O suporte Bipaê não pode mudar a verificação em duas etapas do cliente.',
      );
    }
  }

  @Get('me')
  async me(@Ctx() ctx: RequestContext) {
    const me = await this.auth.me(ctx.tenantId, ctx.userId, ctx.permissions);
    return ctx.impersonatedBy ? { ...me, support: { readOnly: Boolean(ctx.readOnly) } } : me;
  }
}
