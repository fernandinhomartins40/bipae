import {
  formatBRL,
  formatTaxId,
  type Cents,
  type DfeDocumentView,
  type DfeSyncResult,
} from '@bipae/domain';
import { Alert, Badge, Button, DataTable, Drawer, SelectField, TextField } from '@bipae/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useApp, useCan } from '../context';

const money = (cents: number) => formatBRL(cents as Cents);
const date = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');

const MANIFESTATION: Record<NonNullable<DfeDocumentView['manifestation']>, string> = {
  ciencia: 'Ciência da operação',
  confirmacao: 'Operação confirmada',
  desconhecimento: 'Operação desconhecida',
  naoRealizada: 'Operação não realizada',
};

function status(n: DfeDocumentView): {
  label: string;
  tone: 'warning' | 'success' | 'neutral' | 'danger';
} {
  if (n.situation === 'cancelada') return { label: 'Cancelada pelo emitente', tone: 'neutral' };
  if (n.purchaseId) return { label: 'Entrada feita', tone: 'success' };
  if (n.manifestationStatus === 'error')
    return { label: 'Manifestação não enviada', tone: 'danger' };
  if (n.manifestationStatus === 'rejected')
    return { label: 'Manifestação recusada', tone: 'danger' };
  if (n.manifestation && n.manifestation !== 'ciencia')
    return { label: MANIFESTATION[n.manifestation], tone: 'neutral' };
  if (n.hasXml) return { label: 'Pronta para dar entrada', tone: 'warning' };
  return { label: 'Falta a ciência', tone: 'warning' };
}

/**
 * Notas emitidas contra o CNPJ da empresa, vindas do Ambiente Nacional (F3-20): a loja vê a
 * compra antes de o fornecedor mandar o XML, registra a ciência (que libera a nota completa) e dá
 * entrada pelo mesmo caminho do "Importar XML".
 */
