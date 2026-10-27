import { formatBRL, type Cents } from '@bipae/domain';
import { mailBody } from '../mail/mail.service';

export type BillingNoticeKind = 'open' | 'overdue' | 'blocked' | 'paid';

const date = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(d);

/** Texto dos e-mails da cobrança dos planos (F6-04): tom direto e sem susto. */
export function billingMail(
  kind: BillingNoticeKind,
  input: {
    firstName: string;
    tenantName: string;
    planName: string;
    amountCents: number;
    dueAt: Date;
    graceDays: number;
    link: string;
  },
) {
  const valor = formatBRL(input.amountCents as Cents);
  const greeting = `Olá, ${input.firstName}!`;
  switch (kind) {
    case 'open':
      return {
        subject: `Bipaê: fatura do plano ${input.planName} (${valor})`,
        ...mailBody({
          greeting,
          paragraphs: [
            `A fatura de ${valor} do plano ${input.planName} de ${input.tenantName} está disponível e vence em ${date(input.dueAt)}.`,
            'O pagamento é por Pix, pela tela Assinatura da retaguarda: copie o código e pague no app do seu banco. A confirmação é automática.',
          ],
          action: { label: 'Pagar a fatura', url: input.link },
        }),
      };
    case 'overdue':
      return {
        subject: 'Bipaê: a sua fatura venceu',
        ...mailBody({
          greeting,
          paragraphs: [
            `A fatura de ${valor} do plano ${input.planName} venceu em ${date(input.dueAt)}.`,
            `Tudo segue funcionando por mais ${input.graceDays} dias. Depois disso o acesso à retaguarda fica pausado até o pagamento; as vendas feitas no caixa sem internet nunca se perdem.`,
          ],
          action: { label: 'Pagar a fatura', url: input.link },
        }),
      };
    case 'blocked':
      return {
        subject: 'Bipaê: acesso pausado por falta de pagamento',
        ...mailBody({
          greeting,
          paragraphs: [
            `Pausamos o acesso de ${input.tenantName} porque a fatura de ${valor} (vencida em ${date(input.dueAt)}) continua em aberto.`,
            'Os dados estão guardados e as vendas offline do caixa serão sincronizadas. Pagando a fatura, a conta volta na hora.',
          ],
          action: { label: 'Pagar e reativar', url: input.link },
        }),
      };
    case 'paid':
      return {
        subject: 'Bipaê: pagamento recebido',
        ...mailBody({
          greeting,
          paragraphs: [`Recebemos o pagamento de ${valor} do plano ${input.planName}. Obrigado!`],
        }),
      };
  }
}
