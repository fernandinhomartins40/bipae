import { formatBRL, type Cents, type Page, type Product } from '@bipae/domain';
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
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useApp, useCan } from '../context';

// ---------------------------------------------------------------- tipos do contrato (seção 6)

interface ConfereStatus {
  enabled: boolean;
  termsAccepted: boolean;
  termsVersion: string;
  termsText: string;
  balance: number;
  pricePerReadCents?: number;
  plans?: { id: string; name: string; reads: number; priceCents: number }[];
  certificate: {
    cnpj: string;
    holder: string;
    notAfter: string;
    expired?: boolean;
    lastSyncAt?: string | null;
  } | null;
  pixAvailable?: boolean;
}

interface ConfereDocument {
  id: string;
  accessKey: string;
  completeness?: 'SUMMARY' | 'FULL' | string;
  emitterName?: string;
  number?: string;
  issuedAt?: string;
  totalValue?: number;
  itemsCount?: number;
  checkStatus?: 'OPEN' | 'DONE' | null;
}

interface EntryItem {
  item: number;
  gtin?: string | null;
  packGtin?: string | null;
  supplierCode?: string | null;
  invoiceDescription?: string | null;
  description?: string | null;
  invoiceUnit?: string | null;
  invoiceQuantity?: number | null;
  unitsPerPack?: number | null;
  priceVariation?: number | null;
}

interface Entry {
  documentId: string;
  accessKey: string;
  number?: string;
  supplierName?: string | null;
  checkStatus?: string;
  items: EntryItem[];
}

interface LocalEntry {
  documentId: string;
  checkId: string;
  status: 'applied' | 'needs_products';
}

interface SupplierIssue {
  id: string;
  supplierName: string;
  invoiceNumber: string | null;
  item: number;
  description: string;
  kind: 'FALTA' | 'SOBRA' | 'AVARIA' | 'VALIDADE' | 'TROCADO';
  expectedMilli: number | null;
  receivedMilli: number | null;
  status: 'aberta' | 'resolvida';
}

interface StoreRow {
  id: string;
  name: string;
}

const money = (value: number | undefined) =>
  value === undefined ? '—' : formatBRL(Math.round(value * 100) as Cents);
const date = (iso: string | undefined | null) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR') : '—';
const ISSUE_LABELS: Record<SupplierIssue['kind'], string> = {
  FALTA: 'Falta',
  SOBRA: 'Sobra',
  AVARIA: 'Avaria',
  VALIDADE: 'Validade',
  TROCADO: 'Produto trocado',
};

/**
 * Compras → Notas de entrada (Confere, MF-09). A leitura na SEFAZ, o certificado e a conferência
 * ficam no MercadoFlow; o Bipaê mostra as notas, conduz a conferência e dá entrada no estoque.
 */
export function ConferePage() {
  const { api } = useApp();
  const stores = useQuery({ queryKey: ['stores'], queryFn: () => api.get<StoreRow[]>('/stores') });
  const [chosen, setChosen] = useState('');
  const storeId = chosen || stores.data?.[0]?.id || '';
  const [tab, setTab] = useState<'notas' | 'pendencias'>('notas');
  return (
    <>
      <PageHeader
        title="Notas de entrada"
        description="As notas dos fornecedores chegam sozinhas da SEFAZ. Confira bipando e dê entrada no estoque."
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        {stores.data && stores.data.length > 1 && (
          <SelectField
            label="Loja"
            value={storeId}
            onChange={(e) => setChosen(e.target.value)}
            options={stores.data.map((s) => ({ value: s.id, label: s.name }))}
          />
        )}
        <Button variant={tab === 'notas' ? 'primary' : 'ghost'} onClick={() => setTab('notas')}>
          Notas
        </Button>
        <Button
          variant={tab === 'pendencias' ? 'primary' : 'ghost'}
          onClick={() => setTab('pendencias')}
        >
          Pendências com fornecedor
        </Button>
      </div>
      {storeId && tab === 'notas' && <StoreConfere storeId={storeId} />}
      {tab === 'pendencias' && <SupplierIssues />}
    </>
  );
}

