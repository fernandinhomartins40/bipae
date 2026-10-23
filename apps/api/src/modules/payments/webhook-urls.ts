import { randomBytes } from 'node:crypto';
import type { Config } from '../../config';

/** Endereços e segredo dos avisos (webhooks) dos meios de pagamento (F8-09.c.2). */

/** Segredo novo da loja: 43 caracteres sem espaço (o Asaas pede de 32 a 255). */
export function newWebhookToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Raiz pública da API, sem a barra final (os avisos chegam em /v1/payments/webhooks/...). */
export function publicApiBase(config: Pick<Config, 'API_PUBLIC_URL' | 'APP_PUBLIC_URL'>): string {
  if (config.API_PUBLIC_URL) return config.API_PUBLIC_URL.replace(/\/+$/, '');
  try {
    return new URL(config.APP_PUBLIC_URL).origin;
  } catch {
    return '';
  }
}

export function webhookUrls(base: string, token: string | null) {
  const root = `${base}/v1/payments/webhooks`;
  return {
    pixApiUrl: token ? `${root}/pix-api/${token}` : null,
    mercadopagoUrl: `${root}/mercadopago`,
    pagbankUrl: `${root}/pagbank`,
    asaasUrl: `${root}/asaas`,
  };
}
