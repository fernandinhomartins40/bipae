import type { CatalogProduct } from '@bipae/domain';
import { Alert, TextField } from '@bipae/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useApp } from '../context';

const isBarcode = (text: string) => /^\d{8,14}$/.test(text);

/** Resumo do que veio do catálogo: marca, fabricante, departamento, conteúdo e embalagens. */
export function catalogSummary(
  catalog:
    | {
        brand?: string | null;
        manufacturer?: string | null;
        department?: string | null;
        packageDescription?: string | null;
      }
    | null
    | undefined,
  packs: { packGtin: string; unitsPerPack: number }[] = [],
): string {
  return [
    catalog?.brand && `Marca ${catalog.brand}`,
    catalog?.manufacturer && `Fabricante ${catalog.manufacturer}`,
    catalog?.department,
    catalog?.packageDescription,
    ...packs.map((p) => `Caixa ${p.packGtin} com ${p.unitsPerPack}`),
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Busca no catálogo de produtos (MF-02): bipar o código de barras ou digitar o nome traz o
 * cadastro pronto. O catálogo só pré-preenche o formulário; quem confere e salva é o usuário.
 * Sem a integração ligada, o componente não aparece e o cadastro segue manual.
 */
export function CatalogAssist({ onPick }: { onPick: (product: CatalogProduct) => void }) {
  const { api } = useApp();
  const status = useQuery({
    queryKey: ['product-catalog', 'status'],
    queryFn: () => api.get<{ enabled: boolean }>('/product-catalog/status'),
    staleTime: 5 * 60_000,
  });
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');
  const [picking, setPicking] = useState(false);

  // Espera 300 ms depois da última tecla antes de consultar.
  useEffect(() => {
    const timer = setTimeout(() => setTerm(text.trim()), 300);
    return () => clearTimeout(timer);
  }, [text]);

  const enabled = status.data?.enabled === true;
  const byCode = useQuery({
    queryKey: ['product-catalog', 'gtin', term],
    queryFn: () => api.get<CatalogProduct>(`/product-catalog/products/${term}`),
    enabled: enabled && isBarcode(term),
  });
  const byName = useQuery({
    queryKey: ['product-catalog', 'search', term],
    queryFn: () =>
      api.get<{ items: CatalogProduct[] }>(
        `/product-catalog/search?q=${encodeURIComponent(term)}&limit=8`,
      ),
    enabled: enabled && !isBarcode(term) && term.length >= 2 && !/^\d+$/.test(term),
  });
  if (!enabled) return null;

  const pick = async (item: CatalogProduct) => {
    setPicking(true);
    try {
      // A busca por nome vem sem NCM, CEST e embalagens: o cadastro completo vem pelo código.
      const full =
        item.ncm === undefined || item.packs === undefined
          ? await api.get<CatalogProduct>(`/product-catalog/products/${item.gtin}`)
          : item;
      onPick(full.found ? full : item);
      setText('');
    } finally {
      setPicking(false);
    }
  };

  const results = isBarcode(term)
    ? byCode.data?.found
      ? [byCode.data]
      : []
    : (byName.data?.items ?? []);
  const searching = byCode.isFetching || byName.isFetching || picking;
  const nothing =
    !searching &&
    ((isBarcode(term) && byCode.data && !byCode.data.found) ||
      (!isBarcode(term) && byName.data && byName.data.items.length === 0));

  return (
    <div className="flex flex-col gap-2 rounded-ui border border-border bg-surface-2 p-3">
      <TextField
        label="Buscar no catálogo"
        hint="Bipe o código de barras ou digite o nome: o cadastro vem preenchido."
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {searching && <p className="text-sm text-muted">Procurando...</p>}
      {nothing && (
        <Alert tone="warning">
          {byCode.data?.reason === 'SEM_RESPOSTA'
            ? 'O catálogo não respondeu agora. Preencha à mão ou tente de novo.'
            : 'Não achamos este produto no catálogo. Preencha os dados à mão.'}
        </Alert>
      )}
      {results.length > 0 && (
        <ul className="flex flex-col gap-1" aria-label="Produtos do catálogo">
          {results.map((item) => (
            <li key={item.gtin}>
              <button
                type="button"
                onClick={() => void pick(item)}
                className="w-full rounded-ui border border-border bg-surface px-3 py-2 text-left hover:bg-border"
              >
                <span className="font-semibold">{item.description}</span>
                <span className="block text-sm text-muted">
                  {[item.brand, item.packageDescription, item.gtin].filter(Boolean).join(' · ')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
