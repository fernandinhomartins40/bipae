import type { Page, Product } from '@bipae/domain';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  DataTable,
  Drawer,
  EmptyState,
  PageHeader,
  SelectField,
  TextField,
} from '@bipae/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useDeferredValue, useState } from 'react';
import { useApp, useCan } from '../context';
import { parseQuantity } from './purchase-orders';

interface Lot {
  id: string;
  storeId: string;
  storeName: string;
  productId: string;
  productName: string;
  unit: string;
  lotCode: string;
  expiresOn: string | null;
  manufacturedOn: string | null;
  quantityMilli: number;
  daysLeft: number | null;
}

interface LotSale {
  saleId: string;
  quantityMilli: number;
  customerTaxId: string | null;
  occurredAt: string;
  terminalSeq: number;
}

const qty = (milli: number) => (milli / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const day = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : 'Sem validade');

function Status({ lot }: { lot: Lot }) {
  if (lot.daysLeft === null) return <Badge>Sem validade</Badge>;
  if (lot.daysLeft < 0) return <Badge tone="danger">Vencido há {-lot.daysLeft} dia(s)</Badge>;
  if (lot.daysLeft === 0) return <Badge tone="danger">Vence hoje</Badge>;
  if (lot.daysLeft <= 30) return <Badge tone="warning">Vence em {lot.daysLeft} dia(s)</Badge>;
  return <Badge tone="success">Em dia</Badge>;
}

/**
 * Lote e validade (F5-04): o que está vencendo ou vencido, os lotes de cada produto, a entrada
 * manual de lote, o descarte e o recall (quem levou o lote).
 */
export function LotsPage() {
  const { api } = useApp();
  const canWrite = useCan('catalog.write');
  const [days, setDays] = useState('30');
  const expiring = useQuery({
    queryKey: ['stock-lots', 'expiring', days],
    queryFn: () => api.get<Lot[]>(`/stock/lots?days=${days}`),
  });
  const [product, setProduct] = useState<{ id: string; name: string } | null>(null);
  const byProduct = useQuery({
    queryKey: ['stock-lots', 'product', product?.id],
    queryFn: () => api.get<Lot[]>(`/stock/lots?productId=${product!.id}`),
    enabled: Boolean(product),
  });
  const [open, setOpen] = useState<Lot | null>(null);
  const [registering, setRegistering] = useState(false);
  const columns = [
    { header: 'Produto', cell: (l: Lot) => <span className="font-semibold">{l.productName}</span> },
    { header: 'Lote', cell: (l: Lot) => l.lotCode },
    { header: 'Loja', cell: (l: Lot) => l.storeName },
    { header: 'Validade', cell: (l: Lot) => day(l.expiresOn) },
    { header: 'Situação', cell: (l: Lot) => <Status lot={l} /> },
    {
      header: 'Saldo',
      align: 'right' as const,
      cell: (l: Lot) => `${qty(l.quantityMilli)} ${l.unit}`,
    },
  ];
  return (
    <>
      <PageHeader
        title="Lote e validade"
        description="A venda sai sempre do lote que vence primeiro. Aqui você vê o que está vencendo, informa lotes, descarta vencidos e descobre quem levou um lote."
        actions={canWrite && <Button onClick={() => setRegistering(true)}>Informar lote</Button>}
      />
      <section className="mb-6 flex flex-col gap-3" aria-label="Vencendo">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-lg font-semibold">Vencendo e vencidos</h2>
          <SelectField
            label="Vencendo em até"
            value={days}
            onChange={(e) => setDays(e.target.value)}
            options={['7', '15', '30', '60', '90'].map((d) => ({ value: d, label: `${d} dias` }))}
          />
        </div>
        {expiring.error && <Alert>{(expiring.error as Error).message}</Alert>}
        {expiring.data && expiring.data.length === 0 ? (
          <EmptyState title="Nada vencendo">
            Nenhum lote com saldo vence nos próximos {days} dias.
          </EmptyState>
        ) : (
          (expiring.data?.length ?? 0) > 0 && (
            <DataTable
              caption="Lotes vencendo e vencidos"
              rows={expiring.data!}
              onRowClick={setOpen}
              columns={columns}
            />
          )
        )}
      </section>

      <section className="flex flex-col gap-3" aria-label="Lotes do produto">
        <h2 className="text-lg font-semibold">Lotes de um produto</h2>
        <ProductPicker onPick={setProduct} label="Produto" />
        {product &&
          byProduct.data &&
          (byProduct.data.length === 0 ? (
            <p className="text-muted">{product.name} não tem lote com saldo.</p>
          ) : (
            <DataTable
              caption={`Lotes de ${product.name}`}
              rows={byProduct.data}
              onRowClick={setOpen}
              columns={columns}
            />
          ))}
      </section>

      {open && <LotDrawer lot={open} onClose={() => setOpen(null)} />}
      {registering && <RegisterDrawer onClose={() => setRegistering(false)} />}
    </>
  );
}

