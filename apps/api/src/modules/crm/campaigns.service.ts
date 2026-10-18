import { Body, Controller, Get, Inject, Injectable, Post } from '@nestjs/common';
import {
  CAMPAIGN_BODY_MAX,
  CAMPAIGN_SUBJECT_MAX,
  CRM_SEGMENTS,
  uuidv7,
  type CrmSegment,
  type EmailCampaignView,
} from '@bipae/domain';
import { createHash, randomBytes } from 'node:crypto';
import { desc, sql } from 'drizzle-orm';
import { z } from 'zod';
import { Ctx, Public, RequirePermission, type RequestContext } from '../../common/auth';
import { DB } from '../../common/di';
import { AppError, parse } from '../../common/errors';
import { asApp, withTenant, type Db } from '../../db/client';
import { rowsOf } from '../../db/migrate';
import { emailCampaignRecipients, emailCampaigns } from '../../db/schema';
import { AuditService } from '../audit/audit.service';
import { MailService, mailBody } from '../mail/mail.service';
import { CrmService } from './crm.service';

const campaignInput = z.object({
  name: z.string().trim().min(1, 'Dê um nome à campanha.').max(80),
  subject: z
    .string()
    .trim()
    .min(1, 'Escreva o assunto do e-mail.')
    .max(CAMPAIGN_SUBJECT_MAX, `O assunto vai até ${CAMPAIGN_SUBJECT_MAX} caracteres.`),
  body: z
    .string()
    .trim()
    .min(1, 'Escreva o texto do e-mail.')
    .max(CAMPAIGN_BODY_MAX, `O texto vai até ${CAMPAIGN_BODY_MAX} caracteres.`),
  segment: z.enum(CRM_SEGMENTS).nullable().default(null),
});

const unsubscribeInput = z.object({ token: z.string().min(20).max(100) });

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Campanhas por e-mail (F6-08.c, LGPD): o destinatário sai da lista de quem aceitou ofertas
 * (`CrmService`), nunca de outro lugar. Cada e-mail leva um link de descadastro próprio, que tira o
 * consentimento sem pedir login. Sem o provedor de e-mail (E11), a tela mostra "falta configurar".
 */
@Injectable()
export class CampaignsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(CrmService) private readonly crm: CrmService,
  ) {}

  list(ctx: RequestContext): Promise<{ emailEnabled: boolean; items: EmailCampaignView[] }> {
    return withTenant(this.db, ctx, async (tx) => {
      const rows = await tx
        .select({
          campaign: emailCampaigns,
          unsubscribed: sql<number>`(select count(*) from email_campaign_recipients r
            where r.campaign_id = email_campaigns.id and r.unsubscribed_at is not null)`,
        })
        .from(emailCampaigns)
        .orderBy(desc(emailCampaigns.createdAt))
        .limit(100);
      return {
        emailEnabled: this.mail.enabled,
        items: rows.map(({ campaign: c, unsubscribed }) => ({
          id: c.id,
          name: c.name,
          subject: c.subject,
          body: c.body,
          segment: (c.segment as CrmSegment | null) ?? null,
          recipients: c.recipients,
          unsubscribed: Number(unsubscribed),
          createdAt: c.createdAt.toISOString(),
        })),
      };
    });
  }

  async send(ctx: RequestContext, body: unknown, now = new Date()) {
    const input = parse(campaignInput, body);
    if (!this.mail.enabled) {
      throw new AppError(
        503,
        'mail_disabled',
        'O envio de e-mails ainda não está ligado no Bipaê. Falta configurar o provedor.',
      );
    }
    const { campaignId, messages } = await withTenant(this.db, ctx, async (tx) => {
      const people = (
        await this.crm.consentingRows(tx, ctx, input.segment ?? undefined, now)
      ).filter((r): r is typeof r & { email: string } => !!r.email);
      if (people.length === 0) {
        throw new AppError(
          400,
          'no_recipients',
          'Ninguém deste segmento aceitou receber ofertas por e-mail.',
        );
      }
      const campaignId = uuidv7();
      await tx.insert(emailCampaigns).values({
        id: campaignId,
        tenantId: ctx.tenantId,
        name: input.name,
        subject: input.subject,
        body: input.body,
        segment: input.segment,
        recipients: people.length,
        createdBy: ctx.userId,
      });
      const messages = people.map((p) => ({
        person: p,
        token: randomBytes(24).toString('base64url'),
      }));
      for (let i = 0; i < messages.length; i += 500) {
        await tx.insert(emailCampaignRecipients).values(
          messages.slice(i, i + 500).map(({ person, token }) => ({
            id: uuidv7(),
            tenantId: ctx.tenantId,
            campaignId,
            customerId: person.customerId,
            email: person.email,
            unsubscribeTokenHash: hashToken(token),
          })),
        );
      }
      await this.audit.record(tx, ctx, {
        action: 'crm.campaign_sent',
        entity: 'email_campaign',
        entityId: campaignId,
        data: { segment: input.segment ?? 'todos', recipients: people.length },
      });
      return { campaignId, messages };
    });
    // Depois de gravar: cada e-mail vai pela fila, com nova tentativa.
    const paragraphs = input.body
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);
    for (const { person, token } of messages) {
      const unsubscribe = this.mail.link(`/descadastro?codigo=${token}`);
      const content = mailBody({
        greeting: `Olá, ${person.name.split(' ')[0]}!`,
        paragraphs,
        footer: `Você recebe este e-mail porque aceitou receber ofertas. Para não receber mais: ${unsubscribe}`,
      });
      await this.mail.send({
        to: person.email,
        subject: input.subject,
        ...content,
        // O link abre a página de descadastro (a pessoa confirma com um clique).
        headers: { 'List-Unsubscribe': `<${unsubscribe}>` },
      });
    }
    return { id: campaignId, recipients: messages.length };
  }

  async unsubscribe(body: unknown) {
    const { token } = parse(unsubscribeInput, body);
    const [done] = await asApp(this.db, async (tx) =>
      rowsOf<{ tenant_name: string }>(
        await tx.execute(sql`select * from crm_unsubscribe(${hashToken(token)})`),
      ),
    );
    if (!done) {
      throw new AppError(400, 'invalid_unsubscribe', 'Este link de descadastro não vale.');
    }
    return {
      message: `Pronto: você não recebe mais ofertas de ${done.tenant_name} por e-mail.`,
    };
  }
}

@Controller('crm/campaigns')
export class CampaignsController {
  constructor(@Inject(CampaignsService) private readonly campaigns: CampaignsService) {}

  @Get()
  @RequirePermission('crm.export')
  list(@Ctx() ctx: RequestContext) {
    return this.campaigns.list(ctx);
  }

  @Post()
  @RequirePermission('crm.export')
  send(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.campaigns.send(ctx, body);
  }

  @Public()
  @Post('unsubscribe')
  unsubscribe(@Body() body: unknown) {
    return this.campaigns.unsubscribe(body);
  }
}
