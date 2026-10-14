import { cents, formatBRL, type ConfereNotices } from '@bipae/domain';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useApp, useCan } from './context';

export const CONFERE_NOTICES_KEY = ['confere-notices'] as const;

/** "Chegou nota de Distribuidora X (R$ 1.834,50) para conferir" (seção 8 do contrato). */
export function noticeText(item: ConfereNotices['items'][number]): string {
  const from = item.supplierName ? ` de ${item.supplierName}` : '';
  const value = item.totalCents !== null ? ` (${formatBRL(cents(item.totalCents))})` : '';
  return `Chegou nota${from}${value} para conferir`;
}

/**
 * Notas novas no Confere (MF-14): o contador do menu Notas de entrada e a notificação do sistema
 * para cada nota que chega com a tela aberta. O que chegou com o Bipaê fechado aparece só no
 * contador, para não disparar uma rajada de avisos ao entrar.
 */
export function useConfereNotices() {
  const { api, platform } = useApp();
  const canSee = useCan('catalog.read');
  const notices = useQuery({
    queryKey: CONFERE_NOTICES_KEY,
    queryFn: () => api.get<ConfereNotices>('/mercadoflow/confere-notices'),
    enabled: canSee,
    refetchInterval: 60_000,
    retry: false,
  });
  const known = useRef<Set<string> | null>(null);

  useEffect(() => {
    const items = notices.data?.items;
    if (!items) return;
    if (known.current === null) {
      known.current = new Set(items.map((i) => i.id));
      return;
    }
    const fresh = items.filter((i) => !known.current!.has(i.id));
    for (const item of items) known.current.add(item.id);
    for (const item of fresh.slice(0, 3)) {
      void platform.notifications?.notify('Nota para conferir', noticeText(item)).catch(() => {});
    }
  }, [notices.data, platform]);

  return notices.data?.unseen ?? 0;
}