function ProductPicker({
  onPick,
  label,
}: {
  onPick: (p: { id: string; name: string; unit: string }) => void;
  label: string;
}) {
  const { api } = useApp();
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const found = useQuery({
    queryKey: ['products', 'lots-search', q],
    queryFn: () => api.get<Page<Product>>(`/products?q=${encodeURIComponent(q)}&limit=8`),
    enabled: q.length >= 2,
  });
  return (
    <div className="flex flex-col gap-2">
      <TextField
        label={label}
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
                onClick={() => {
                  onPick({ id: p.id, name: p.name, unit: p.unit });
                  setSearch('');
                }}
              >
                <span>{p.name}</span>
                {!p.tracksLot && <span className="text-sm text-muted">sem controle de lote</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RegisterDrawer({ onClose }: { onClose: () => void }) {
  const { api } = useApp();
  const queryClient = useQueryClient();
  const stores = useQuery({
    queryKey: ['stores'],
    queryFn: () => api.get<{ id: string; name: string }[]>('/stores'),
  });
  const [product, setProduct] = useState<{ id: string; name: string; unit: string } | null>(null);
  const [storeId, setStoreId] = useState('');
  const store = storeId || stores.data?.[0]?.id || '';
  const [lotCode, setLotCode] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [manufacturedOn, setManufacturedOn] = useState('');
  const [quantity, setQuantity] = useState('');
  const [addsStock, setAddsStock] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      const quantityMilli = parseQuantity(quantity);
      if (!product) throw new Error('Escolha o produto.');
      if (!quantityMilli) throw new Error('Quantidade inválida.');
      await api.post('/stock/lots', {
        storeId: store,
        productId: product.id,
        lotCode,
        expiresOn: expiresOn || null,
        manufacturedOn: manufacturedOn || null,
        quantityMilli,
        addsStock,
      });
      await queryClient.invalidateQueries({ queryKey: ['stock-lots'] });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer open onOpenChange={(o) => !o && onClose()} title="Informar lote">
      <div className="flex flex-col gap-4">
        {error && <Alert>{error}</Alert>}
        {product ? (
          <p>
            Produto: <strong>{product.name}</strong>{' '}
            <Button variant="ghost" onClick={() => setProduct(null)}>
              Trocar
            </Button>
          </p>
        ) : (
          <ProductPicker onPick={setProduct} label="Produto do lote" />
        )}
        <SelectField
          label="Loja"
          value={store}
          onChange={(e) => setStoreId(e.target.value)}
          options={(stores.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
        />
        <TextField
          label="Número do lote"
          value={lotCode}
          onChange={(e) => setLotCode(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Validade"
            type="date"
            value={expiresOn}
            onChange={(e) => setExpiresOn(e.target.value)}
          />
          <TextField
            label="Fabricação (opcional)"
            type="date"
            value={manufacturedOn}
            onChange={(e) => setManufacturedOn(e.target.value)}
          />
        </div>
        <TextField
          label={`Quantidade${product ? ` (${product.unit})` : ''}`}
          inputMode="decimal"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
        <Checkbox
          label="É mercadoria nova (soma no estoque)"
          hint="Desmarque para só identificar o lote de um estoque que já está no sistema."
          checked={addsStock}
          onChange={setAddsStock}
        />
        <Button loading={busy} onClick={() => void save()} disabled={!lotCode.trim()}>
          Salvar lote
        </Button>
      </div>
    </Drawer>
  );
}

function LotDrawer({ lot, onClose }: { lot: Lot; onClose: () => void }) {
  const { api } = useApp();
  const canWrite = useCan('catalog.write');
  const queryClient = useQueryClient();
  const sales = useQuery({
    queryKey: ['stock-lots', lot.id, 'sales'],
    queryFn: () => api.get<LotSale[]>(`/stock/lots/${lot.id}/sales`),
  });
  const [quantity, setQuantity] = useState(qty(lot.quantityMilli));
  const [reason, setReason] = useState(lot.daysLeft !== null && lot.daysLeft < 0 ? 'Vencido' : '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const discard = async () => {
    setError(null);
    setBusy(true);
    try {
      const quantityMilli = parseQuantity(quantity);
      if (!quantityMilli) throw new Error('Quantidade inválida.');
      await api.post(`/stock/lots/${lot.id}/discard`, { quantityMilli, reason });
      await queryClient.invalidateQueries({ queryKey: ['stock-lots'] });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer open onOpenChange={(o) => !o && onClose()} title={`Lote ${lot.lotCode}`}>
      <div className="flex flex-col gap-4">
        <p>
          <strong>{lot.productName}</strong> · {lot.storeName}
          <span className="block text-sm text-muted">
            Validade: {day(lot.expiresOn)}
            {lot.manufacturedOn && ` · fabricação ${day(lot.manufacturedOn)}`} · saldo{' '}
            {qty(lot.quantityMilli)} {lot.unit}
          </span>
        </p>
        <Status lot={lot} />
        <Card className="flex flex-col gap-2">
          <h3 className="font-semibold">Quem levou este lote</h3>
          {sales.data && sales.data.length === 0 && (
            <p className="text-sm text-muted">Nenhuma venda saiu deste lote.</p>
          )}
          {(sales.data?.length ?? 0) > 0 && (
            <ul className="flex flex-col gap-1 text-sm" aria-label="Vendas do lote">
              {sales.data!.map((s) => (
                <li key={s.saleId} className="flex justify-between gap-2">
                  <span>
                    Venda nº {s.terminalSeq} em {new Date(s.occurredAt).toLocaleDateString('pt-BR')}
                    {s.customerTaxId && ` · CPF/CNPJ ${s.customerTaxId}`}
                  </span>
                  <span className="tabular-nums">
                    {qty(s.quantityMilli)} {lot.unit}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        {canWrite && lot.quantityMilli > 0 && (
          <Card className="flex flex-col gap-3">
            <h3 className="font-semibold">Descartar</h3>
            {error && <Alert>{error}</Alert>}
            <TextField
              label={`Quantidade a descartar (${lot.unit})`}
              inputMode="decimal"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
            <TextField
              label="Motivo do descarte"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <Button
              variant="secondary"
              loading={busy}
              disabled={reason.trim().length < 3}
              onClick={() => void discard()}
            >
              Descartar do estoque
            </Button>
          </Card>
        )}
      </div>
    </Drawer>
  );
}
