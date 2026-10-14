import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { isValidGtin, type ProductCatalog } from '@bipae/domain';
import type { Tx } from '../../db/client';
import { MercadoflowOutbox, type OutboxResult, type OutboxRow } from './mercadoflow.outbox';

export const CONTRIBUTION_KIND = 'catalog.contribution';
const BATCH = 500;
const EVERY_MS = 5 * 60_000;

export interface ContributedProduct {
  barcodes: string[];
  name: string;
  unit: string;
  ncm?: string | null;
  cest?: string | null;
  catalog?: ProductCatalog | null;
}

/** Código que vale a pena devolver: GTIN com dígito certo e que não seja código interno de peso. */
export const contributableGtin = (code: string) => isValidGtin(code) && !code.startsWith('2');

/**
 * Devolve ao catálogo o que as lojas cadastram (seção 4.4 do contrato): dados cadastrais do
 * produto, nunca preço nem custo. É o que faz o catálogo melhorar com o uso. O id do cliente vai
 * como identificação da loja; o MercadoFlow guarda só o hash dele.
 */
@Injectable()
export class MercadoflowContributions implements OnModuleInit {
  constructor(@Inject(MercadoflowOutbox) private readonly outbox: MercadoflowOutbox) {}

  onModuleInit() {
    this.outbox.register(
      CONTRIBUTION_KIND,
      BATCH,
      (rows, client) => this.send(rows, client),
      EVERY_MS,
    );
  }

  /** Põe na fila os códigos de barras válidos do produto, na transação de quem salvou. */
  async enqueue(tx: Tx, tenantId: string, product: ContributedProduct) {
    for (const gtin of product.barcodes.filter(contributableGtin)) {
      await this.outbox.enqueue(tx, {
        tenantId,
        kind: CONTRIBUTION_KIND,
        dedupeKey: gtin,
        payload: {
          gtin,
          storeId: tenantId,
          description: product.name,
          brand: product.catalog?.brand ?? null,
          department: product.catalog?.department ?? null,
          unit: product.unit,
          packageDescription: product.catalog?.packageDescription ?? null,
          ncm: product.ncm ?? null,
          cest: product.cest ?? null,
        },
      });
    }
  }

  private async send(
    rows: OutboxRow[],
    client: Parameters<Parameters<MercadoflowOutbox['register']>[2]>[1],
  ): Promise<OutboxResult[]> {
    const response = await client.post<{
      items?: { gtin?: string; status?: string; error?: string }[];
    }>('/catalog/contributions', { items: rows.map((r) => r.payload) });
    const results = response?.items ?? [];
    return rows.map((row, i) => {
      const gtin = (row.payload as { gtin: string }).gtin;
      // A resposta vem item a item; casa pelo GTIN e, sem ele, pela posição.
      const result = results.find((r) => r.gtin === gtin) ?? results[i];
      return result?.status === 'RECUSADO'
        ? {
            id: row.id,
            outcome: 'rejected' as const,
            error: result.error ?? 'Recusado pelo catálogo.',
          }
        : { id: row.id, outcome: 'sent' as const };
    });
  }
}
