import type { Page, Product, TabOrderView } from '@bipae/domain';
import {
  OrderDevice,
  type DeviceProduct,
  type QueuedOrder,
  type SendResult,
} from '@bipae/pdv-core';
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from './api-client';
import { useApp, useMe } from './context';

/** De quanto em quanto tempo o aparelho tenta mandar a fila e renovar os produtos. */
const FLUSH_MS = 15_000;
const CATALOG_MS = 10 * 60_000;
/** Até onde a cópia dos produtos vai (200 por página). */
const MAX_PAGES = 50;

/** Sem rede ou erro do servidor: tenta depois. Recusa de regra (4xx): fica com o motivo. */
export function classify(error: unknown): SendResult {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
    if (error.status !== 408 && error.status !== 429) return { ok: false, error: error.message };
  }
  return { ok: false, retry: true };
}

/**
 * Aparelho de vendas (F8-04): produtos guardados no aparelho e pedidos que esperam a internet.
 * Sem banco local (navegador sem armazenamento), devolve `device: null` e a tela segue online.
 */
export function useOrderDevice() {
  const { api, platform } = useApp();
  const me = useMe();
  const [device, setDevice] = useState<OrderDevice | null>(null);
  const [queue, setQueue] = useState<QueuedOrder[]>([]);
  const [catalogAt, setCatalogAt] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!platform.openLocalDatabase) return;
    void platform
      .openLocalDatabase(`vendas-${me.tenant.id}-${me.user.id}.db`)
      .then((driver) => OrderDevice.fromDriver(driver))
      .then(async (d) => {
        if (!alive) return;
        setDevice(d);
        setQueue(await d.queued());
        setCatalogAt(await d.catalogAt());
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [platform, me.tenant.id, me.user.id]);

  const refreshCatalog = useCallback(async () => {
    if (!device || !navigator.onLine) return;
    const all: DeviceProduct[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await api.get<Page<Product>>(`/products?limit=200&offset=${page * 200}`);
      for (const p of res.items) {
        if (p.active)
          all.push({ id: p.id, name: p.name, priceCents: p.priceCents, barcodes: p.barcodes });
      }
      if ((page + 1) * 200 >= res.total) break;
    }
    await device.replaceCatalog(all);
    setCatalogAt(await device.catalogAt());
  }, [api, device]);

  const flush = useCallback(async () => {
    if (!device) return 0;
    const { sent } = await device.flush(async (order) => {
      try {
        await api.post<TabOrderView>('/tabs/orders', {
          id: order.id,
          storeId: order.storeId,
          label: order.label,
          items: order.items.map(({ productId, quantityMilli }) => ({ productId, quantityMilli })),
        });
        return { ok: true };
      } catch (error) {
        return classify(error);
      }
    });
    setQueue(await device.queued());
    return sent;
  }, [api, device]);

  useEffect(() => {
    if (!device) return;
    void refreshCatalog().catch(() => undefined);
    void flush();
    const onOnline = () => {
      void flush();
      void refreshCatalog().catch(() => undefined);
    };
    window.addEventListener('online', onOnline);
    const tick = setInterval(() => void flush(), FLUSH_MS);
    const catalog = setInterval(() => void refreshCatalog().catch(() => undefined), CATALOG_MS);
    return () => {
      window.removeEventListener('online', onOnline);
      clearInterval(tick);
      clearInterval(catalog);
    };
  }, [device, flush, refreshCatalog]);

  const enqueue = useCallback(
    async (order: Parameters<OrderDevice['enqueue']>[0]) => {
      if (!device) throw new Error('Aparelho sem armazenamento local.');
      const queued = await device.enqueue(order);
      await flush();
      const still = (await device.queued()).find((o) => o.id === queued.id) ?? null;
      return { queued, pending: still };
    },
    [device, flush],
  );

  const discard = useCallback(
    async (id: string) => {
      if (!device) return;
      await device.discard(id);
      setQueue(await device.queued());
    },
    [device],
  );

  return { device, queue, catalogAt, enqueue, discard, flush };
}