export function ReceivedNotes({ onImport }: { onImport: (xml: string) => Promise<void> }) {
  const { api } = useApp();
  const canWrite = useCan('catalog.write');
  const queryClient = useQueryClient();
  const companies = useQuery({
    queryKey: ['companies'],
    queryFn: () => api.get<{ id: string; legalName: string }[]>('/companies'),
  });
  const notes = useQuery({
    queryKey: ['dfe'],
    queryFn: () => api.get<DfeDocumentView[]>('/fiscal/dfe'),
  });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<DfeDocumentView | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
      await queryClient.invalidateQueries({ queryKey: ['dfe'] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const sync = () =>
    run(async () => {
      const results = [];
      for (const c of companies.data ?? []) {
        results.push(await api.post<DfeSyncResult>(`/fiscal/dfe/sync/${c.id}`, {}));
      }
      setMessage(results.map((r) => r.message).join(' ') || 'Nenhuma empresa cadastrada.');
    });
  const rows = notes.data ?? [];
  const current = open ? (rows.find((r) => r.id === open.id) ?? open) : null;

  return (
    <section aria-labelledby="notas-recebidas" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="notas-recebidas" className="text-lg font-bold">
          Notas emitidas para a sua empresa
        </h2>
        {canWrite && (
          <Button
            variant="secondary"
            loading={busy}
            icon={<RefreshCw className="size-4" aria-hidden />}
            onClick={() => void sync()}
          >
            Buscar notas agora
          </Button>
        )}
      </div>
      <p className="text-sm text-muted">
        O Bipaê pergunta de hora em hora ao Ambiente Nacional da NF-e (em homologação) pelas notas
        emitidas contra o seu CNPJ. Precisa do certificado digital A1 da empresa.
      </p>
      {message && <Alert tone="success">{message}</Alert>}
      {error && <Alert>{error}</Alert>}
      {notes.data && rows.length === 0 && (
        <p className="rounded-2xl border border-dashed border-border bg-surface p-4 text-sm text-muted">
          Nenhuma nota emitida para a sua empresa apareceu ainda.
        </p>
      )}
      {rows.length > 0 && (
        <DataTable
          caption="Notas emitidas para a sua empresa"
          rows={rows}
          onRowClick={(r) => setOpen(r)}
          card={(r) => (
            <>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="font-bold">{r.issuerName}</span>
                <span className="text-sm text-muted">
                  {formatTaxId(r.issuerTaxId)} · {date(r.issuedAt)}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                <span className="text-lg font-extrabold tabular-nums">{money(r.totalCents)}</span>
                <Badge tone={status(r).tone}>{status(r).label}</Badge>
              </span>
            </>
          )}
          columns={[
            { header: 'Emissão', cell: (r) => date(r.issuedAt) },
            {
              header: 'Fornecedor',
              cell: (r) => `${r.issuerName} · ${formatTaxId(r.issuerTaxId)}`,
            },
            {
              header: 'Total',
              align: 'right',
              cell: (r) => <span className="font-extrabold">{money(r.totalCents)}</span>,
            },
            {
              header: 'Situação',
              cell: (r) => <Badge tone={status(r).tone}>{status(r).label}</Badge>,
            },
          ]}
        />
      )}
      {current && (
        <NoteDrawer
          note={current}
          busy={busy}
          error={error}
          canWrite={canWrite}
          onClose={() => setOpen(null)}
          onManifest={(type, reason) =>
            run(async () => {
              await api.post(`/fiscal/dfe/${current.id}/manifest`, {
                type,
                ...(reason && { reason }),
              });
            })
          }
          onImport={() =>
            run(async () => {
              const xml = await (await api.download(`/fiscal/dfe/${current.id}/xml`)).text();
              setOpen(null);
              await onImport(xml);
            })
          }
        />
      )}
    </section>
  );
}

function NoteDrawer({
  note,
  busy,
  error,
  canWrite,
  onClose,
  onManifest,
  onImport,
}: {
  note: DfeDocumentView;
  busy: boolean;
  error: string | null;
  canWrite: boolean;
  onClose: () => void;
  onManifest: (
    type: NonNullable<DfeDocumentView['manifestation']>,
    reason?: string,
  ) => Promise<void>;
  onImport: () => Promise<void>;
}) {
  const [choice, setChoice] =
    useState<NonNullable<DfeDocumentView['manifestation']>>('confirmacao');
  const [reason, setReason] = useState('');
  const final = Boolean(
    note.manifestationStatus === 'registered' &&
    note.manifestation &&
    note.manifestation !== 'ciencia',
  );
  return (
    <Drawer open onOpenChange={(o) => !o && onClose()} title={`Nota de ${note.issuerName}`}>
      <div className="flex flex-col gap-4">
        <p>
          <Badge tone={status(note).tone}>{status(note).label}</Badge>
          <span className="ml-2 text-sm text-muted">
            {date(note.issuedAt)} · {money(note.totalCents)}
          </span>
        </p>
        <p className="break-all font-mono text-sm" aria-label="Chave de acesso">
          {note.accessKey.replace(/(\d{4})/g, '$1 ').trim()}
        </p>
        {error && <Alert>{error}</Alert>}
        {note.manifestationMessage && (
          <p className="text-sm text-muted">Resposta da SEFAZ: {note.manifestationMessage}</p>
        )}
        {canWrite && !note.hasXml && note.situation !== 'cancelada' && (
          <>
            <p className="text-sm">
              Para ver a nota completa e dar entrada, registre a ciência da operação. Ela só diz que
              a empresa sabe da nota; a confirmação vem depois.
            </p>
            <Button loading={busy} onClick={() => void onManifest('ciencia')}>
              Registrar a ciência
            </Button>
          </>
        )}
        {canWrite && note.hasXml && !note.purchaseId && (
          <Button loading={busy} onClick={() => void onImport()}>
            Dar entrada na compra
          </Button>
        )}
        {canWrite && !final && note.situation !== 'cancelada' && (
          <fieldset className="flex flex-col gap-2 rounded-ui border border-border p-3">
            <legend className="px-1 font-semibold">Manifestação final</legend>
            <SelectField
              label="O que aconteceu com esta compra"
              value={choice}
              onChange={(e) => setChoice(e.target.value as typeof choice)}
              options={[
                { value: 'confirmacao', label: 'Recebi a mercadoria (confirmar a operação)' },
                { value: 'naoRealizada', label: 'A compra não aconteceu (operação não realizada)' },
                { value: 'desconhecimento', label: 'Não conheço esta nota (desconhecer)' },
              ]}
            />
            {choice === 'naoRealizada' && (
              <TextField
                label="Por que a operação não foi realizada"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            )}
            <Button
              variant="secondary"
              loading={busy}
              onClick={() =>
                void onManifest(choice, choice === 'naoRealizada' ? reason : undefined)
              }
            >
              Enviar a manifestação
            </Button>
          </fieldset>
        )}
      </div>
    </Drawer>
  );
}
