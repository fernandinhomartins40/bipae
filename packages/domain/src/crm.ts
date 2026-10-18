/**
 * Segmentos do CRM (F6-08.a), calculados das compras com CPF/CNPJ. As regras são simples e
 * ficam escritas aqui para a tela explicar exatamente o que cada segmento quer dizer.
 */
export const CRM_SEGMENTS = ['novo', 'frequente', 'sumido', 'ativo'] as const;
export type CrmSegment = (typeof CRM_SEGMENTS)[number];

export const CRM_NEW_DAYS = 30;
export const CRM_FREQUENT_DAYS = 90;
export const CRM_FREQUENT_PURCHASES = 4;
export const CRM_GONE_DAYS = 60;

export const CRM_SEGMENT_LABELS: Record<CrmSegment, { label: string; rule: string }> = {
  novo: { label: 'Novos', rule: `Primeira compra nos últimos ${CRM_NEW_DAYS} dias.` },
  frequente: {
    label: 'Frequentes',
    rule: `${CRM_FREQUENT_PURCHASES} compras ou mais nos últimos ${CRM_FREQUENT_DAYS} dias.`,
  },
  sumido: { label: 'Sumidos', rule: `Já compraram, mas não nos últimos ${CRM_GONE_DAYS} dias.` },
  ativo: { label: 'Ativos', rule: 'Compraram recentemente, sem ser novos nem frequentes.' },
};

export interface CrmStats {
  firstPurchaseAt: Date;
  lastPurchaseAt: Date;
  /** Compras nos últimos CRM_FREQUENT_DAYS dias. */
  recentPurchases: number;
}

const DAY = 24 * 60 * 60_000;

export function crmSegment(stats: CrmStats, now: Date): CrmSegment {
  const days = (d: Date) => (now.getTime() - d.getTime()) / DAY;
  if (days(stats.firstPurchaseAt) <= CRM_NEW_DAYS) return 'novo';
  if (stats.recentPurchases >= CRM_FREQUENT_PURCHASES) return 'frequente';
  if (days(stats.lastPurchaseAt) > CRM_GONE_DAYS) return 'sumido';
  return 'ativo';
}

/** Intervalo médio entre compras, em dias (null com menos de duas compras). */
export function averageIntervalDays(first: Date, last: Date, purchases: number): number | null {
  if (purchases < 2) return null;
  return Math.round((last.getTime() - first.getTime()) / DAY / (purchases - 1));
}

/** Campanha por e-mail (F6-08.c): vai só para quem aceitou ofertas e tem e-mail. */
export interface EmailCampaignView {
  id: string;
  name: string;
  subject: string;
  body: string;
  segment: CrmSegment | null;
  recipients: number;
  unsubscribed: number;
  createdAt: string;
}

export const CAMPAIGN_SUBJECT_MAX = 120;
export const CAMPAIGN_BODY_MAX = 5000;