function StoreConfere({ storeId }: { storeId: string }) {
  const { api } = useApp();
  const status = useQuery({
    queryKey: ['confere', storeId, 'status'],
    queryFn: () => api.get<ConfereStatus>(`/mercadoflow/confere/${storeId}/status`),
    retry: false,
  });
  if (status.error) {
    return (
      <Card>
        <p className="text-lg font-semibold">Ative o Confere: crie sua conta grátis</p>
        <p className="mt-1 text-sm text-muted">{(status.error as Error).message}</p>
        <Link className="mt-3 inline-block text-primary underline" to="/mercadoflow">
          Ir para MercadoFlow
        </Link>
      </Card>
    );
  }
  if (!status.data) return null;
  if (!status.data.termsAccepted) return <Terms storeId={storeId} status={status.data} />;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <CertificateCard storeId={storeId} status={status.data} />
        <BalanceCard storeId={storeId} status={status.data} />
      </div>
      <Documents storeId={storeId} />
    </div>
  );
}

function Terms({ storeId, status }: { storeId: string; status: ConfereStatus }) {
  const { api } = useApp();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  return (
    <Card>
      <h2 className="text-lg font-bold">Termos do Confere</h2>
      <p className="mt-2 whitespace-pre-wrap text-sm">{status.termsText}</p>
      {error && <Alert>{error}</Alert>}
      <Button
        className="mt-3"
        onClick={async () => {
          try {
            await api.post(`/mercadoflow/confere/${storeId}/terms`, {
              version: status.termsVersion,
            });
            await queryClient.invalidateQueries({ queryKey: ['confere', storeId] });
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        Aceito
      </Button>
    </Card>
  );
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    reader.readAsDataURL(file);
  });
}

function CertificateCard({ storeId, status }: { storeId: string; status: ConfereStatus }) {
  const { api } = useApp();
  const queryClient = useQueryClient();
  const canWrite = useCan('fiscal.profile.write');
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [uf, setUf] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cert = status.certificate;
  // A hora de agora fica fixa enquanto a tela está aberta (o React não aceita relógio no render).
  const [now] = useState(() => Date.now());
  const days = cert ? Math.ceil((new Date(cert.notAfter).getTime() - now) / 86_400_000) : null;

  const send = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!file) return setError('Escolha o arquivo do certificado (.pfx ou .p12).');
    setBusy(true);
    try {
      await api.post(`/mercadoflow/confere/${storeId}/certificate`, {
        pfxBase64: await readBase64(file),
        password,
        uf,
      });
      setPassword('');
      await queryClient.invalidateQueries({ queryKey: ['confere', storeId, 'status'] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <h2 className="text-lg font-bold">Certificado digital A1</h2>
      <p className="text-sm text-muted">
        Com ele, as notas emitidas contra o CNPJ da loja chegam sozinhas, a cada hora, sem gastar
        leituras. O arquivo e a senha vão direto ao MercadoFlow; o Bipaê não guarda.
      </p>
      {cert && (
        <p
          className={`mt-2 text-sm ${days !== null && days < 30 ? 'font-semibold text-danger' : ''}`}
        >
          {cert.holder}, válido até {date(cert.notAfter)}
          {days !== null && days < 30 && ` (vence em ${Math.max(days, 0)} dia(s))`}.
        </p>
      )}
      {error && <Alert>{error}</Alert>}
      {canWrite && (
        <form onSubmit={send} className="mt-3 flex flex-col gap-2" noValidate>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold">
              {cert ? 'Trocar o certificado' : 'Arquivo do certificado'}
            </span>
            <input
              type="file"
              accept=".pfx,.p12"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <TextField
            label="Senha do certificado"
            type="password"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <TextField
            label="UF da loja"
            maxLength={2}
            value={uf}
            onChange={(e) => setUf(e.target.value.toUpperCase())}
          />
          <Button type="submit" loading={busy}>
            Enviar certificado
          </Button>
        </form>
      )}
    </Card>
  );
}

function BalanceCard({ storeId, status }: { storeId: string; status: ConfereStatus }) {
  const { api } = useApp();
  const canBuy = useCan('admin.stores');
  const [order, setOrder] = useState<{
    id: string;
    pixPayload?: string;
    status: string;
    reads?: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const buy = async (planId: string) => {
    setError(null);
    try {
      setOrder(await api.post(`/mercadoflow/confere/${storeId}/orders`, { planId }));
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <Card>
      <h2 className="text-lg font-bold">Leituras pela chave</h2>
      <p className="text-sm">
        Saldo: <span className="font-semibold">{status.balance}</span> leitura(s). Sem certificado,
        cada nota lida pela chave gasta 1 leitura.
      </p>
      {error && <Alert>{error}</Alert>}
      {canBuy && (status.plans ?? []).length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {status.plans!.map((plan) => (
            <Button key={plan.id} variant="secondary" onClick={() => void buy(plan.id)}>
              {plan.reads} leituras por {formatBRL(plan.priceCents as Cents)}
            </Button>
          ))}
        </div>
      )}
      {order?.pixPayload && (
        <div className="mt-3 flex flex-col gap-2 text-sm">
          <p>
            Pague com o Pix copia e cola abaixo. O saldo entra assim que o pagamento for confirmado.
          </p>
          <code className="break-all rounded bg-surface-2 p-2">{order.pixPayload}</code>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              onClick={() => void navigator.clipboard?.writeText(order.pixPayload!)}
            >
              Copiar o Pix
            </Button>
            <Button
              variant="ghost"
              onClick={async () =>
                setOrder(await api.get(`/mercadoflow/confere/${storeId}/orders/${order.id}`))
              }
            >
              Já paguei
            </Button>
          </div>
          {order.status === 'PAID' && <Alert tone="success">Pagamento confirmado.</Alert>}
        </div>
      )}
    </Card>
  );
}

function Documents({ storeId }: { storeId: string }) {
  const { api } = useApp();
  const queryClient = useQueryClient();
  const canWrite = useCan('catalog.write');
  const documents = useQuery({
    queryKey: ['confere', storeId, 'documents'],
    queryFn: () =>
      api.get<{ items: ConfereDocument[]; entries: LocalEntry[] }>(
        `/mercadoflow/confere/${storeId}/documents`,
      ),
  });
  const [key, setKey] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const reload = () => queryClient.invalidateQueries({ queryKey: ['confere', storeId] });

  const run = async (fn: () => Promise<string>) => {
    setMessage(null);
    try {
      setMessage({ ok: true, text: await fn() });
      await reload();
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    }
  };

  const entered = (doc: ConfereDocument) =>
    documents.data?.entries.find((e) => e.documentId === doc.id && e.status === 'applied');

  return (
    <Card>
      <div className="flex flex-wrap items-end gap-2">
        {canWrite && (
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const read = await api.post<{ charged: boolean; balance: number }>(
                  `/mercadoflow/confere/${storeId}/read`,
                  {
                    accessKey: key.replace(/\D/g, ''),
                  },
                );
                setKey('');
                return read.charged
                  ? `Nota lida. Saldo: ${read.balance} leitura(s).`
                  : 'Nota lida.';
              });
            }}
          >
            <TextField
              label="Ler pela chave (bipe o DANFE)"
              inputMode="numeric"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <Button type="submit">Ler</Button>
          </form>
        )}
        {canWrite && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold">Importar XML</span>
            <input
              type="file"
              accept=".xml,text/xml"
              aria-label="Importar XML da nota"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file)
                  void run(async () => {
                    await api.post(`/mercadoflow/confere/${storeId}/upload`, {
                      xml: await file.text(),
                    });
                    return 'XML importado.';
                  });
              }}
            />
          </label>
        )}
        {canWrite && (
          <Button
            variant="ghost"
            onClick={() =>
              void run(async () => {
                await api.post(`/mercadoflow/confere/${storeId}/sync`);
                return 'Buscando as notas na SEFAZ. Elas aparecem aqui em alguns minutos.';
              })
            }
          >
            Buscar notas agora
          </Button>
        )}
      </div>
      {message && (
        <div className="mt-3">
          <Alert tone={message.ok ? 'success' : 'danger'}>{message.text}</Alert>
        </div>
      )}
      <div className="mt-4">
        {documents.data && documents.data.items.length === 0 ? (
          <EmptyState title="Nenhuma nota ainda">
            Com o certificado, as notas chegam sozinhas.
          </EmptyState>
        ) : (
          documents.data && (
            <DataTable
              caption="Notas de entrada"
              rows={documents.data.items}
              onRowClick={(doc) => setOpen(doc.id)}
              columns={[
                { header: 'Fornecedor', cell: (d) => d.emitterName ?? '—' },
                { header: 'NF-e', cell: (d) => d.number ?? '—' },
                { header: 'Emissão', cell: (d) => date(d.issuedAt) },
                { header: 'Itens', align: 'right', cell: (d) => String(d.itemsCount ?? '—') },
                {
                  header: 'Situação',
                  cell: (d) =>
                    entered(d) ? (
                      <Badge tone="success">No estoque</Badge>
                    ) : d.completeness === 'SUMMARY' ? (
                      <Badge>Aguardando a SEFAZ liberar os produtos</Badge>
                    ) : d.checkStatus === 'DONE' ? (
                      <Badge tone="warning">Conferida, falta dar entrada</Badge>
                    ) : d.checkStatus === 'OPEN' ? (
                      <Badge tone="warning">Em conferência</Badge>
                    ) : (
                      <Badge tone="warning">Para conferir</Badge>
                    ),
                },
                { header: 'Total', align: 'right', cell: (d) => money(d.totalValue) },
              ]}
            />
          )
        )}
      </div>
      {open && (
        <CheckDrawer
          storeId={storeId}
          documentId={open}
          onClose={() => setOpen(null)}
          onDone={reload}
        />
      )}
    </Card>
  );
}

