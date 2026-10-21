import {
  formatBRL,
  type Cents,
  type CommissionExceptionView,
  type CommissionReport,
  type Page,
  type Product,
} from '@bipae/domain';
import {
  Alert,
  Button,
  Card,
  DataTable,
  EmptyState,
  PageHeader,
  SelectField,
  TextField,
} from '@bipae/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useDeferredValue, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useApp, useCan } from '../context';
import { formatBp, parsePercentBp } from '../percent';

const brl = (c: number) => formatBRL(c as Cents);
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const day = (iso: string) => iso.split('-').reverse().join('/');

/**
 * Comissões (F8-02): quanto cada vendedor ganhou no período, sobre o que o cliente pagou, com
 * as devoluções descontadas; e as exceções de % por produto ou categoria.
 */
export function CommissionsPage() {
  const { api } = useApp();
  const now = today();
  const [from, setFrom] = useState(`${now.slice(0, 8)}01`);
  const [to, setTo] = useState(now);
  const [error, setError] = useState<string | null>(null);
  const query = `from=${from}&to=${to}`;
  const report = useQuery({
    queryKey: ['commissions', query],
    queryFn: () => api.get<CommissionReport>(`/commissions?${query}`),
    enabled: Boolean(from && to && from <= to),
  });
  const download = async (format: 'csv' | 'xlsx' | 'pdf') => {
    setError(null);
    try {
      const blob = await api.download(`/commissions/export?${query}&format=${format}`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `bipae-comissoes-${from}-a-${to}.${format}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const data = report.data;
  const rows = (data?.rows ?? []).map((r) => ({ ...r, id: r.sellerId }));

  return (
    <>
      <PageHeader
        title="Comissões"
        description="Quanto cada vendedor ganhou no período. Conta o que o cliente já pagou: o crediário entra quando é recebido, e a devolução desconta."
      />
      <div className="mb-4 flex flex-wrap items-end gap-4">
        <TextField label="De" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <TextField label="Até" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <div className="flex gap-2">
          {(['csv', 'xlsx', 'pdf'] as const).map((f) => (
            <Button
              key={f}
              variant="secondary"
              icon={<Download className="size-4" aria-hidden />}
              onClick={() => void download(f)}
            >
              {f.toUpperCase()}
            </Button>
          ))}
        </div>
      </div>
      {(error || report.error) && <Alert>{error ?? (report.error as Error).message}</Alert>}
      {data && (
        <Card className="mb-4">
          <p className="text-sm text-muted">
            Comissão de {day(data.from)} a {day(data.to)}
          </p>
          <p className="text-3xl font-bold tabular-nums" data-testid="commission-total">
            {brl(data.totalCommissionCents)}
          </p>
        </Card>
      )}
      {data && rows.length === 0 ? (
        <EmptyState title="Nenhuma venda com vendedor neste período">
          Escolha o vendedor no caixa, no botão <strong>Vendedor</strong>. Os vendedores e o % de
          cada um ficam em <Link to="/vendedores">Vendedores</Link>.
        </EmptyState>
      ) : (
        rows.length > 0 && (
          <DataTable
            caption="Comissão por vendedor"
            rows={rows}
            columns={[
              {
                header: 'Vendedor',
                cell: (r) => (
                  <span className="font-semibold">
                    {r.sellerName}
                    {r.code && <span className="ml-1 text-muted">({r.code})</span>}
                  </span>
                ),
              },
              { header: 'Vendas pagas', align: 'right', cell: (r) => brl(r.salesCents) },
              {
                header: 'Crediário recebido',
                align: 'right',
                cell: (r) => brl(r.creditReceivedCents),
              },
              {
                header: 'Devoluções',
                align: 'right',
                cell: (r) => (r.returnsCents ? `-${brl(r.returnsCents)}` : brl(0)),
              },
              { header: 'Base', align: 'right', cell: (r) => brl(r.baseCents) },
              {
                header: 'Comissão',
                align: 'right',
                cell: (r) => <span className="font-bold">{brl(r.commissionCents)}</span>,
              },
            ]}
          />
        )
      )}
      <Exceptions />
    </>
  );
}

/** % próprio de um produto ou de uma categoria, no lugar do % do vendedor. */
function Exceptions() {
  const { api } = useApp();
  const canWrite = useCan('admin.users');
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: ['commissions', 'exceptions'],
    queryFn: () => api.get<CommissionExceptionView[]>('/commissions/exceptions'),
  });
  const categories = useQuery({
    queryKey: ['products', 'categories'],
    queryFn: () => api.get<string[]>('/products/categories'),
    enabled: canWrite,
  });
  const [kind, setKind] = useState<'category' | 'product'>('category');
  const [category, setCategory] = useState('');
  const [product, setProduct] = useState<Product | null>(null);
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const found = useQuery({
    queryKey: ['products', 'commission-search', q],
    queryFn: () => api.get<Page<Product>>(`/products?q=${encodeURIComponent(q)}&limit=8`),
    enabled: kind === 'product' && q.length >= 2,
  });
  const [percent, setPercent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async (body: Record<string, unknown>) => {
    setSaving(true);
    setError(null);
    try {
      await api.post('/commissions/exceptions', body);
      await queryClient.invalidateQueries({ queryKey: ['commissions'] });
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const rateBp = parsePercentBp(percent);
    if (rateBp === null) return setError('Comissão inválida. Use um número de 0 a 100, como 2,5.');
    if (kind === 'product' && !product) return setError('Escolha o produto.');
    if (kind === 'category' && !category.trim()) return setError('Informe a categoria.');
    const ok = await save(
      kind === 'product'
        ? { productId: product!.id, rateBp }
        : { category: category.trim(), rateBp },
    );
    if (ok) {
      setPercent('');
      setCategory('');
      setProduct(null);
      setSearch('');
    }
  };

  return (
    <section className="mt-8" aria-labelledby="excecoes-titulo">
      <h2 id="excecoes-titulo" className="mb-1 text-xl font-bold">
        Exceções por produto ou categoria
      </h2>
      <p className="mb-4 text-muted">
        Um % próprio vale no lugar do % do vendedor. O do produto vem antes do da categoria.
      </p>
      {list.data && list.data.length > 0 ? (
        <ul className="mb-4 flex flex-col gap-2" aria-label="Exceções de comissão">
          {list.data.map((x) => (
            <li
              key={x.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-ui border border-border bg-surface p-3"
            >
              <span>
                <strong>{x.productName ?? `Categoria ${x.category}`}</strong> · {formatBp(x.rateBp)}{' '}
                desde {day(x.startsOn)}
              </span>
              {canWrite && (
                <Button
                  variant="ghost"
                  disabled={saving}
                  onClick={() =>
                    void save(
                      x.productId
                        ? { productId: x.productId, rateBp: null }
                        : { category: x.category, rateBp: null },
                    )
                  }
                >
                  Encerrar
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        list.data && <p className="mb-4 text-muted">Nenhuma exceção: vale o % de cada vendedor.</p>
      )}
      {canWrite && (
        <Card className="max-w-xl">
          <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4" noValidate>
            {error && <Alert>{error}</Alert>}
            <SelectField
              label="A exceção vale para"
              value={kind}
              onChange={(e) => setKind(e.target.value as 'category' | 'product')}
              options={[
                { value: 'category', label: 'Uma categoria de produtos' },
                { value: 'product', label: 'Um produto' },
              ]}
            />
            {kind === 'category' ? (
              <>
                <TextField
                  label="Categoria"
                  list="categorias-comissao"
                  hint="A categoria vem do cadastro do produto."
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                />
                <datalist id="categorias-comissao">
                  {(categories.data ?? []).map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </>
            ) : product ? (
              <div className="flex items-center justify-between gap-2 rounded-ui border border-border p-3">
                <span className="font-semibold">{product.name}</span>
                <Button variant="ghost" onClick={() => setProduct(null)}>
                  Trocar
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <TextField
                  label="Produto"
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
                          className="w-full p-3 text-left hover:bg-surface-2"
                          onClick={() => setProduct(p)}
                        >
                          {p.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <TextField
              label="Comissão da exceção (%)"
              inputMode="decimal"
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
            />
            <Button type="submit" loading={saving}>
              Salvar exceção
            </Button>
          </form>
        </Card>
      )}
    </section>
  );
}
