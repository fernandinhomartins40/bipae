import {
  formatBRL,
  formatTaxId,
  UFS,
  type Cents,
  type NfeInvoiceInput,
  type NfeInvoiceView,
  type Page,
  type Party,
  type Product,
} from '@bipae/domain';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Drawer,
  EmptyState,
  Field,
  MoneyField,
  PageHeader,
  SelectField,
  TaxIdField,
  TextField,
} from '@bipae/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useApp, useCan } from '../context';
import { CityPicker } from './companies';
import { parseQuantity } from './purchase-orders';

const money = (cents: number) => formatBRL(cents as Cents);
const day = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');
const qtyText = (milli: number) =>
  (milli / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
/** Mesma regra da API: preço × quantidade ÷ 1000, meio para cima. */
const lineGross = (priceCents: number, milli: number) => Math.round((priceCents * milli) / 1000);

/** Baixa um arquivo da API com a sessão de quem está logado (o link direto não leva o token). */
async function saveFile(
  api: { download: (path: string) => Promise<Blob> },
  path: string,
  name: string,
) {
  const url = URL.createObjectURL(await api.download(path));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const PRESENCE = [
  { value: 'presencial', label: 'Presencial, na loja' },
  { value: 'teleatendimento', label: 'Por telefone ou mensagem' },
  { value: 'internet', label: 'Pela internet' },
  { value: 'entregaEmDomicilio', label: 'Entrega em domicílio (NFC-e não usada)' },
  { value: 'presencialForaDoEstabelecimento', label: 'Presencial, fora da loja' },
  { value: 'outros', label: 'Outros' },
];
const FREIGHT = [
  { value: 'semFrete', label: 'Sem frete' },
  { value: 'porContaDoRemetente', label: 'Por conta de quem vende (CIF)' },
  { value: 'porContaDoDestinatario', label: 'Por conta de quem compra (FOB)' },
  { value: 'porContaDeTerceiros', label: 'Por conta de terceiros' },
  { value: 'proprioPorContaDoRemetente', label: 'Transporte próprio de quem vende' },
  { value: 'proprioPorContaDoDestinatario', label: 'Transporte próprio de quem compra' },
];
const IE_INDICATOR = [
  { value: '1', label: 'Contribuinte do ICMS (tem inscrição estadual)' },
  { value: '2', label: 'Contribuinte isento de inscrição' },
  { value: '9', label: 'Não contribuinte (pessoa física, por exemplo)' },
];

/** A situação da nota em uma palavra, com a cor do aviso. */
function status(n: NfeInvoiceView): {
  label: string;
  tone: 'warning' | 'success' | 'neutral' | 'danger';
} {
  const d = n.document;
  if (!d)
    return n.check.ok
      ? { label: 'Rascunho', tone: 'neutral' }
      : { label: 'Falta resolver', tone: 'warning' };
  if (d.status === 'authorized') return { label: 'Autorizada', tone: 'success' };
  if (d.status === 'rejected') return { label: 'Recusada', tone: 'danger' };
  if (d.status === 'denied') return { label: 'Uso denegado', tone: 'danger' };
  if (d.status === 'not_configured') return { label: 'Falta configurar', tone: 'warning' };
  if (d.status === 'error') return { label: 'Tentando de novo', tone: 'warning' };
  if (d.status === 'cancelled') return { label: 'Cancelada', tone: 'neutral' };
  return { label: 'Enviando', tone: 'warning' };
}

/**
 * NF-e da retaguarda (F3-33.c): venda para empresa, para consumidor de outro estado ou com
 * entrega, preenchida aqui e enviada à SEFAZ de homologação pelo servidor.
 */
export function NfePage() {
  const { api } = useApp();
  const canWrite = useCan('fiscal.profile.write');
  const list = useQuery({
    queryKey: ['nfe'],
    queryFn: () => api.get<NfeInvoiceView[]>('/fiscal/nfe'),
    // Enquanto alguma nota está na fila, a lista se atualiza sozinha.
    refetchInterval: (q) =>
      (q.state.data ?? []).some(
        (n) => n.document && ['pending', 'error'].includes(n.document.status),
      )
        ? 2000
        : false,
  });
  // Vindo de outra tela (ex.: o condicional), abre a nota do link.
  const [params] = useSearchParams();
  const [open, setOpen] = useState<string | 'new' | null>(params.get('abrir'));
  const rows = list.data ?? [];
  return (
    <>
      <PageHeader
        title="NF-e"
        description="Nota fiscal eletrônica de venda para empresas, para outros estados ou com entrega. Emitida em homologação, sem valor fiscal, enquanto o Bipaê não é liberado para produção."
        actions={
          canWrite && (
            <Button icon={<Plus className="size-4" aria-hidden />} onClick={() => setOpen('new')}>
              Nova NF-e
            </Button>
          )
        }
      />
      {list.error && <Alert>{(list.error as Error).message}</Alert>}
      {list.data && rows.length === 0 ? (
        <EmptyState title="Nenhuma NF-e ainda">
          Preencha o destinatário e os itens: o Bipaê calcula os impostos, mostra o que falta e
          envia à SEFAZ.
        </EmptyState>
      ) : (
        rows.length > 0 && (
          <DataTable
            caption="Notas fiscais eletrônicas"
            rows={rows}
            onRowClick={(r) => setOpen(r.id)}
            columns={[
              {
                header: 'Nº',
                cell: (r) =>
                  r.document?.number ? `${r.document.number} (série ${r.document.series})` : '—',
              },
              { header: 'Destinatário', cell: (r) => r.recipient.name },
              { header: 'Criada em', cell: (r) => day(r.createdAt) },
              {
                header: 'Valor',
                align: 'right',
                cell: (r) => money(r.check.totalCents ?? r.totalCents),
              },
              {
                header: 'Situação',
                cell: (r) => <Badge tone={status(r).tone}>{status(r).label}</Badge>,
              },
            ]}
          />
        )
      )}
      {open && (
        <NfeDrawer
          id={open === 'new' ? null : open}
          onClose={() => setOpen(null)}
          onCreated={(id) => setOpen(id)}
        />
      )}
    </>
  );
}

interface Line {
  productId: string;
  name: string;
  unit: string;
  quantity: string;
  unitPriceCents: number;
  discountCents: number;
  cfop: string;
  /** Na devolução: de qual nota (chave) e de qual item dela este produto volta. */
  refKey: string;
  refItem: string;
}

interface Draft {
  companyId: string;
  storeId: string;
  nature: string;
  presence: string;
  purpose: 'normal' | 'devolucao';
  references: string;
  customerId: string | null;
  taxId: string;
  name: string;
  ieIndicator: string;
  ie: string;
  email: string;
  cep: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  uf: string;
  ibgeCode: string;
  city: string;
  lines: Line[];
  freight: string;
  freightCents: number;
  installments: { dueDate: string; amountCents: number }[];
  paymentCode: string;
  additionalInfo: string;
}

const EMPTY: Draft = {
  companyId: '',
  storeId: '',
  nature: 'Venda de mercadoria',
  presence: 'presencial',
  purpose: 'normal',
  references: '',
  customerId: null,
  taxId: '',
  name: '',
  ieIndicator: '1',
  ie: '',
  email: '',
  cep: '',
  street: '',
  number: '',
  complement: '',
  district: '',
  uf: '',
  ibgeCode: '',
  city: '',
  lines: [],
  freight: 'semFrete',
  freightCents: 0,
  installments: [],
  paymentCode: '15',
  additionalInfo: '',
};

function fromView(n: NfeInvoiceView): Draft {
  const r = n.recipient;
  const installments = n.installments;
  return {
    companyId: n.companyId,
    storeId: n.storeId,
    nature: n.nature,
    presence: n.presence,
    purpose: n.purpose,
    references: n.references.join('\n'),
    customerId: r.customerId ?? null,
    taxId: r.taxId,
    name: r.name,
    ieIndicator: String(r.ieIndicator),
    ie: r.ie ?? '',
    email: r.email ?? '',
    cep: r.address.cep,
    street: r.address.street,
    number: r.address.number,
    complement: r.address.complement ?? '',
    district: r.address.district,
    uf: r.address.uf,
    ibgeCode: r.address.ibgeCode ?? '',
    city: r.address.city,
    lines: n.items.map((i) => ({
      productId: i.productId,
      name: i.productName,
      unit: i.unit,
      quantity: qtyText(i.quantityMilli),
      unitPriceCents: i.unitPriceCents,
      discountCents: i.discountCents,
      cfop: i.cfop ?? '',
      refKey: i.reference?.key ?? '',
      refItem: i.reference ? String(i.reference.item) : '',
    })),
    freight: n.transport.freight,
    freightCents: n.transport.freightCents,
    installments,
    paymentCode: n.payments[0]?.code ?? '15',
    additionalInfo: n.additionalInfo ?? '',
  };
}

/** O total que o pagamento precisa cobrir: produtos − descontos + frete. */
function draftTotal(d: Draft) {
  return (
    d.lines.reduce(
      (t, l) => t + lineGross(l.unitPriceCents, parseQuantity(l.quantity) ?? 0) - l.discountCents,
      0,
    ) + d.freightCents
  );
}

/** As chaves digitadas no campo "Chave da nota devolvida", só com os números. */
function referenceKeys(text: string) {
  return text
    .split(/\s+/)
    .map((k) => k.replace(/\D/g, ''))
    .filter(Boolean);
}

function toInput(d: Draft, fallbackStore: string, fallbackCompany: string): NfeInvoiceInput {
  const total = draftTotal(d);
  const keys = referenceKeys(d.references);
  const items = d.lines.map((l) => {
    const quantityMilli = parseQuantity(l.quantity);
    if (!quantityMilli) throw new Error(`Quantidade inválida em ${l.name}.`);
    // Devolução (NT 2025.002, regra VC02-14): cada item leva a nota e o número do item nela.
    const key = keys.includes(l.refKey) ? l.refKey : keys[0];
    const refItem = Number(l.refItem);
    return {
      productId: l.productId,
      quantityMilli,
      unitPriceCents: l.unitPriceCents,
      discountCents: l.discountCents,
      ...(l.cfop.trim() && { cfop: l.cfop.trim() }),
      ...(d.purpose === 'devolucao' &&
        key &&
        Number.isInteger(refItem) &&
        refItem > 0 && { reference: { key, item: refItem } }),
    };
  });
  return {
    companyId: d.companyId || fallbackCompany,
    storeId: d.storeId || fallbackStore,
    nature: d.nature,
    presence: d.presence as NfeInvoiceInput['presence'],
    purpose: d.purpose,
    references: d.purpose === 'devolucao' ? [] : keys,
    recipient: {
      customerId: d.customerId,
      taxId: d.taxId,
      name: d.name,
      ieIndicator: Number(d.ieIndicator) as 1 | 2 | 9,
      ie: d.ieIndicator === '1' ? d.ie : null,
      email: d.email,
      address: {
        cep: d.cep,
        street: d.street,
        number: d.number,
        complement: d.complement,
        district: d.district,
        city: d.city || 'Município',
        uf: d.uf as (typeof UFS)[number],
        ibgeCode: d.ibgeCode || null,
      },
    },
    items,
    transport: { freight: d.freight as 'semFrete', freightCents: d.freightCents },
    installments: d.installments,
    // A prazo, o pagamento é o boleto (ou a duplicata) das parcelas; sem pagamento, valor zero.
    payments: [{ code: d.paymentCode, amountCents: d.paymentCode === '90' ? 0 : total }],
    additionalInfo: d.additionalInfo,
  };
}

function NfeDrawer({
  id,
  onClose,
  onCreated,
}: {
  id: string | null;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { api } = useApp();
  const queryClient = useQueryClient();
  const canWrite = useCan('fiscal.profile.write');
  const view = useQuery({
    queryKey: ['nfe', id],
    queryFn: () => api.get<NfeInvoiceView>(`/fiscal/nfe/${id}`),
    enabled: Boolean(id),
    refetchInterval: (q) => {
      const doc = q.state.data?.document;
      const cancelling =
        (doc?.cancellation && ['pending', 'error'].includes(doc.cancellation.status)) ||
        q.state.data?.corrections.some((c) => ['pending', 'error'].includes(c.status));
      return doc && (['pending', 'error'].includes(doc.status) || cancelling) ? 1500 : false;
    },
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
      await queryClient.invalidateQueries({ queryKey: ['nfe'] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const n = view.data;
  const title = n?.document?.number
    ? `NF-e nº ${n.document.number} · ${n.recipient.name}`
    : n
      ? `Rascunho de NF-e · ${n.recipient.name}`
      : 'Nova NF-e';
  return (
    <Drawer open onOpenChange={(o) => !o && onClose()} title={title}>
      {id && !n ? (
        <p className="text-muted">Carregando a nota…</p>
      ) : n && n.status !== 'draft' ? (
        <IssuedView n={n} busy={busy} error={error} run={run} canWrite={canWrite} />
      ) : (
        <DraftForm
          key={n?.updatedAt ?? 'new'}
          n={n ?? null}
          busy={busy}
          error={error}
          run={run}
          canWrite={canWrite}
          onCreated={onCreated}
          onDiscarded={onClose}
        />
      )}
    </Drawer>
  );
}

function CheckResult({ n }: { n: NfeInvoiceView }) {
  if (!n.check.ok) {
    return (
      <Alert tone="warning" title="Falta resolver antes de emitir">
        <ul className="list-disc pl-5" aria-label="O que falta">
          {n.check.pending.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </Alert>
    );
  }
  return (
    <Alert tone="success" title="Pronta para emitir">
      O motor fiscal conferiu a nota: total de {money(n.check.totalCents ?? n.totalCents)}, com os
      impostos.
      {n.check.notes.length > 0 && (
        <ul className="mt-2 list-disc pl-5" aria-label="Avisos do cálculo">
          {n.check.notes.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </Alert>
  );
}

function IssuedView({
  n,
  busy,
  error,
  run,
  canWrite,
}: {
  n: NfeInvoiceView;
  busy: boolean;
  error: string | null;
  run: (fn: () => Promise<void>) => Promise<void>;
  canWrite: boolean;
}) {
  const { api } = useApp();
  const queryClient = useQueryClient();
  const d = n.document!;
  const [svcReason, setSvcReason] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [correction, setCorrection] = useState(n.corrections[0]?.text ?? '');
  const s = status(n);
  const c = d.cancellation;
  const final = ['authorized', 'denied', 'cancelled'].includes(d.status);
  return (
    <div className="flex flex-col gap-4">
      <p>
        <Badge tone={s.tone}>{s.label}</Badge>
        <span className="ml-2 text-sm text-muted">
          Série {d.series} · nº {d.number} · {money(n.totalCents)}
        </span>
      </p>
      {d.accessKey && (
        <p className="break-all font-mono text-sm" aria-label="Chave de acesso">
          {d.accessKey.replace(/(\d{4})/g, '$1 ').trim()}
        </p>
      )}
      {error && <Alert>{error}</Alert>}
      {d.status === 'authorized' && (
        <Alert tone="success" title="Autorizada pela SEFAZ (homologação)">
          Protocolo {d.protocol}. Sem valor fiscal: o Bipaê emite só em homologação por enquanto.
        </Alert>
      )}
      {d.status === 'not_configured' && (
        <Alert tone="warning" title="Falta configurar">
          <ul className="list-disc pl-5">
            {d.pendingItems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Alert>
      )}
      {(d.status === 'rejected' || d.status === 'denied') && (
        <Alert tone="danger" title={`SEFAZ: ${d.cStat} ${d.xMotivo ?? ''}`}>
          {d.help ? `${d.help.cause} ${d.help.fix}` : 'Confira os dados e tente de novo.'}
        </Alert>
      )}
      {d.status === 'error' && (
        <Alert tone="warning" title="A SEFAZ não respondeu">
          O Bipaê tenta de novo sozinho. {d.lastError}
        </Alert>
      )}
      {d.contingencyMode && (
        <Alert tone="warning" title={`Emitida em contingência (${d.contingencyMode})`}>
          A SEFAZ da UF não respondia e a nota foi para a SEFAZ Virtual de Contingência.
          {d.replacedAccessKey &&
            ` Ela substituiu a tentativa normal (chave ${d.replacedAccessKey}); quando a SEFAZ da UF voltar, o Bipaê confere se essa chave não foi autorizada também.`}
        </Alert>
      )}
      {d.lastError && d.status === 'authorized' && <Alert>{d.lastError}</Alert>}
      {canWrite && d.status === 'error' && !d.contingencyMode && (
        <fieldset className="flex flex-col gap-2 rounded-ui border border-border p-3">
          <legend className="px-1 font-semibold">Contingência (SVC)</legend>
          <p className="text-sm text-muted">
            Se a SEFAZ da UF continuar fora do ar, a nota pode ir para a SEFAZ Virtual de
            Contingência. Ela ganha uma chave nova; a chave de agora fica guardada para conferência.
          </p>
          <TextField
            label="Motivo da contingência"
            hint="Vai na nota (de 15 a 256 caracteres)."
            value={svcReason}
            onChange={(e) => setSvcReason(e.target.value)}
          />
          <Button
            variant="secondary"
            loading={busy}
            onClick={() =>
              void run(async () => {
                await api.post(`/fiscal/nfe/${n.id}/contingency`, { reason: svcReason });
                await queryClient.invalidateQueries({ queryKey: ['nfe', n.id] });
              })
            }
          >
            Emitir em contingência (SVC)
          </Button>
        </fieldset>
      )}
      {(d.status === 'pending' || d.status === 'error') && (
        <p className="text-sm text-muted">Enviando à SEFAZ…</p>
      )}
      <div className="flex flex-wrap gap-2">
        {d.status === 'authorized' && (
          <>
            <Button
              variant="secondary"
              onClick={() =>
                void run(() =>
                  saveFile(api, `/fiscal/nfe/${n.id}/danfe`, `DANFE-NFe${d.accessKey}.pdf`),
                )
              }
            >
              Baixar o DANFE (PDF)
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                void run(() => saveFile(api, `/fiscal/nfe/${n.id}/xml`, `NFe${d.accessKey}.xml`))
              }
            >
              Baixar o XML
            </Button>
          </>
        )}
      </div>
      {c && (c.status === 'pending' || c.status === 'error') && (
        <Alert tone="warning" title="Cancelamento enviado à SEFAZ">
          Aguardando a resposta. {c.lastError}
        </Alert>
      )}
      {c?.status === 'registered' && (
        <Alert tone="success" title="NF-e cancelada pela SEFAZ">
          Protocolo {c.protocol}. A mercadoria voltou ao estoque e as parcelas abertas foram
          canceladas.
        </Alert>
      )}
      {c?.status === 'rejected' && (
        <Alert
          tone="danger"
          title={`A SEFAZ recusou o cancelamento: ${c.cStat} ${c.xMotivo ?? ''}`}
        >
          {c.help ? `${c.help.cause} ${c.help.fix}` : 'A nota continua autorizada.'}
        </Alert>
      )}
      {n.corrections.length > 0 && (
        <section aria-labelledby="cartas" className="flex flex-col gap-2">
          <h3 id="cartas" className="font-semibold">
            Cartas de correção
          </h3>
          <ul className="flex flex-col gap-2">
            {n.corrections.map((k) => (
              <li key={k.sequence} className="rounded-ui border border-border p-2 text-sm">
                <p className="font-semibold">
                  Carta {k.sequence}:{' '}
                  {k.status === 'registered'
                    ? `registrada (protocolo ${k.protocol})`
                    : k.status === 'rejected'
                      ? `recusada (${k.cStat} ${k.xMotivo ?? ''})`
                      : 'enviando à SEFAZ…'}
                </p>
                <p className="whitespace-pre-line">{k.text}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
      {canWrite && d.status === 'authorized' && !c && (
        <fieldset className="flex flex-col gap-2 rounded-ui border border-border p-3">
          <legend className="px-1 font-semibold">Carta de correção</legend>
          <p className="text-sm text-muted">
            Corrige dados que não mudam o imposto, como endereço de entrega, transportadora ou
            observações. Não corrige valores, impostos, quantidade, remetente, destinatário nem
            datas. Cada carta substitui a anterior: escreva tudo o que está sendo corrigido.
          </p>
          <Field
            label="O que está sendo corrigido"
            hint="De 15 a 1.000 caracteres. Até 20 cartas por nota."
          >
            {(a11y) => (
              <textarea
                {...a11y}
                rows={3}
                maxLength={1000}
                className="w-full rounded-ui border border-border bg-surface p-3 text-base text-text"
                value={correction}
                onChange={(e) => setCorrection(e.target.value)}
              />
            )}
          </Field>
          <Button
            variant="secondary"
            loading={busy}
            onClick={() =>
              void run(async () => {
                await api.post(`/fiscal/nfe/${n.id}/correction`, { text: correction });
                await queryClient.invalidateQueries({ queryKey: ['nfe', n.id] });
              })
            }
          >
            Enviar carta de correção
          </Button>
        </fieldset>
      )}
      {canWrite && d.status === 'authorized' && !c && (
        <fieldset className="flex flex-col gap-2 rounded-ui border border-border p-3">
          <legend className="px-1 font-semibold">Cancelar a NF-e</legend>
          <p className="text-sm text-muted">
            Dá para cancelar em até 24 horas da autorização. Depois disso, emita uma NF-e de
            devolução. A mercadoria volta ao estoque quando a SEFAZ registrar o cancelamento.
          </p>
          <TextField
            label="Motivo do cancelamento"
            hint="Vai para a SEFAZ (de 15 a 255 caracteres)."
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
          />
          <Button
            variant="secondary"
            loading={busy}
            onClick={() =>
              void run(async () => {
                await api.post(`/fiscal/nfe/${n.id}/cancel`, { reason: cancelReason });
                await queryClient.invalidateQueries({ queryKey: ['nfe', n.id] });
              })
            }
          >
            Cancelar a NF-e
          </Button>
        </fieldset>
      )}
      {canWrite && !final && d.status !== 'pending' && (
        <Button
          loading={busy}
          onClick={() =>
            void run(async () => {
              await api.post(`/fiscal/nfe/${n.id}/retry`, {});
              await queryClient.invalidateQueries({ queryKey: ['nfe', n.id] });
            })
          }
        >
          Tentar de novo
        </Button>
      )}
    </div>
  );
}

function DraftForm({
  n,
  busy,
  error,
  run,
  canWrite,
  onCreated,
  onDiscarded,
}: {
  n: NfeInvoiceView | null;
  busy: boolean;
  error: string | null;
  run: (fn: () => Promise<void>) => Promise<void>;
  canWrite: boolean;
  onCreated: (id: string) => void;
  onDiscarded: () => void;
}) {
  const { api } = useApp();
  const queryClient = useQueryClient();
  const [d, setD] = useState<Draft>(n ? fromView(n) : EMPTY);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setD((x) => ({ ...x, [key]: value }));
  const companies = useQuery({
    queryKey: ['companies'],
    queryFn: () => api.get<{ id: string; legalName: string }[]>('/companies'),
  });
  const stores = useQuery({
    queryKey: ['stores'],
    queryFn: () => api.get<{ id: string; name: string }[]>('/stores'),
  });
  const means = useQuery({
    queryKey: ['nfe', 'payment-means'],
    queryFn: () => api.get<{ code: string; description: string }[]>('/fiscal/nfe/payment-means'),
  });
  const company = d.companyId || companies.data?.[0]?.id || '';
  const store = d.storeId || stores.data?.[0]?.id || '';

  // Cliente do cadastro: copia os dados para a nota (e dá para conferir e mudar aqui).
  const [customerSearch, setCustomerSearch] = useState('');
  const cq = useDeferredValue(customerSearch.trim());
  const customers = useQuery({
    queryKey: ['customer', 'nfe-search', cq],
    queryFn: () => api.get<Page<Party>>(`/customers?q=${encodeURIComponent(cq)}&limit=8`),
    enabled: cq.length >= 2,
  });
  const pickCustomer = (p: Party) => {
    const a = p.address;
    setD((x) => ({
      ...x,
      customerId: p.id,
      taxId: p.taxId ?? '',
      name: p.name,
      ieIndicator: (p.taxId ?? '').length === 11 ? '9' : x.ieIndicator,
      email: p.email ?? '',
      ...(a && {
        cep: a.cep,
        street: a.street,
        number: a.number,
        complement: a.complement ?? '',
        district: a.district,
        uf: a.uf,
        city: a.city,
        ibgeCode: a.ibgeCode ?? '',
      }),
    }));
    setCustomerSearch('');
  };

  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const found = useQuery({
    queryKey: ['products', 'nfe-search', q],
    queryFn: () => api.get<Page<Product>>(`/products?q=${encodeURIComponent(q)}&limit=8`),
    enabled: q.length >= 2,
  });
  const returnKeys = referenceKeys(d.references);
  const setLine = (index: number, patch: Partial<Line>) =>
    setD((x) => ({ ...x, lines: x.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)) }));

  const total = draftTotal(d);
  const save = (then?: (saved: NfeInvoiceView) => Promise<void>) =>
    run(async () => {
      const input = toInput(d, store, company);
      const saved = n
        ? await api.put<NfeInvoiceView>(`/fiscal/nfe/${n.id}`, input)
        : await api.post<NfeInvoiceView>('/fiscal/nfe', input);
      queryClient.setQueryData(['nfe', saved.id], saved);
      if (then) await then(saved);
      if (!n) onCreated(saved.id);
    });

  return (
    <div className="flex flex-col gap-4">
      {error && <Alert>{error}</Alert>}
      {n && <CheckResult n={n} />}

      {(companies.data?.length ?? 0) > 1 && (
        <SelectField
          label="Empresa emitente"
          value={company}
          onChange={(e) => set('companyId', e.target.value)}
          options={(companies.data ?? []).map((c) => ({ value: c.id, label: c.legalName }))}
        />
      )}
      {(stores.data?.length ?? 0) > 1 && (
        <SelectField
          label="Loja"
          value={store}
          onChange={(e) => set('storeId', e.target.value)}
          options={(stores.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
        />
      )}
      <TextField
        label="Natureza da operação"
        value={d.nature}
        onChange={(e) => set('nature', e.target.value)}
      />
      <SelectField
        label="Finalidade"
        value={d.purpose}
        onChange={(e) => set('purpose', e.target.value as Draft['purpose'])}
        options={[
          { value: 'normal', label: 'Venda (nota normal)' },
          { value: 'devolucao', label: 'Devolução de compra (ao fornecedor)' },
        ]}
      />
      {d.purpose === 'devolucao' && (
        <TextField
          label="Chave da nota devolvida"
          hint="44 números; mais de uma (do mesmo fornecedor), separe com espaço. Em cada produto, diga o item na nota."
          value={d.references}
          onChange={(e) => set('references', e.target.value)}
        />
      )}
      <SelectField
        label="Como foi a venda"
        value={d.presence}
        onChange={(e) => set('presence', e.target.value)}
        options={PRESENCE}
      />

      <fieldset className="flex flex-col gap-3 rounded-ui border border-border p-3">
        <legend className="px-1 font-semibold">Destinatário</legend>
        <TextField
          label="Buscar no cadastro de clientes"
          placeholder="Nome ou CPF/CNPJ"
          value={customerSearch}
          onChange={(e) => setCustomerSearch(e.target.value)}
        />
        {cq.length >= 2 && customers.data && (
          <ul className="rounded-ui border border-border" aria-label="Clientes encontrados">
            {customers.data.items.length === 0 && (
              <li className="p-3 text-muted">Nenhum cliente. Preencha os dados abaixo.</li>
            )}
            {customers.data.items.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="w-full p-3 text-left hover:bg-surface-2"
                  onClick={() => pickCustomer(p)}
                >
                  {p.name}
                  {p.taxId && ` · ${formatTaxId(p.taxId)}`}
                </button>
              </li>
            ))}
          </ul>
        )}
        <TaxIdField
          label="CPF ou CNPJ do destinatário"
          value={d.taxId}
          onChange={(v) => set('taxId', v)}
        />
        <TextField
          label="Nome ou razão social"
          value={d.name}
          onChange={(e) => set('name', e.target.value)}
        />
        <SelectField
          label="Inscrição estadual"
          value={d.ieIndicator}
          onChange={(e) => set('ieIndicator', e.target.value)}
          options={IE_INDICATOR}
        />
        {d.ieIndicator === '1' && (
          <TextField
            label="Número da inscrição estadual"
            value={d.ie}
            onChange={(e) => set('ie', e.target.value)}
          />
        )}
        <TextField
          label="E-mail para o XML"
          type="email"
          value={d.email}
          onChange={(e) => set('email', e.target.value)}
        />
        <TextField
          label="CEP"
          inputMode="numeric"
          value={d.cep}
          onChange={(e) => set('cep', e.target.value)}
        />
        <TextField label="Rua" value={d.street} onChange={(e) => set('street', e.target.value)} />
        <TextField
          label="Número"
          value={d.number}
          onChange={(e) => set('number', e.target.value)}
        />
        <TextField
          label="Complemento"
          value={d.complement}
          onChange={(e) => set('complement', e.target.value)}
        />
        <TextField
          label="Bairro"
          value={d.district}
          onChange={(e) => set('district', e.target.value)}
        />
        <SelectField
          label="UF do destinatário"
          value={d.uf}
          onChange={(e) => setD((x) => ({ ...x, uf: e.target.value, ibgeCode: '', city: '' }))}
          options={[{ value: '', label: 'Escolha' }, ...UFS.map((u) => ({ value: u, label: u }))]}
        />
        <CityPicker
          uf={d.uf}
          value={d.ibgeCode}
          onChange={(code) => setD((x) => ({ ...x, ibgeCode: code }))}
        />
      </fieldset>

      <fieldset className="flex flex-col gap-3 rounded-ui border border-border p-3">
        <legend className="px-1 font-semibold">Itens</legend>
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
                  className="w-full p-3 text-left hover:bg-surface-2"
                  onClick={() => {
                    if (!d.lines.some((l) => l.productId === p.id)) {
                      set('lines', [
                        ...d.lines,
                        {
                          productId: p.id,
                          name: p.name,
                          unit: p.unit,
                          quantity: '1',
                          unitPriceCents: p.priceCents,
                          discountCents: 0,
                          cfop: '',
                          refKey: '',
                          refItem: '',
                        },
                      ]);
                    }
                    setSearch('');
                  }}
                >
                  {p.name} · {money(p.priceCents)}
                </button>
              </li>
            ))}
          </ul>
        )}
        {d.lines.length > 0 && (
          <ul className="flex flex-col gap-2" aria-label="Itens da nota">
            {d.lines.map((line, index) => (
              <li
                key={line.productId}
                className="flex flex-col gap-2 rounded-ui border border-border p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{line.name}</span>
                  <Button
                    variant="ghost"
                    aria-label={`Tirar ${line.name} da nota`}
                    icon={<X className="size-4" aria-hidden />}
                    onClick={() =>
                      set(
                        'lines',
                        d.lines.filter((_, i) => i !== index),
                      )
                    }
                  />
                </div>
                <TextField
                  label={`Quantidade de ${line.name} (${line.unit})`}
                  inputMode="decimal"
                  value={line.quantity}
                  onChange={(e) => setLine(index, { quantity: e.target.value })}
                />
                <MoneyField
                  label={`Preço de ${line.name}`}
                  value={line.unitPriceCents}
                  onChange={(c) => setLine(index, { unitPriceCents: c ?? 0 })}
                />
                <MoneyField
                  label={`Desconto em ${line.name}`}
                  value={line.discountCents}
                  onChange={(c) => setLine(index, { discountCents: c ?? 0 })}
                />
                <TextField
                  label={`CFOP de ${line.name} (opcional)`}
                  hint="Em branco, vale o do perfil fiscal do produto."
                  inputMode="numeric"
                  value={line.cfop}
                  onChange={(e) =>
                    setLine(index, { cfop: e.target.value.replace(/\D/g, '').slice(0, 4) })
                  }
                />
                {d.purpose === 'devolucao' && returnKeys.length > 1 && (
                  <SelectField
                    label={`Nota devolvida de ${line.name}`}
                    value={returnKeys.includes(line.refKey) ? line.refKey : returnKeys[0]!}
                    onChange={(e) => setLine(index, { refKey: e.target.value })}
                    options={returnKeys.map((k) => ({ value: k, label: `…${k.slice(-12)}` }))}
                  />
                )}
                {d.purpose === 'devolucao' && (
                  <TextField
                    label={`Item de ${line.name} na nota devolvida`}
                    hint="O número da linha do produto na nota do fornecedor (1, 2, 3…)."
                    inputMode="numeric"
                    value={line.refItem}
                    onChange={(e) =>
                      setLine(index, { refItem: e.target.value.replace(/\D/g, '').slice(0, 3) })
                    }
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-3 rounded-ui border border-border p-3">
        <legend className="px-1 font-semibold">Transporte e pagamento</legend>
        <SelectField
          label="Frete"
          value={d.freight}
          onChange={(e) => set('freight', e.target.value)}
          options={FREIGHT}
        />
        {d.freight !== 'semFrete' && (
          <MoneyField
            label="Valor do frete na nota"
            value={d.freightCents}
            onChange={(c) => set('freightCents', c ?? 0)}
          />
        )}
        <SelectField
          label="Forma de pagamento"
          value={d.paymentCode}
          onChange={(e) => set('paymentCode', e.target.value)}
          options={(means.data ?? [{ code: d.paymentCode, description: d.paymentCode }]).map(
            (m) => ({
              value: m.code,
              label: `${m.code} · ${m.description}`,
            }),
          )}
        />
        <p className="text-sm">
          Total a receber: <span className="font-semibold">{money(total)}</span> (sem a ST e o IPI,
          que o motor soma ao conferir)
        </p>
        <div className="flex flex-col gap-2">
          <p className="font-semibold">Parcelas (venda a prazo)</p>
          {d.installments.map((p, index) => (
            <div key={index} className="flex items-end gap-2">
              <TextField
                label={`Vencimento da parcela ${index + 1}`}
                type="date"
                value={p.dueDate}
                onChange={(e) =>
                  set(
                    'installments',
                    d.installments.map((x, i) =>
                      i === index ? { ...x, dueDate: e.target.value } : x,
                    ),
                  )
                }
              />
              <MoneyField
                label={`Valor da parcela ${index + 1}`}
                value={p.amountCents}
                onChange={(c) =>
                  set(
                    'installments',
                    d.installments.map((x, i) => (i === index ? { ...x, amountCents: c ?? 0 } : x)),
                  )
                }
              />
              <Button
                variant="ghost"
                aria-label={`Tirar a parcela ${index + 1}`}
                icon={<X className="size-4" aria-hidden />}
                onClick={() =>
                  set(
                    'installments',
                    d.installments.filter((_, i) => i !== index),
                  )
                }
              />
            </div>
          ))}
          <Button
            variant="secondary"
            onClick={() =>
              set('installments', [...d.installments, { dueDate: '', amountCents: 0 }])
            }
          >
            Adicionar parcela
          </Button>
        </div>
        <TextField
          label="Informações complementares"
          value={d.additionalInfo}
          onChange={(e) => set('additionalInfo', e.target.value)}
        />
      </fieldset>

      {canWrite && (
        <div className="flex flex-col gap-2">
          <Button
            variant="secondary"
            loading={busy}
            disabled={d.lines.length === 0}
            onClick={() => void save()}
          >
            {n ? 'Salvar e conferir' : 'Salvar rascunho e conferir'}
          </Button>
          {n && (
            <>
              <Button
                variant="secondary"
                loading={busy}
                disabled={!n.check.ok}
                onClick={() =>
                  void run(() => saveFile(api, `/fiscal/nfe/${n.id}/danfe`, 'Previa-DANFE.pdf'))
                }
              >
                Baixar a prévia do DANFE (sem valor fiscal)
              </Button>
              <Button
                loading={busy}
                disabled={!n.check.ok}
                onClick={() =>
                  void save(async (saved) => {
                    if (!saved.check.ok)
                      throw new Error('Ainda falta resolver o que está na lista.');
                    await api.post(`/fiscal/nfe/${saved.id}/issue`, {});
                    await queryClient.invalidateQueries({ queryKey: ['nfe', saved.id] });
                  })
                }
              >
                Emitir NF-e
              </Button>
              <Button
                variant="ghost"
                loading={busy}
                onClick={() =>
                  void run(async () => {
                    await api.delete(`/fiscal/nfe/${n.id}`);
                    onDiscarded();
                  })
                }
              >
                Descartar rascunho
              </Button>
            </>
          )}
        </div>
      )}
      <p className="text-sm text-muted">
        Ao emitir, a mercadoria sai do estoque da loja e cada parcela vira uma conta a receber em
        Contas a pagar e receber.
      </p>
    </div>
  );
}