type Counts = Record<string, { counted: number; issue?: 'AVARIA' | 'VALIDADE' | 'TROCADO' }>;

/** Conferência cega ou aberta, bipando; salva a cada item e, no fim, dá entrada no estoque. */
function CheckDrawer({
  storeId,
  documentId,
  onClose,
  onDone,
}: {
  storeId: string;
  documentId: string;
  onClose: () => void;
  onDone: () => Promise<unknown>;
}) {
  const { api } = useApp();
  const detail = useQuery({
    queryKey: ['confere', storeId, 'document', documentId],
    queryFn: () =>
      api.get<{ entry: Entry }>(`/mercadoflow/confere/${storeId}/documents/${documentId}`),
  });
  const products = useQuery({
    queryKey: ['products', 'all'],
    queryFn: () => api.get<Page<Product>>('/products?limit=200'),
  });
  const [blind, setBlind] = useState(true);
  const [counts, setCounts] = useState<Counts>({});
  const [scan, setScan] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [missing, setMissing] = useState<{ item: number; description: string }[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [finished, setFinished] = useState(false);
  const entry = detail.data?.entry;

  const save = async (next: Counts, finish = false) => {
    setCounts(next);
    try {
      await api.put(`/mercadoflow/confere/${storeId}/documents/${documentId}/check`, {
        counts: next,
        blind,
        finish,
      });
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    }
  };

  const bump = (item: number, delta: number) => {
    const current = counts[String(item)]?.counted ?? 0;
    void save({
      ...counts,
      [String(item)]: { ...counts[String(item)], counted: Math.max(0, current + delta) },
    });
  };

  const onScan = (e: FormEvent) => {
    e.preventDefault();
    const code = scan.trim();
    setScan('');
    if (!entry || !code) return;
    const byPack = entry.items.find((i) => i.packGtin === code);
    if (byPack) {
      setMessage(null);
      return bump(byPack.item, 1);
    }
    const byUnit = entry.items.find((i) => i.gtin === code);
    if (!byUnit) return setMessage({ ok: false, text: `O código ${code} não está nesta nota.` });
    if ((byUnit.unitsPerPack ?? 1) > 1) {
      return setMessage({
        ok: false,
        text: `Isto é 1 unidade; a nota está em ${(byUnit.invoiceUnit ?? 'caixa').toLowerCase()} de ${byUnit.unitsPerPack}.`,
      });
    }
    setMessage(null);
    bump(byUnit.item, 1);
  };

  const summary = entry
    ? entry.items.reduce(
        (s, i) => {
          const c = counts[String(i.item)];
          if (!c) return s;
          const expected = i.invoiceQuantity ?? 0;
          if (c.counted < expected) s.faltas++;
          if (c.counted > expected) s.sobras++;
          if (c.issue) s.avarias++;
          return s;
        },
        { faltas: 0, sobras: 0, avarias: 0 },
      )
    : { faltas: 0, sobras: 0, avarias: 0 };
  const rising = entry?.items.filter((i) => (i.priceVariation ?? 0) > 5) ?? [];

  const finish = async () => {
    await save(counts, true);
    setFinished(true);
    await enter();
  };

  const enter = async (direct = false) => {
    try {
      const result = await api.post<{
        status: string;
        missing: { item: number; description: string }[];
        applied: number;
      }>(`/mercadoflow/confere/${storeId}/documents/${documentId}/entry`, { mapping, direct });
      if (result.status === 'needs_products') {
        setMissing(result.missing);
        setMessage({
          ok: false,
          text: 'Alguns produtos desta nota ainda não existem no Bipaê. Associe ou cadastre cada um.',
        });
      } else {
        setMissing([]);
        setMessage({
          ok: true,
          text:
            result.status === 'already_applied'
              ? 'Esta conferência já tinha dado entrada.'
              : `Entrada feita: ${result.applied} item(ns) no estoque.`,
        });
        await onDone();
      }
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    }
  };

  return (
    <Drawer
      open
      onOpenChange={(o) => !o && onClose()}
      title={entry ? `Conferência da NF-e ${entry.number ?? ''}` : 'Conferência'}
    >
      {!entry ? (
        <p className="text-muted">Carregando a nota...</p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">{entry.supplierName}</p>
          <Checkbox
            label="Conferência cega (esconde as quantidades da nota)"
            checked={blind}
            onChange={setBlind}
          />
          <form onSubmit={onScan}>
            <TextField
              label="Bipe o produto ou a caixa"
              value={scan}
              onChange={(e) => setScan(e.target.value)}
              autoFocus
            />
          </form>
          {message && <Alert tone={message.ok ? 'success' : 'danger'}>{message.text}</Alert>}
          <ul className="flex flex-col gap-2">
            {entry.items.map((i) => {
              const c = counts[String(i.item)];
              return (
                <li key={i.item} className="rounded-ui border border-border p-2">
                  <p className="font-semibold">
                    {i.item}. {i.description ?? i.invoiceDescription}
                  </p>
                  <p className="text-sm text-muted">
                    Código {i.supplierCode ?? '—'}
                    {!blind && ` · Nota: ${i.invoiceQuantity ?? '—'} ${i.invoiceUnit ?? ''}`}
                  </p>
                  <div className="mt-1 flex flex-wrap items-end gap-2">
                    <TextField
                      label={`Contei (item ${i.item})`}
                      inputMode="decimal"
                      value={c ? String(c.counted) : ''}
                      onChange={(e) => {
                        const counted = Number(e.target.value.replace(',', '.'));
                        if (Number.isFinite(counted))
                          void save({ ...counts, [String(i.item)]: { ...c, counted } });
                      }}
                    />
                    {(['AVARIA', 'VALIDADE', 'TROCADO'] as const).map((issue) => (
                      <Button
                        key={issue}
                        variant={c?.issue === issue ? 'primary' : 'ghost'}
                        onClick={() =>
                          void save({
                            ...counts,
                            [String(i.item)]: {
                              counted: c?.counted ?? 0,
                              ...(c?.issue !== issue && { issue }),
                            },
                          })
                        }
                      >
                        {ISSUE_LABELS[issue]}
                      </Button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
          <Card>
            <p className="text-sm">
              Faltas: {summary.faltas} · Sobras: {summary.sobras} · Avarias e outras:{' '}
              {summary.avarias}
            </p>
            {rising.length > 0 && (
              <p className="text-sm text-danger">
                Preço subiu mais de 5%:{' '}
                {rising.map((i) => i.description ?? i.invoiceDescription).join(', ')}
              </p>
            )}
          </Card>
          {missing.length > 0 && (
            <div className="flex flex-col gap-2">
              {missing.map((m) => (
                <SelectField
                  key={m.item}
                  label={`Produto do item ${m.item}: ${m.description}`}
                  value={mapping[String(m.item)] ?? ''}
                  onChange={(e) => setMapping({ ...mapping, [String(m.item)]: e.target.value })}
                  options={[
                    { value: '', label: 'Escolha o produto' },
                    ...(products.data?.items ?? []).map((p) => ({ value: p.id, label: p.name })),
                  ]}
                />
              ))}
              <p className="text-sm text-muted">
                Não está na lista? Cadastre em{' '}
                <Link className="underline" to="/produtos">
                  Produtos
                </Link>{' '}
                (o catálogo preenche os dados) e volte aqui.
              </p>
              <Button onClick={() => void enter()}>Dar entrada no estoque</Button>
            </div>
          )}
          {!finished && missing.length === 0 && (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void finish()}>Concluir conferência e dar entrada</Button>
              <Button variant="ghost" onClick={() => void enter(true)}>
                Entrada direta pela nota (sem conferir)
              </Button>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

function SupplierIssues() {
  const { api } = useApp();
  const queryClient = useQueryClient();
  const issues = useQuery({
    queryKey: ['supplier-issues'],
    queryFn: () => api.get<SupplierIssue[]>('/mercadoflow/supplier-issues'),
  });
  const open = issues.data?.filter((i) => i.status === 'aberta') ?? [];
  if (issues.data && open.length === 0)
    return <EmptyState title="Nenhuma pendência com fornecedor" />;
  return (
    <DataTable
      caption="Pendências com fornecedor"
      rows={open}
      columns={[
        { header: 'Fornecedor', cell: (i) => i.supplierName },
        { header: 'NF-e', cell: (i) => i.invoiceNumber ?? '—' },
        { header: 'Item', cell: (i) => `${i.item}. ${i.description}` },
        { header: 'O quê', cell: (i) => <Badge tone="warning">{ISSUE_LABELS[i.kind]}</Badge> },
        {
          header: 'Quantidade',
          cell: (i) =>
            i.expectedMilli !== null && i.receivedMilli !== null
              ? `${i.receivedMilli / 1000} de ${i.expectedMilli / 1000}`
              : '—',
        },
        {
          header: '',
          cell: (i) => (
            <Button
              variant="ghost"
              onClick={async () => {
                await api.post(`/mercadoflow/supplier-issues/${i.id}/resolve`, {});
                await queryClient.invalidateQueries({ queryKey: ['supplier-issues'] });
              }}
            >
              Resolvida
            </Button>
          ),
        },
      ]}
    />
  );
}
