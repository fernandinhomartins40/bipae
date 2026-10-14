import {
  formatBRL,
  type CatalogProduct,
  type Cents,
  type FiscalProfile,
  type Page,
  type Product,
} from '@bipae/domain';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  DataTable,
  Drawer,
  EmptyState,
  MoneyField,
  PageHeader,
  SelectField,
  TextField,
} from '@bipae/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { useDeferredValue, useState, type FormEvent } from 'react';
import { useApp, useCan } from '../context';
import { CatalogAssist, catalogSummary } from './catalog-assist';
import { ApiError } from '../api-client';
import { useForm } from '../forms';
import { NcmCestHelp } from './fiscal-lookup';
import { KitEditor, type KitComponent } from './product-kit';
import { VariantsEditor } from './product-variants';

interface Unit {
  code: string;
  description: string;
}

export function ProductsPage() {
  const { api } = useApp();
  const canWrite = useCan('catalog.write');
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query.trim());
  const [editing, setEditing] = useState<Product | 'new' | null>(null);

  const products = useQuery({
    queryKey: ['products', deferred],
    queryFn: () => api.get<Page<Product>>(`/products?limit=100&q=${encodeURIComponent(deferred)}`),
  });
  const stock = useQuery({
    queryKey: ['stock'],
    staleTime: 0,
    queryFn: () => api.get<{ productId: string; quantityMilli: number }[]>('/stock'),
  });
  const stockOf = (productId: string) => {
    const rows = stock.data?.filter((s) => s.productId === productId) ?? [];
    return rows.length ? rows.reduce((a, s) => a + s.quantityMilli, 0) : null;
  };

  return (
    <>
      <PageHeader
        title="Produtos"
        description="Busque pelo nome, código interno ou bipando o código de barras."
        actions={
          canWrite && (
            <Button
              icon={<Plus className="size-5" aria-hidden />}
              onClick={() => setEditing('new')}
            >
              Novo produto
            </Button>
          )
        }
      />
      <div className="relative mb-4 max-w-xl">
        <Search
          className="pointer-events-none absolute left-3 top-3 size-5 text-muted"
          aria-hidden
        />
        <input
          type="search"
          aria-label="Buscar produtos"
          placeholder="Buscar ou bipar…"
          className="min-h-11 w-full rounded-ui border border-border bg-surface pl-10 pr-3"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
      </div>

      {products.error && <Alert>{(products.error as Error).message}</Alert>}
      {products.data && products.data.items.length === 0 ? (
        <EmptyState title={deferred ? 'Nada encontrado' : 'Nenhum produto ainda'}>
          {deferred
            ? 'Confira o que foi digitado ou cadastre um produto novo.'
            : 'Cadastre seu primeiro produto. Depois dá para importar tudo pelo XML das notas de compra.'}
        </EmptyState>
      ) : (
        products.data && (
          <DataTable
            caption="Lista de produtos"
            rows={products.data.items}
            onRowClick={canWrite ? (p) => setEditing(p) : undefined}
            columns={[
              {
                header: 'Produto',
                cell: (p) => (
                  <div>
                    <p className="font-semibold">{p.name}</p>
                    <p className="text-sm text-muted">
                      {[p.sku, p.barcodes[0]].filter(Boolean).join(' · ') || 'Sem código'}
                    </p>
                  </div>
                ),
              },
              { header: 'Unidade', cell: (p) => (p.isWeighable ? `${p.unit} (pesável)` : p.unit) },
              {
                header: 'Situação',
                cell: (p) =>
                  p.active ? <Badge tone="success">Ativo</Badge> : <Badge>Inativo</Badge>,
              },
              {
                header: 'Estoque',
                align: 'right',
                cell: (p) => {
                  const q = stockOf(p.id);
                  if (q === null) return <span className="text-muted">—</span>;
                  const text = (q / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
                  return <span className={q < 0 ? 'font-semibold text-danger' : ''}>{text}</span>;
                },
              },
              { header: 'Preço', align: 'right', cell: (p) => formatBRL(p.priceCents as Cents) },
            ]}
          />
        )
      )}
      {products.data && (
        <p className="mt-3 text-sm text-muted">
          {products.data.total} produto{products.data.total === 1 ? '' : 's'}
        </p>
      )}

      {editing && (
        <ProductForm
          product={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function ProductForm({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const { api } = useApp();
  const queryClient = useQueryClient();
  const canChangePrice = useCan('catalog.price.write');
  const units = useQuery({ queryKey: ['units'], queryFn: () => api.get<Unit[]>('/units') });
  const [components, setComponents] = useState<KitComponent[]>(
    (product?.components ?? []).map((c) => ({
      productId: c.productId,
      quantity: c.quantity,
      name: c.name ?? '',
    })),
  );
  const profiles = useQuery({
    queryKey: ['fiscal-profiles'],
    queryFn: () => api.get<FiscalProfile[]>('/fiscal-profiles'),
  });
  const form = useForm({
    name: product?.name ?? '',
    sku: product?.sku ?? '',
    barcodes: product?.barcodes.join(', ') ?? '',
    unit: product?.unit ?? 'UN',
    priceCents: product?.priceCents ?? (null as number | null),
    costCents: product?.costCents ?? (null as number | null),
    ncm: product?.ncm ?? '',
    fiscalProfileId: product?.fiscalProfileId ?? '',
    cest: product?.cest ?? '',
    isWeighable: product?.isWeighable ?? false,
    active: product?.active ?? true,
  });

  // Dados que vieram do catálogo: marca, fabricante, conteúdo e códigos de caixa.
  const [catalog, setCatalog] = useState(product?.catalog ?? null);
  const [packs, setPacks] = useState(product?.packs ?? []);
  const [fromCatalog, setFromCatalog] = useState(false);
  const applyCatalog = (found: CatalogProduct) => {
    form.set('name', found.description ?? form.values.name);
    const codes = new Set(form.values.barcodes.split(/[s,;]+/).filter(Boolean));
    codes.add(found.gtin);
    form.set('barcodes', [...codes].join(', '));
    const unit = found.unit ?? 'UN';
    if (units.data?.some((u) => u.code === unit)) form.set('unit', unit);
    form.set('isWeighable', found.weighable === true);
    // NCM e CEST são sugestões do catálogo, já conferidas na tabela oficial.
    if (found.ncm) form.set('ncm', found.ncm);
    if (found.cest) form.set('cest', found.cest);
    setCatalog({
      brand: found.brand ?? null,
      manufacturer: found.manufacturer ?? null,
      department: found.department ?? null,
      category: found.category ?? null,
      packageDescription: found.packageDescription ?? null,
      content: found.content ?? null,
      source: found.source ?? null,
    });
    setPacks(found.packs ?? []);
    setFromCatalog(true);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void form.submit(async (v) => {
      if (v.priceCents === null) {
        const message = 'Informe o preço de venda';
        throw new ApiError(400, 'validation', message, [{ path: 'priceCents', message }]);
      }
      const body = {
        ...(product ?? {}),
        ...v,
        fiscalProfileId: v.fiscalProfileId || null,
        components: components.map(({ productId, quantity }) => ({ productId, quantity })),
        catalog,
        packs,
        barcodes: v.barcodes
          .split(/[\s,;]+/)
          .map((b) => b.trim())
          .filter(Boolean),
      };
      if (product) await api.put(`/products/${product.id}`, body);
      else await api.post('/products', body);
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      onClose();
    });
  };

  return (
    <Drawer
      open
      onOpenChange={(open) => !open && onClose()}
      title={product ? 'Editar produto' : 'Novo produto'}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {form.formError && <Alert>{form.formError}</Alert>}
        {!product && <CatalogAssist onPick={applyCatalog} />}
        {fromCatalog && (
          <Alert tone="success" title="Preenchido pelo catálogo">
            Confira os dados, informe o preço e salve. O NCM e o CEST são sugestões: confirme com o
            seu contador.
          </Alert>
        )}
        {catalogSummary(catalog, packs) && (
          <p className="text-sm text-muted">{catalogSummary(catalog, packs)}</p>
        )}
        <TextField
          label="Nome"
          value={form.values.name}
          onChange={(e) => form.set('name', e.target.value)}
          error={form.errors.name}
          autoFocus
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <MoneyField
            label="Preço de venda"
            value={form.values.priceCents}
            onChange={(v) => form.set('priceCents', v)}
            error={form.errors.priceCents}
            required
          />
          <MoneyField
            label="Custo (opcional)"
            value={form.values.costCents}
            onChange={(v) => form.set('costCents', v)}
            error={form.errors.costCents}
          />
        </div>
        {product && !canChangePrice && (
          <p className="text-sm text-muted">Você pode editar o produto, mas não o preço.</p>
        )}
        <TextField
          label="Código de barras"
          hint="Separe vários códigos com vírgula."
          inputMode="numeric"
          value={form.values.barcodes}
          onChange={(e) => form.set('barcodes', e.target.value)}
          error={Object.entries(form.errors).find(([k]) => k.startsWith('barcodes'))?.[1]}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Código interno (SKU)"
            value={form.values.sku}
            onChange={(e) => form.set('sku', e.target.value)}
            error={form.errors.sku}
          />
          <SelectField
            label="Unidade"
            value={form.values.unit}
            onChange={(e) => form.set('unit', e.target.value)}
            options={(units.data ?? [{ code: 'UN', description: 'Unidade' }]).map((u) => ({
              value: u.code,
              label: `${u.code} — ${u.description}`,
            }))}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="NCM"
            inputMode="numeric"
            maxLength={8}
            value={form.values.ncm}
            onChange={(e) => form.set('ncm', e.target.value.replace(/\D/g, ''))}
            error={form.errors.ncm}
          />
          <TextField
            label="CEST"
            inputMode="numeric"
            maxLength={7}
            value={form.values.cest}
            onChange={(e) => form.set('cest', e.target.value.replace(/\D/g, ''))}
            error={form.errors.cest}
          />
        </div>
        <NcmCestHelp
          ncm={form.values.ncm}
          cest={form.values.cest}
          onPickNcm={(code) => form.set('ncm', code)}
          onPickCest={(code) => form.set('cest', code)}
        />
        <SelectField
          label="Perfil fiscal"
          hint="Como o produto é tributado. Os perfis ficam em Perfis fiscais."
          value={form.values.fiscalProfileId}
          onChange={(e) => form.set('fiscalProfileId', e.target.value)}
          options={[
            { value: '', label: 'Sem perfil' },
            ...(profiles.data ?? []).map((p) => ({ value: p.id, label: p.name })),
          ]}
        />
        <Checkbox
          label="Vendido por peso"
          hint="Lido na balança ou pela etiqueta de peso."
          checked={form.values.isWeighable}
          onChange={(v) => {
            form.set('isWeighable', v);
            // Weighed items are sold by the kilo; switching back restores units.
            if (v && form.values.unit === 'UN') form.set('unit', 'KG');
            if (!v && form.values.unit === 'KG') form.set('unit', 'UN');
          }}
        />
        <KitEditor productId={product?.id ?? null} value={components} onChange={setComponents} />
        <Checkbox
          label="Ativo"
          hint="Produtos inativos não aparecem no caixa."
          checked={form.values.active}
          onChange={(v) => form.set('active', v)}
        />
        <div className="flex gap-2 pt-2">
          <Button type="submit" loading={form.submitting}>
            Salvar
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
        </div>
      </form>
      {product && !product.parentId && product.components.length === 0 && (
        <VariantsEditor product={product} />
      )}
      {product && <StockCount product={product} />}
    </Drawer>
  );
}

/** Inventory count: the counted quantity becomes the balance (difference goes to the ledger). */
function StockCount({ product }: { product: Product }) {
  const { api } = useApp();
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const value = Number(text.replace(',', '.'));
    if (!Number.isFinite(value) || value < 0)
      return setMessage({ ok: false, text: 'Quantidade inválida.' });
    try {
      const [store] = await api.get<{ id: string }[]>('/stores');
      await api.post('/stock/adjustments', {
        productId: product.id,
        storeId: store!.id,
        mode: 'count',
        quantityMilli: Math.round(value * 1000),
        note: 'Contagem pelo cadastro',
      });
      await queryClient.invalidateQueries({ queryKey: ['stock'] });
      setMessage({ ok: true, text: 'Estoque atualizado.' });
      setText('');
    } catch (error) {
      setMessage({ ok: false, text: (error as Error).message });
    }
  };
  return (
    <form onSubmit={save} className="mt-8 flex flex-col gap-3 border-t border-border pt-5">
      <h3 className="font-bold">Contagem de estoque</h3>
      {message && <Alert tone={message.ok ? 'success' : 'danger'}>{message.text}</Alert>}
      <TextField
        label={`Quantidade contada (${product.unit})`}
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <Button type="submit" variant="secondary">
        Salvar contagem
      </Button>
    </form>
  );
}
