import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import type { Config } from '../../config';
import { CONFIG, QUEUE } from '../../common/di';
import type { JobQueue } from '../../common/queue';

export const MAIL_SEND_JOB = 'mail.send';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Cabeçalhos extras (ex.: List-Unsubscribe das campanhas). */
  headers?: Record<string, string>;
}

/** Quem entrega o e-mail: o SMTP do provedor (E11) ou, nos testes, a memória. */
export interface MailTransport {
  send(message: MailMessage & { from: string }): Promise<void>;
}

export class SmtpMailTransport implements MailTransport {
  private readonly smtp;
  constructor(url: string) {
    this.smtp = createTransport(url);
  }
  async send(message: MailMessage & { from: string }) {
    await this.smtp.sendMail(message);
  }
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Corpo do e-mail no jeito do Bipaê: parágrafos, um botão e o link escrito por extenso. */
export function mailBody(input: {
  greeting: string;
  paragraphs: string[];
  action?: { label: string; url: string };
  footer?: string;
}) {
  const text = [
    input.greeting,
    '',
    ...input.paragraphs.flatMap((p) => [p, '']),
    ...(input.action ? [`${input.action.label}: ${input.action.url}`, ''] : []),
    input.footer ?? 'Equipe Bipaê',
  ].join('\n');
  const html =
    `<div style="font-family:system-ui,sans-serif;font-size:16px;line-height:1.5;color:#1f2937">` +
    `<p>${escapeHtml(input.greeting)}</p>` +
    input.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('') +
    (input.action
      ? `<p><a href="${escapeHtml(input.action.url)}" style="display:inline-block;padding:12px 20px;background:#0f766e;color:#fff;border-radius:8px;text-decoration:none">${escapeHtml(input.action.label)}</a></p>` +
        `<p style="font-size:14px;color:#6b7280">Se o botão não abrir, copie o endereço: ${escapeHtml(input.action.url)}</p>`
      : '') +
    `<p>${escapeHtml(input.footer ?? 'Equipe Bipaê')}</p></div>`;
  return { text, html };
}

/**
 * E-mail transacional (P-04.a). O envio vai pela fila, com nova tentativa. Sem o provedor
 * configurado (SMTP_URL, item E11), o e-mail fica desligado: `enabled` diz isso às telas, que não
 * oferecem o que depende dele, e o pedido de envio é descartado com um aviso no log (sem o
 * conteúdo, que pode levar um link de acesso).
 */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger('E-mail');
  private transport: MailTransport | null;

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(QUEUE) private readonly queue: JobQueue,
  ) {
    this.transport = config.SMTP_URL ? new SmtpMailTransport(config.SMTP_URL) : null;
  }

  get enabled() {
    return this.transport !== null;
  }

  /** Endereço público do aplicativo, para os links. */
  link(path: string) {
    return `${this.config.APP_PUBLIC_URL.replace(/\/$/, '')}${path}`;
  }

  onModuleInit() {
    this.queue.process(MAIL_SEND_JOB, async (data) => {
      const message = data as MailMessage;
      if (!this.transport) {
        this.logger.warn('E-mail não configurado (SMTP_URL): mensagem descartada.');
        return;
      }
      await this.transport.send({ ...message, from: this.config.MAIL_FROM });
    });
  }

  async send(message: MailMessage) {
    if (!this.transport) return false;
    await this.queue.add(MAIL_SEND_JOB, message, { attempts: 5, backoffMs: 30_000 });
    return true;
  }
}
