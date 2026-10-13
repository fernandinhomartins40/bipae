import { formatBRL, type Cents, type Page, type Product } from '@bipae/domain';
import { Button, Checkbox, TextField } from '@bipae/ui';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { useApp } from '../context';

export type KitComponent = { productId: string; quantity: number; name: string };

/**
 * Composição do kit (F1-04): um kit (ex.: cesta básica) não tem estoque próprio; vender o kit
 * baixa o estoque de cada componente, na quantidade que vai no kit.
 */
export function KitEditor({
  productId,
  value,
  onChange,
}: {
  productId: string | null;
  value: KitComponent[];
  onChange: (next: KitComponent[]) => void;
}) {
  const { api } = useApp();
  const [isKit, setIsKit] = useState(value.length > 0);
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const found = useQuery({
    queryKey: ['products', 'kit-search', q],
    queryFn: () => api.get<Page<Product>>(`/products?q=${encodeURIComponent(q)}&limit=8`),
    enabled: isKit && q.length >= 2,
  });

  const add = (p: Product) => {
    if (!value.some((c) => c.productId === p.id)) {
      onChange([...value, { productId: p.id, quantity: 1, name: p.name }]);
    }
    setSearch('');
  };

  // Um kit não entra em outro kit: componentes possíveis são produtos que não são kits.
  const options = (found.data?.items ?? []).filter(
    (p) => p.id !== productId && p.components.length === 0,
  );

  return (
    <div className="flex flex-col gap-3 rounded-ui border border-border p-3">
      <Checkbox
        label="Este produto é um kit"
        hint="Ex.: cesta básica. Vender o kit baixa o estoque de cada item que vai nele."
        checked={isKit}
        onChange={(v) => {
          setIsKit(v);
          if (!v) onChange([]);
        }}
      />
      {isKit && (
        <>
          <TextField
            label="Adicionar item ao kit"
            placeholder="Digite o nome ou o código"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {q.length >= 2 && found.data && (
            <ul className="rounded-ui border border-border" aria-label="Produtos para o kit">
              {options.length === 0 && (
                <li className="p-3 text-muted">Nenhum produto encontrado.</li>
              )}
              {options.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="flex w-full justify-between gap-2 p-3 text-left hover:bg-surface-2"
                    onClick={() => add(p)}
                  >
                    <span>{p.name}</span>
                    <span className="text-muted">{formatBRL(p.priceCents as Cents)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {value.length === 0 ? (
            <p className="text-sm text-muted">Nenhum item no kit ainda.</p>
          ) : (
            <ul className="flex flex-col gap-2" aria-label="Itens do kit">
              {value.map((c, index) => (
                <li key={c.productId} className="flex items-end gap-2">
                  <div className="flex-1">
                    <TextField
                      label={`Quantidade de ${c.name} no kit`}
                      inputMode="decimal"
                      value={String(c.quantity).replace('.', ',')}
                      onChange={(e) => {
                        const quantity = Number(e.target.value.replace(',', '.'));
                        onChange(
                          value.map((it, i) =>
                            i === index
                              ? { ...it, quantity: Number.isFinite(quantity) ? quantity : 0 }
                              : it,
                          ),
                        );
                      }}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    aria-label={`Tirar ${c.name} do kit`}
                    icon={<X className="size-4" aria-hidden />}
                    onClick={() => onChange(value.filter((_, i) => i !== index))}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
