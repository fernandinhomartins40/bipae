import type { Page, Product } from '@bipae/domain';
import { Alert, Button, Card, PageHeader, SelectField, TextField } from '@bipae/ui';
import { useQuery } from '@tanstack/react-query';
import { Printer, X } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { useApp } from '../context';
import { parseQuantity } from './purchase-orders';

interface Line {
  productId: string;
  name: string;
  unit: string;
  copies: string;
  /** Balança: peso da embalagem em kg ("1,250"). */
  weight: string;
}

/**
 * Etiquetas de gôndola e de balança (F5-01). Sai um PDF em folha A4 adesiva (3 × 8). A de
 * balança leva o código "2…" com o total, que o caixa lê como o código da balança.
 */
export function LabelsPage() {
  const { api } = useApp();
  const [kind, setKind] = useState<'shelf' | 'scale'>('shelf');
  const stores = useQuery({
    queryKey: ['stores'],
    queryFn: () => api.get<{ id: string; name: string }[]>('/stores'),
  });
  const [storeId, setStoreId] = useState('');
  const store = storeId || stores.data?.[0]?.id || '';
  const [lines, setLines] = useState<Line[]>([]);
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const found = useQuery({
    queryKey: ['products', 'labels-search', q],
    queryFn: () => api.get<Page<Product>>(`/products?q=${encodeURIComponent(q)}&limit=8`),
    enabled: q.length >= 2,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    setError(null);
    setBusy(true);
    try {
      const items = lines.map((l) => {
        const copies = Number(l.copies);
        if (!Number.isInteger(copies) || copies < 1 || copies > 100) {
          throw new Error(`Quantidade de etiquetas inválida em ${l.name}.`);
        }
        if (kind === 'shelf') return { productId: l.productId, copies };
        const grams = parseQuantity(l.weight);
        if (!grams) throw new Error(`Peso inválido em ${l.name}.`);
        return { productId: l.productId, copies, grams };
      });
      const blob = await api.downloadPost('/labels', {
        kind,
        ...(store && { storeId: store }),
        items,
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `bipae-etiquetas-${kind === 'shelf' ? 'gondola' : 'balanca'}.pdf`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const options = (found.data?.items ?? []).filter((p) => kind === 'shelf' || p.isWeighable);
  return (
    <>
      <PageHeader
        title="Etiquetas"
        description="Etiquetas de gôndola com o preço e o código de barras, e etiquetas de balança para os produtos vendidos por peso. Sai um PDF para imprimir em folha A4 adesiva (3 × 8)."
      />
      <Card className="flex flex-col gap-4">
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label="Tipo de etiqueta"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as 'shelf' | 'scale');
              setLines([]);
            }}
            options={[
              { value: 'shelf', label: 'Gôndola (preço)' },
              { value: 'scale', label: 'Balança (produto pesado)' },
            ]}
          />
          <SelectField
            label="Preço da loja"
            value={store}
            onChange={(e) => setStoreId(e.target.value)}
            options={(stores.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
            hint="Se a loja usa uma tabela de preço, a etiqueta sai com o preço dela."
          />
        </div>
        {kind === 'scale' && (
          <p className="text-sm text-muted">
            O produto precisa estar marcado como vendido por peso e ter um código interno só com
            números (até 5 dígitos): é por ele que o caixa encontra o produto ao ler a etiqueta.
          </p>
        )}
        <div className="flex flex-col gap-2">
          <TextField
            label="Adicionar produto"
            placeholder="Digite o nome ou o código"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {q.length >= 2 && found.data && (
            <ul className="rounded-ui border border-border" aria-label="Produtos encontrados">
              {options.length === 0 && (
                <li className="p-3 text-muted">
                  {kind === 'scale'
                    ? 'Nenhum produto vendido por peso encontrado.'
                    : 'Nenhum produto encontrado.'}
                </li>
              )}
              {options.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="w-full p-3 text-left hover:bg-surface-2"
                    onClick={() => {
                      if (!lines.some((l) => l.productId === p.id)) {
                        setLines((l) => [
                          ...l,
                          { productId: p.id, name: p.name, unit: p.unit, copies: '1', weight: '' },
                        ]);
                      }
                      setSearch('');
                    }}
                  >
                    {p.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {lines.length === 0 ? (
          <p className="text-muted">Nenhum produto escolhido ainda.</p>
        ) : (
          <ul className="flex flex-col gap-2" aria-label="Etiquetas a imprimir">
            {lines.map((line, index) => {
              const update = (patch: Partial<Line>) =>
                setLines((l) => l.map((x, i) => (i === index ? { ...x, ...patch } : x)));
              return (
                <li
                  key={line.productId}
                  className="flex flex-wrap items-end gap-3 rounded-ui border border-border p-3"
                >
                  <p className="min-w-40 flex-1 font-semibold">{line.name}</p>
                  {kind === 'scale' && (
                    <TextField
                      label={`Peso de ${line.name} (kg)`}
                      inputMode="decimal"
                      placeholder="1,250"
                      className="w-28"
                      value={line.weight}
                      onChange={(e) => update({ weight: e.target.value })}
                    />
                  )}
                  <TextField
                    label={`Etiquetas de ${line.name}`}
                    inputMode="numeric"
                    className="w-24"
                    value={line.copies}
                    onChange={(e) => update({ copies: e.target.value })}
                  />
                  <Button
                    variant="ghost"
                    aria-label={`Tirar ${line.name}`}
                    icon={<X className="size-4" aria-hidden />}
                    onClick={() => setLines((l) => l.filter((_, i) => i !== index))}
                  />
                </li>
              );
            })}
          </ul>
        )}
        <Button
          icon={<Printer className="size-4" aria-hidden />}
          loading={busy}
          disabled={lines.length === 0}
          onClick={() => void generate()}
        >
          Gerar PDF das etiquetas
        </Button>
      </Card>
    </>
  );
}
