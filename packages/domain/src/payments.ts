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
  /** homologation: construído e testado contra o padrão, falta homologar com um banco de verdade. */
  status: 'ready' | 'homologation' | 'coming-soon';
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
    status: 'homologation',
    task: 'F8-09',
    description:
      'QR dinâmico e confirmação automática do pagamento, pelo padrão do Banco Central. Teste primeiro no sandbox do seu banco.',
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
    id: 'mp-point',
    name: 'Mercado Pago Point (maquininha comandada pela internet)',
    family: 'cloud-terminal',
    methods: ['card'],
    targets: ALL,
    status: 'homologation',
    task: 'F8-10',
    description:
      'O caixa manda o valor para a Point, sem digitar de novo, e recebe a aprovação. Teste antes com as credenciais de teste do Mercado Pago.',
  },
  {
    id: 'stone-connect',
    name: 'Stone Connect',
    family: 'cloud-terminal',
    methods: ['card', 'pix'],
    targets: ALL,
    status: 'coming-soon',
    task: 'F8-10',
    description:
      'Pedido enviado à maquininha Stone pela API Pagar.me. Exige o cadastro do Bipaê no Programa de Parcerias da Stone.',
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

export const CARD_MODES = ['manual', 'mp_point', 'simulator'] as const;
export const PIX_MODES = ['manual', 'static_qr', 'api', 'simulator'] as const;
export type CardMode = (typeof CARD_MODES)[number];
export type PixMode = (typeof PIX_MODES)[number];

/**
 * Endereços da API Pix que conferimos na documentação do banco (21/10/2026). Os outros bancos
 * entram por "Outro banco", com as URLs do portal do banco: não inventamos endereço.
 */
export interface PixApiProfile {
  id: string;
  name: string;
  environment: 'sandbox' | 'production';
  baseUrl: string;
  tokenUrl: string;
  source: string;
}

export const PIX_API_PROFILES: PixApiProfile[] = [
  {
    id: 'inter-sandbox',
    name: 'Banco Inter (sandbox)',
    environment: 'sandbox',
    baseUrl: 'https://cdpj-sandbox.partners.uatinter.co/pix/v2',
    tokenUrl: 'https://cdpj-sandbox.partners.uatinter.co/oauth/v2/token',
    source: 'https://developers.inter.co/references/pix',
  },
  {
    id: 'inter',
    name: 'Banco Inter',
    environment: 'production',
    baseUrl: 'https://cdpj.partners.bancointer.com.br/pix/v2',
    tokenUrl: 'https://cdpj.partners.bancointer.com.br/oauth/v2/token',
    source: 'https://developers.inter.co/references/pix',
  },
  {
    id: 'efi-sandbox',
    name: 'Efí (homologação)',
    environment: 'sandbox',
    baseUrl: 'https://pix-h.api.efipay.com.br/v2',
    tokenUrl: 'https://pix-h.api.efipay.com.br/oauth/token',
    source: 'https://dev.efipay.com.br/en/docs/api-pix/cobrancas-imediatas/',
  },
  {
    id: 'sicoob-sandbox',
    name: 'Sicoob (homologação)',
    environment: 'sandbox',
    baseUrl: 'https://api-homol.sicoob.com.br/cooperado/pix/api/v2',
    tokenUrl: 'https://api-homol.sicoob.com.br/cooperado/pix/token',
    source: 'Manual para utilização da API Pix 2.2.1 Sicoob',
  },
  {
    id: 'sicredi',
    name: 'Sicredi',
    environment: 'production',
    baseUrl: 'https://api-pix.sicredi.com.br/api/v2',
    tokenUrl: 'https://api-pix.sicredi.com.br/oauth/token',
    source: 'https://developers.sicredi.com.br/public/docs/getting-started-pix',
  },
];

const httpsUrl = z
  .string()
  .trim()
  .url('Endereço inválido')
  .refine((u) => u.startsWith('https://'), 'Use um endereço https://');

export const paymentSettingsInput = z
  .object({
    card: z.enum(CARD_MODES).default('manual'),
    pix: z.enum(PIX_MODES).default('manual'),
    pixKey: z.string().trim().max(77).nullish(),
    pixMerchantName: z.string().trim().max(25, 'Até 25 letras').nullish(),
    pixCity: z.string().trim().max(15, 'Até 15 letras').nullish(),
    /** Mercado Pago Point (F8-10). Token em branco mantém o guardado. */
    mpPoint: z
      .object({
        accessToken: z.string().trim().max(300).optional(),
        terminalId: z
          .string()
          .trim()
          .regex(
            /^[A-Za-z0-9_]+__[A-Za-z0-9]+$/,
            'Use o ID do terminal, como NEWLAND_N950__SBX0000001',
          ),
      })
      .nullish(),
    /** API Pix do banco (F8-09). Segredos em branco mantêm os que já estão guardados. */
    pixApi: z
      .object({
        baseUrl: httpsUrl,
        tokenUrl: httpsUrl,
        clientId: z.string().trim().min(1, 'Informe o Client ID').max(200),
        clientSecret: z.string().max(500).optional(),
        certificateBase64: z
          .string()
          .regex(/^[A-Za-z0-9+/=]+$/, 'Arquivo do certificado em formato inválido')
          .max(200_000, 'Arquivo grande demais')
          .optional(),
        certificatePassword: z.string().max(200).optional(),
      })
      .nullish(),
  })
  .superRefine((v, ctx) => {
    if (v.card === 'mp_point' && !v.mpPoint) {
      ctx.addIssue({
        code: 'custom',
        path: ['mpPoint', 'terminalId'],
        message: 'Informe o ID do terminal da Point',
      });
    }
    if (v.pix === 'api') {
      if (!v.pixApi) {
        ctx.addIssue({ code: 'custom', path: ['pixApi'], message: 'Informe os dados da API Pix' });
      }
      if (!v.pixKey || !normalizePixKey(v.pixKey)) {
        ctx.addIssue({
          code: 'custom',
          path: ['pixKey'],
          message: 'Informe a chave Pix da conta que recebe.',
        });
      }
      return;
    }
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
  /** Mercado Pago Point (F8-10): o terminal e se o token está guardado. */
  mpPoint: { terminalId: string; hasAccessToken: boolean } | null;
  /** API Pix (F8-09): endereços e o que já está guardado, nunca os segredos. */
  pixApi: {
    baseUrl: string;
    tokenUrl: string;
    clientId: string;
    hasClientSecret: boolean;
    hasCertificate: boolean;
  } | null;
}

/** Cobrança Pix pela API do banco (F8-09), como o caixa acompanha. */
export interface PixChargeView {
  txid: string;
  amountCents: number;
  copyPaste: string;
  status: 'pending' | 'paid' | 'expired' | 'failed';
  /** Identificador do pagamento no Pix (endToEndId), quando pago. */
  endToEndId: string | null;
  message: string | null;
}

/** Cobrança no cartão enviada à maquininha pela internet (F8-10). */
export interface CardChargeView {
  id: string;
  amountCents: number;
  method: 'credit' | 'debit';
  status: 'pending' | 'paid' | 'failed' | 'canceled' | 'expired';
  /** ID do pagamento no parceiro, quando aprovado. */
  paymentId: string | null;
  message: string | null;
}

export const cardChargeInput = z.object({
  storeId: z.string().uuid('Loja inválida'),
  amountCents: z.number().int().positive('Valor inválido').max(100_000_000, 'Valor alto demais'),
  method: z.enum(['credit', 'debit']),
});

export const pixChargeInput = z.object({
  storeId: z.string().uuid('Loja inválida'),
  amountCents: z.number().int().positive('Valor inválido').max(100_000_000, 'Valor alto demais'),
});

/** O que o caixa recebe (sem segredo: a chave Pix é pública para quem paga). */
export interface TerminalPaymentSettings {
  card: CardMode;
  pix: PixMode;
  pixStatic?: { key: string; merchantName: string; city: string };
}
