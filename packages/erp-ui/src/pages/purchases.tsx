import {
  formatBRL,
  formatTaxId,
  type Cents,
  type Page,
  type Product,
  PURCHASE_PURPOSES,
  type PurchasePreview,
  type PurchasePurpose,
  type PurchaseSummary,
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
import { FileUp, PackagePlus } from 'lucide-react';
import { useRef, useState } from 'react';
import { useApp, useCan } from '../context';
import { ReceivedNotes } from './received-notes';
import { ReceivedServices } from './received-services';

interface StoreRow {
  id: string;
  name: string;
  companyId: string;
}

const date = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');
const money = (cents: number) => formatBRL(cents as Cents);
const quantity = (value: string) =>
  Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 4 });

/**
 * Compras pelo XML da NF-e do fornecedor (F3-19): o arquivo vira fornecedor, produtos, custo e
 * estoque de uma vez. Antes de gravar, a tela mostra o que vai acontecer e deixa ajustar.
 */
export function PurchasesPage() {
  const { api } = useApp();
  const canImport = useCan('catalog.write');
  const canFiscal = useCan('fiscal.profile.write');
  const queryClient = useQueryClient();
  const purchases = useQuery({
    queryKey: ['purchases'],
    queryFn: () => api.get<PurchaseSummary[]>('/purchases'),
  });
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ xml: string; data: PurchasePreview } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  /** Uso ou consumo pessoal (LC 214/2025, art. 57): a nota sai do crédito de IBS e CBS. */
  const setPersonalUse = async (p: PurchaseSummary, personalUse: boolean) => {
    setError(null);
    try {
      await api.put(`/purchases/${p.id}/personal-use`, { personalUse });
      await queryClient.invalidateQueries({ queryKey: ['purchases'] });
      await queryClient.invalidateQueries({ queryKey: ['ibs-cbs'] });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  /** Finalidade da compra (F4-14.b.2): CFOP de entrada e crédito do ICMS no arquivo do SPED. */
  const setPurpose = async (p: PurchaseSummary, purpose: PurchasePurpose) => {
    setError(null);
    try {
      await api.put(`/purchases/${p.id}/purpose`, { purpose });
      await queryClient.invalidateQueries({ queryKey: ['purchases'] });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  /** Prévia da entrada a partir do XML (do arquivo ou das notas recebidas, F3-20). */
  const openXml = async (xml: string) => {
    const data = await api.post<PurchasePreview>('/purchases/preview', { xml });
    setPreview({ xml, data });
  };

  const open = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setDone(null);
    try {
      await openXml(await file.text());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      if (input.current) input.current.value = '';
    }
  };

  return (
    <>
      <PageHeader
        title="Compras"
        description="Dê entrada nas compras pelo XML da nota do fornecedor: fornecedor, produtos, custo e estoque de uma vez."
        icon={<PackagePlus />}
        tone="orange"
        actions={
          canImport && (
            <>
              <Button
                size="lg"
                icon={<FileUp className="size-5" aria-hidden />}
                onClick={() => input.current?.click()}
              >
                Importar XML
              </Button>
              <input
                ref={input}
                type="file"
                accept=".xml,text/xml,application/xml"
                className="hidden"
                aria-label="Arquivo XML da nota de compra"
                onChange={(e) => void open(e.target.files?.[0])}
              />
            </>
          )
        }
      />
      <div className="flex flex-col gap-8">
        {(error || done) && (
          <div className="flex flex-col gap-3">
            {error && <Alert>{error}</Alert>}
            {done && (
              <Alert tone="success" title="Entrada feita">
                {done}
              </Alert>
            )}
          </div>
        )}
        <ReceivedNotes
          onImport={async (xml) => {
            setDone(null);
            await openXml(xml);
          }}
        />
        <ReceivedServices />
        <section aria-labelledby="compras-importadas" className="flex flex-col gap-3">
          <h2 id="compras-importadas" className="text-lg font-bold">
            Compras com entrada feita
          </h2>
          {purchases.error && <Alert>{(purchases.error as Error).message}</Alert>}
          {purchases.data && purchases.data.length === 0 ? (
            <EmptyState
              title="Nenhuma compra importada ainda"
              icon={<PackagePlus />}
              tone="orange"
              action={
                canImport && (
                  <Button
                    icon={<FileUp className="size-5" aria-hidden />}
                    onClick={() => input.current?.click()}
                  >
                    Importar o primeiro XML
                  </Button>
                )
              }
            >
              Peça ao fornecedor o XML da nota (ele vem por e-mail) e use "Importar XML". Ou dê
              entrada pelas notas emitidas para a sua empresa, logo acima.
            </EmptyState>
          ) : (
            purchases.data && (
              <DataTable
                caption="Compras"
                rows={purchases.data}
                card={(p) => (
                  <span className="flex min-w-0 flex-1 flex-col gap-2">
                    <span className="flex items-start justify-between gap-3">
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="font-bold">{p.supplierName}</span>
                        <span className="text-sm text-muted">
                          NF-e nº {p.number} · série {p.series} · {date(p.issuedAt)}
                        </span>
                        <span className="text-sm text-muted">
                          {p.storeName} · {p.itemCount} {p.itemCount === 1 ? 'item' : 'itens'}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <span className="text-lg font-extrabold tabular-nums">
                          {money(p.totalCents)}
                        </span>
                        <PurchaseStatus purchase={p} />
                      </span>
                    </span>
                    <PurposeCell purchase={p} canFiscal={canFiscal} onChange={setPurpose} />
                    <PersonalUseCell purchase={p} canFiscal={canFiscal} onChange={setPersonalUse} />
                  </span>
                )}
                columns={[
                  { header: 'Emissão', cell: (p) => date(p.issuedAt) },
                  { header: 'Fornecedor', cell: (p) => p.supplierName },
                  { header: 'NF-e', cell: (p) => `nº ${p.number} · série ${p.series}` },
                  { header: 'Loja', cell: (p) => p.storeName },
                  { header: 'Itens', align: 'right', cell: (p) => String(p.itemCount) },
                  { header: 'Situação', cell: (p) => <PurchaseStatus purchase={p} /> },
                  {
                    header: 'Total',
                    align: 'right',
                    cell: (p) => <span className="font-extrabold">{money(p.totalCents)}</span>,
                  },
                  {
                    header: 'Finalidade',
                    cell: (p) => (
                      <PurposeCell purchase={p} canFiscal={canFiscal} onChange={setPurpose} />
                    ),
                  },
                  {
                    header: 'Uso pessoal',
                    cell: (p) => (
                      <PersonalUseCell
                        purchase={p}
                        canFiscal={canFiscal}
                        onChange={setPersonalUse}
                      />
                    ),
                  },
                ]}
              />
            )
          )}
        </section>
      </div>
      {preview && (
        <ImportDrawer
          xml={preview.xml}
          preview={preview.data}
          onClose={() => setPreview(null)}
          onDone={(message) => {
            setPreview(null);
            setDone(message);
          }}
        />
      )}
    </>
  );
}

function PurchaseStatus({ purchase: p }: { purchase: PurchaseSummary }) {
  return p.authorized ? (
    <Badge tone="success">Autorizada</Badge>
  ) : (
    <Badge tone="warning">Sem protocolo</Badge>
  );
}

/** Finalidade da compra: lista para quem cuida do fiscal, texto para os demais. */
function PurposeCell({
  purchase: p,
  canFiscal,
  onChange,
}: {
  purchase: PurchaseSummary;
  canFiscal: boolean;
  onChange: (p: PurchaseSummary, purpose: PurchasePurpose) => Promise<void>;
}) {
  if (!canFiscal) return <>{PURCHASE_PURPOSES.find((o) => o.id === p.purpose)?.label ?? '—'}</>;
  return (
    <select
      aria-label={`Finalidade (nota nº ${p.number})`}
      className="min-h-11 w-full rounded-ui border border-border bg-surface px-3 md:w-auto"
      value={p.purpose}
      onChange={(e) => void onChange(p, e.target.value as PurchasePurpose)}
    >
      {PURCHASE_PURPOSES.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function PersonalUseCell({
  purchase: p,
  canFiscal,
  onChange,
}: {
  purchase: PurchaseSummary;
  canFiscal: boolean;
  onChange: (p: PurchaseSummary, personalUse: boolean) => Promise<void>;
}) {
  if (canFiscal) {
    return (
      <Checkbox
        label={`Uso pessoal (nota nº ${p.number})`}
        checked={p.personalUse}
        onChange={(value) => void onChange(p, value)}
      />
    );
  }
  return p.personalUse ? <Badge tone="neutral">Uso pessoal</Badge> : <>—</>;
}

interface Decision {
  productId: string | null;
  factor: string;
  unit: string;
  priceCents: number | null;
  name: string;
}

function ImportDrawer({
  xml,
  preview,
  onClose,
  onDone,
}: {
  xml: string;
  preview: PurchasePreview;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { api } = useApp();
  const queryClient = useQueryClient();
  const stores = useQuery({ queryKey: ['stores'], queryFn: () => api.get<StoreRow[]>('/stores') });
  const units = useQuery({
    queryKey: ['units'],
    queryFn: () => api.get<{ code: string; description: string }[]>('/units'),
  });
  const products = useQuery({
    queryKey: ['products', 'all'],
    queryFn: () => api.get<Page<Product>>('/products?limit=200'),
  });
  const companyStores = stores.data?.filter((s) => s.companyId === preview.company.id) ?? [];
  const [storeId, setStoreId] = useState('');
  const chosenStore = storeId || companyStores[0]?.id || '';
  const unitCodes = new Set(units.data?.map((u) => u.code));
  const [decisions, setDecisions] = useState<Record<number, Decision>>(() =>
    Object.fromEntries(
      preview.items.map((item) => [
        item.line,
        {
          productId: item.suggestion?.productId ?? null,
          factor: item.suggestion?.factor ?? '1',
          unit: item.unit.toUpperCase(),
          priceCents: null,
          name: item.catalog?.description ?? item.description,
        },
      ]),
    ),
  );
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const blocked = !preview.signature.valid || preview.alreadyImported;

  const set = (line: number, patch: Partial<Decision>) =>
    setDecisions((all) => ({ ...all, [line]: { ...all[line]!, ...patch } }));

  const submit = async () => {
    setError(null);
    setSending(true);
    try {
      const result = await api.post<{ items: number; createdProducts: number }>('/purchases', {
        xml,
        storeId: chosenStore,
        items: preview.items.map((item) => {
          const d = decisions[item.line]!;
          return d.productId
            ? { line: item.line, productId: d.productId, factor: d.factor }
            : {
                line: item.line,
                productId: null,
                factor: d.factor,
                unit: unitCodes.has(d.unit) ? d.unit : 'UN',
                ...(d.name.trim() && { name: d.name.trim() }),
                ...(d.priceCents !== null && { priceCents: d.priceCents }),
              };
        }),
      });
      await Promise.all(
        ['purchases', 'products', 'stock', 'parties'].map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      );
      onDone(
        `NF-e ${preview.number} de ${preview.supplier.name}: ${result.items} item(ns) no estoque` +
          (result.createdProducts
            ? `, ${result.createdProducts} produto(s) novo(s) cadastrado(s).`
            : '.'),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <Drawer open onOpenChange={(o) => !o && onClose()} title={`Entrada da NF-e ${preview.number}`}>
      <div className="flex flex-col gap-4">
        {preview.alreadyImported && <Alert>Esta nota já foi importada antes.</Alert>}
        {!preview.signature.valid && (
          <Alert>
            A assinatura digital não confere: o XML foi alterado ou não é o original do fornecedor.
            Peça o arquivo de novo.
          </Alert>
        )}
        {preview.signature.valid && !preview.signature.trusted && (
          <Alert tone="warning" title="Certificado fora da ICP-Brasil">
            A nota está íntegra, mas o certificado de quem assinou não é da ICP-Brasil. Normal em
            notas de teste.
          </Alert>
        )}
        {!preview.authorized && (
          <Alert tone="warning" title="Sem a autorização da SEFAZ">
            O arquivo não traz o protocolo de autorização. Confira a chave no portal da SEFAZ antes
            de dar entrada.
          </Alert>
        )}
        {preview.environment === 'homologacao' && (
          <Alert tone="warning" title="Nota de homologação">
            Emitida em ambiente de testes, sem valor fiscal.
          </Alert>
        )}
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-muted">Fornecedor</dt>
          <dd>
            {preview.supplier.name} · {formatTaxId(preview.supplier.taxId)}{' '}
            {preview.supplier.id ? (
              <Badge>Já cadastrado</Badge>
            ) : (
              <Badge tone="success">Novo</Badge>
            )}
          </dd>
          <dt className="text-muted">Para</dt>
          <dd>{preview.company.name}</dd>
          <dt className="text-muted">Emissão</dt>
          <dd>{date(preview.issuedAt)}</dd>
          <dt className="text-muted">Total da nota</dt>
          <dd className="font-semibold">{money(preview.totalCents)}</dd>
        </dl>
        <SelectField
          label="Loja que recebe a mercadoria"
          value={chosenStore}
          onChange={(e) => setStoreId(e.target.value)}
          options={companyStores.map((s) => ({ value: s.id, label: s.name }))}
        />
        <ol className="flex flex-col gap-3">
          {preview.items.map((item) => {
            const d = decisions[item.line]!;
            return (
              <li key={item.line} className="rounded-ui border border-border p-3">
                <p className="font-semibold">
                  {item.line}. {item.description}
                </p>
                <p className="text-sm text-muted">
                  {quantity(item.quantity)} {item.unit} · {money(item.totalCents)} · código{' '}
                  {item.supplierCode}
                  {item.gtin && ` · EAN ${item.gtin}`}
                </p>
                {item.catalog && !d.productId && (
                  <p className="text-sm">
                    <Badge tone="success">No catálogo</Badge>{' '}
                    {[item.catalog.description, item.catalog.brand, item.catalog.packageDescription]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                )}
                {item.netLoad && item.netLoad.status !== 'not-listed' && (
                  <p className="text-sm">
                    <Badge tone={item.netLoad.status === 'applies' ? 'neutral' : 'warning'}>
                      {item.netLoad.status === 'applies'
                        ? `ST de entrada ${money(item.netLoad.stCents)}`
                        : 'ST de entrada: falta configurar'}
                    </Badge>{' '}
                    {[item.netLoad.message, ...item.netLoad.warnings].join(' ')}
                    {d.productId !== (item.suggestion?.productId ?? null) &&
                      ' A conta da prévia é pelo produto sugerido; a compra refaz pelo escolhido.'}
                  </p>
                )}
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <SelectField
                    label={`Produto do item ${item.line}`}
                    value={d.productId ?? ''}
                    onChange={(e) => set(item.line, { productId: e.target.value || null })}
                    hint={
                      item.suggestion
                        ? item.suggestion.via === 'fornecedor'
                          ? 'Associado na compra anterior deste fornecedor.'
                          : 'Achado pelo código de barras.'
                        : undefined
                    }
                    options={[
                      { value: '', label: 'Cadastrar produto novo' },
                      ...(products.data?.items ?? []).map((p) => ({ value: p.id, label: p.name })),
                    ]}
                  />
                  <TextField
                    label={`Unidades de estoque por ${item.unit}`}
                    inputMode="decimal"
                    value={d.factor}
                    onChange={(e) => set(item.line, { factor: e.target.value })}
                  />
                  {!d.productId && (
                    <>
                      <TextField
                        label={`Nome do produto novo (item ${item.line})`}
                        value={d.name}
                        onChange={(e) => set(item.line, { name: e.target.value })}
                      />
                      <SelectField
                        label={`Unidade do produto novo (item ${item.line})`}
                        value={unitCodes.has(d.unit) ? d.unit : 'UN'}
                        onChange={(e) => set(item.line, { unit: e.target.value })}
                        options={(units.data ?? []).map((u) => ({
                          value: u.code,
                          label: `${u.code} · ${u.description}`,
                        }))}
                      />
                      <MoneyField
                        label={`Preço de venda (item ${item.line})`}
                        value={d.priceCents}
                        onChange={(cents) => set(item.line, { priceCents: cents })}
                      />
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
        {error && <Alert>{error}</Alert>}
        <Button onClick={submit} disabled={blocked || sending || !chosenStore}>
          {sending ? 'Dando entrada...' : 'Dar entrada no estoque'}
        </Button>
      </div>
    </Drawer>
  );
}
