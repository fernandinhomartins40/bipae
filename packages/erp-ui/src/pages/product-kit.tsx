import { formatBRL, type Cents, type Page, type Product } from '@bipae/domain';
import { Button, Checkbox, TextField } from '@bipae/ui';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { useApp } from '../context';

export type KitComponent = {
  productId: string;
  quantity: number;
  name: string;
  unit?: string;
  costCents?: number | null;
};

/**
 * Custo da ficha (F5-11): cada componente vezes o custo dele, em centavos inteiros (a quantidade
 * tem até 4 casas, por isso a conta em décimos de milésimo). null quando falta o custo de algum.
 */
export function recipeCostCents(components: KitComponent[]): number | null {
  let total = 0;
  for (const c of components) {
    if (c.costCents === null || c.costCents === undefined) return null;
    total += Math.round((Math.round(c.quantity * 10_000) * c.costCents) / 10_000);
  }
  return total;
}

/**
 * Composição do kit (F1-04) ou ficha técnica do prato (F5-11): o produto não tem estoque próprio;
 * vender baixa o estoque de cada componente (ou insumo), na quantidade da composição. A ficha
 * mostra o custo do prato e a margem sobre o preço.
 */
export function KitEditor({
  productId,
  value,
  onChange,
  priceCents = null,
}: {
  productId: string | null;
  value: KitComponent[];
  onChange: (next: KitComponent[]) => void;
  /** Preço de venda, para a margem da ficha técnica. */
  priceCents?: number | null;
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
      onChange([
        ...value,
        { productId: p.id, quantity: 1, name: p.name, unit: p.unit, costCents: p.costCents },
      ]);
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
        label="Este produto é um kit ou um prato com ficha técnica"
        hint="Ex.: cesta básica, ou uma pizza com a farinha, o queijo e o molho. Vender baixa o estoque de cada item, na quantidade da composição."
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
                      label={`Quantidade de ${c.name} no kit${c.unit ? ` (${c.unit})` : ''}`}
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
          {value.length > 0 && <RecipeCost components={value} priceCents={priceCents} />}
        </>
      )}
    </div>
  );
}

/** Custo da ficha e margem sobre o preço de venda. */
function RecipeCost({
  components,
  priceCents,
}: {
  components: KitComponent[];
  priceCents: number | null;
}) {
  const cost = recipeCostCents(components);
  if (cost === null) {
    return (
      <p className="text-sm text-muted" data-testid="recipe-cost">
        Para ver o custo da ficha, cadastre o custo de todos os itens.
      </p>
    );
  }
  const margin =
    priceCents && priceCents > 0
      ? (((priceCents - cost) / priceCents) * 100).toLocaleString('pt-BR', {
          maximumFractionDigits: 1,
        })
      : null;
  return (
    <p className="text-sm" data-testid="recipe-cost">
      Custo da composição: <strong>{formatBRL(cost as Cents)}</strong>
      {margin !== null && ` · margem de ${margin}% sobre o preço`}
    </p>
  );
}
