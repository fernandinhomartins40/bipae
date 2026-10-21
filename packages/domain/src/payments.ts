import { z } from 'zod';
import { normalizePixKey } from './pix';

/**
 * Meios de pagamento integráveis (F8-08, ADR-0018). O catálogo diz o que existe, onde roda e
 * se já está pronto; o que espera homologação com o parceiro aparece como "chega em breve" e
 * não pode ser escolhido ("capacidades nunca mentem").
 */

export type PaymentFamily =
  'manual' | 'simulator' | 'pix-static' | 'pix-api' | 'cloud-terminal' | 'tef' | 'smart-pos';

export interface PaymentProviderInfo {
  id: string;
  name: string;
  family: PaymentFamily;
  methods: ('card' | 'pix')[];
  /** Onde funciona: navegador, computador (desktop) e o app Android. */
  targets: ('web' | 'desktop' | 'android')[];
  status: 'ready' | 'coming-soon';
  /** Tarefa do backlog que entrega a integração (quando ainda não está pronta). */
  task?: string;
  description: string;
}

const ALL: PaymentProviderInfo['targets'] = ['web', 'desktop', 'android'];

export const PAYMENT_PROVIDERS: PaymentProviderInfo[] = [
  {
    id: 'manual',
    name: 'Maquininha à parte',
    family: 'manual',
    methods: ['card'],
    targets: ALL,
    status: 'ready',
    description: 'Cobre na sua maquininha e confirme no caixa. Funciona com qualquer maquininha.',
  },
  {
    id: 'pix-static',
    name: 'QR Code Pix com a chave da loja',
    family: 'pix-static',
    methods: ['pix'],
    targets: ALL,
    status: 'ready',
    description:
      'O caixa mostra o QR com o valor da venda; o cliente paga em qualquer banco e o operador confirma o recebimento.',
  },
  {
    id: 'simulator',
    name: 'Simulador (demonstração)',
    family: 'simulator',
    methods: ['card', 'pix'],
    targets: ALL,
    status: 'ready',
    description: 'Aprova sozinho, para treinar a equipe. Não cobra ninguém de verdade.',
  },
  {
    id: 'pix-api',
    name: 'API Pix do seu banco (Efí, Sicoob, Itaú, Banco do Brasil, Inter, Santander, Bradesco)',
    family: 'pix-api',
    methods: ['pix'],
    targets: ALL,
    status: 'coming-soon',
    task: 'F8-09',
    description: 'QR dinâmico e confirmação automática do pagamento, pelo padrão do Banco Central.',
  },
  {
    id: 'mercadopago-pix',
    name: 'Pix pelo Mercado Pago, PagBank ou Asaas',
    family: 'pix-api',
    methods: ['pix'],
    targets: ALL,
    status: 'coming-soon',
    task: 'F8-09',
    description: 'QR dinâmico com confirmação automática pela conta da loja no parceiro.',
  },
  {
    id: 'cloud-terminal',
    name: 'Maquininha comandada pela internet (Mercado Pago Point, Stone Connect)',
    family: 'cloud-terminal',
    methods: ['card', 'pix'],
    targets: ALL,
    status: 'coming-soon',
    task: 'F8-10',
    description:
      'O caixa manda o valor para a maquininha, sem digitar de novo, e recebe a aprovação.',
  },
  {
    id: 'tef',
    name: 'TEF com pinpad (SiTef, PayGo, Auttar, Linx)',
    family: 'tef',
    methods: ['card', 'pix'],
    targets: ['web', 'desktop'],
    status: 'coming-soon',
    task: 'F8-11',
    description:
      'O padrão dos supermercados: pinpad ligado ao computador do caixa, pelo Bipaê Desktop ou pelo Conector.',
  },
  {
    id: 'smart-pos',
    name: 'Maquininha smart Android (PagBank, Stone, Cielo LIO, Getnet)',
    family: 'smart-pos',
    methods: ['card', 'pix'],
    targets: ['android'],
    status: 'coming-soon',
    task: 'F8-12',
    description: 'O app Bipaê dentro da maquininha, cobrando direto nela.',
  },
];

export const CARD_MODES = ['manual', 'simulator'] as const;
export const PIX_MODES = ['manual', 'static_qr', 'simulator'] as const;
export type CardMode = (typeof CARD_MODES)[number];
export type PixMode = (typeof PIX_MODES)[number];

export const paymentSettingsInput = z
  .object({
    card: z.enum(CARD_MODES).default('manual'),
    pix: z.enum(PIX_MODES).default('manual'),
    pixKey: z.string().trim().max(77).nullish(),
    pixMerchantName: z.string().trim().max(25, 'Até 25 letras').nullish(),
    pixCity: z.string().trim().max(15, 'Até 15 letras').nullish(),
  })
  .superRefine((v, ctx) => {
    if (v.pix !== 'static_qr') return;
    if (!v.pixKey || !normalizePixKey(v.pixKey)) {
      ctx.addIssue({
        code: 'custom',
        path: ['pixKey'],
        message: 'Chave Pix inválida. Use CPF, CNPJ, e-mail, celular ou a chave aleatória.',
      });
    }
    if (!v.pixMerchantName?.trim()) {
      ctx.addIssue({ code: 'custom', path: ['pixMerchantName'], message: 'Informe o nome' });
    }
    if (!v.pixCity?.trim()) {
      ctx.addIssue({ code: 'custom', path: ['pixCity'], message: 'Informe a cidade' });
    }
  });
export type PaymentSettingsInput = z.input<typeof paymentSettingsInput>;

export interface PaymentSettingsView {
  storeId: string;
  card: CardMode;
  pix: PixMode;
  pixKey: string | null;
  pixMerchantName: string | null;
  pixCity: string | null;
}

/** O que o caixa recebe (sem segredo: a chave Pix é pública para quem paga). */
export interface TerminalPaymentSettings {
  card: CardMode;
  pix: PixMode;
  pixStatic?: { key: string; merchantName: string; city: string };
}
