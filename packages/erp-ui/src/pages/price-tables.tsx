import { formatBRL, type Cents, type Page, type PriceTable, type Product } from '@bipae/domain';
import {
  Alert,
  Button,
  DataTable,
  Drawer,
  EmptyState,
  MoneyField,
  PageHeader,
  TextField,
} from '@bipae/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { useDeferredValue, useState, type FormEvent } from 'react';
import { useApp, useCan } from '../context';
import { useForm } from '../forms';

const brl = (c: number) => formatBRL(c as Cents);

/**
 * Tabelas de preço (F1-03): preços especiais por loja (ex.: loja do centro) ou por cliente
 * (atacado, funcionário). Produtos fora da tabela usam o preço de cadastro.
 */
export function PriceTablesPage() {
  const { api } = useApp();
  const canWrite = useCan('catalog.price.write');
  const list = useQuery({
    queryKey: ['price-tables'],
    queryFn: () => api.get<PriceTable[]>('/price-tables'),
  });
  const [editing, setEditing] = useState<PriceTable | 'new' | null>(null);

  return (
    <>
      <PageHeader
        title="Tabelas de preço"
        description="Preços especiais por loja ou por cliente. O que não está na tabela usa o preço do cadastro."
        actions={
          canWrite && (
            <Button
              icon={<Plus className="size-5" aria-hidden />}
              onClick={() => setEditing('new')}
            >
              Nova tabela
            </Button>
          )
        }
      />
      <p className="mb-4 text-muted">
        Escolha a tabela da loja em <strong>Empresas e lojas</strong> e a de um cliente no cadastro
        do cliente. No caixa vale primeiro a do cliente, depois a da loja.
      </p>
      {list.error && <Alert>{(list.error as Error).message}</Alert>}
      {list.data &&
        (list.data.length === 0 ? (
          <EmptyState title="Nenhuma tabela de preço ainda" />
        ) : (
          <DataTable
            caption="Lista de tabelas de preço"
            rows={list.data}
            onRowClick={canWrite ? setEditing : undefined}
            columns={[
              { header: 'Nome', cell: (t) => <span className="font-semibold">{t.name}</span> },
              {
                header: 'Produtos',
                cell: (t) => (t.items.length === 1 ? '1 produto' : `${t.items.length} produtos`),
              },
            ]}
          />
        ))}
      {editing && (
        <PriceTableForm
          table={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

type Item = PriceTable['items'][number];

function PriceTableForm({ table, onClose }: { table: PriceTable | null; onClose: () => void }) {
  const { api } = useApp();
  const queryClient = useQueryClient();
  const form = useForm({ name: table?.name ?? '' });
  const [items, setItems] = useState<Item[]>(table?.items ?? []);
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const found = useQuery({
    queryKey: ['products', 'price-table-search', q],
    queryFn: () => api.get<Page<Product>>(`/products?q=${encodeURIComponent(q)}&limit=8`),
    enabled: q.length >= 2,
  });

  const add = (p: Product) => {
    if (!items.some((i) => i.productId === p.id)) {
      setItems((list) => [
        ...list,
        { productId: p.id, name: p.name, priceCents: p.priceCents, basePriceCents: p.priceCents },
      ]);
    }
    setSearch('');
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void form.submit(async (v) => {
      const body = {
        name: v.name,
        items: items.map(({ productId, priceCents }) => ({ productId, priceCents })),
      };
      if (table) await api.put(`/price-tables/${table.id}`, body);
      else await api.post('/price-tables', body);
      await queryClient.invalidateQueries({ queryKey: ['price-tables'] });
      onClose();
    });
  };

  return (
    <Drawer
      open
      onOpenChange={(open) => !open && onClose()}
      title={table ? 'Editar tabela de preço' : 'Nova tabela de preço'}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {form.formError && <Alert>{form.formError}</Alert>}
        <TextField
          label="Nome da tabela"
          placeholder="Ex.: Atacado, Funcionários, Loja Centro"
          value={form.values.name}
          onChange={(e) => form.set('name', e.target.value)}
          error={form.errors.name}
          autoFocus
        />

        <div className="flex flex-col gap-2">
          <TextField
            label="Adicionar produto"
            placeholder="Digite o nome ou o código"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {q.length >= 2 && found.data && (
            <ul className="rounded-ui border border-border" aria-label="Produtos encontrados">
              {found.data.items.length === 0 && (
                <li className="p-3 text-muted">Nenhum produto encontrado.</li>
              )}
              {found.data.items.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="flex w-full justify-between gap-2 p-3 text-left hover:bg-surface-2"
                    onClick={() => add(p)}
                  >
                    <span>{p.name}</span>
                    <span className="text-muted">{brl(p.priceCents)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {items.length === 0 ? (
          <p className="text-muted">Nenhum produto na tabela ainda.</p>
        ) : (
          <ul className="flex flex-col gap-3" aria-label="Produtos da tabela">
            {items.map((item, index) => (
              <li key={item.productId} className="rounded-ui border border-border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{item.name}</p>
                    <p className="text-sm text-muted">Preço normal: {brl(item.basePriceCents)}</p>
                  </div>
                  <Button
                    variant="ghost"
                    aria-label={`Tirar ${item.name} da tabela`}
                    icon={<X className="size-4" aria-hidden />}
                    onClick={() => setItems((list) => list.filter((_, i) => i !== index))}
                  />
                </div>
                <MoneyField
                  label={`Preço de ${item.name} nesta tabela`}
                  value={item.priceCents}
                  onChange={(v) =>
                    setItems((list) =>
                      list.map((it, i) => (i === index ? { ...it, priceCents: v ?? 0 } : it)),
                    )
                  }
                />
              </li>
            ))}
          </ul>
        )}

        <div className="flex gap-2 pt-2">
          <Button type="submit" loading={form.submitting}>
            Salvar tabela
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
        </div>
      </form>
    </Drawer>
  );
}
