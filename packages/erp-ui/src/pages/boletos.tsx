import {
  BOLETO_STATUS_LABELS,
  cents,
  formatBRL,
  formatTaxId,
  isValidCnpj,
  isValidCpf,
  normalizeTaxId,
  parseBRL,
  type BoletoStatus,
  type BoletoView,
} from '@bipae/domain';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Drawer,
  EmptyState,
  PageHeader,
  TextField,
} from '@bipae/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useApp, useCan } from '../context';

const brl = (value: number) => formatBRL(cents(value));
const day = (iso: string) => iso.split('-').reverse().join('/');

const TONE: Record<BoletoStatus, 'neutral' | 'warning' | 'success' | 'danger'> = {
  pending: 'neutral',
  registered: 'warning',
  paid: 'success',
  overdue: 'danger',
  canceled: 'neutral',
  failed: 'danger',
};

interface Reconcile {
  checked: number;
  paid: number;
  divergences: { id: string; reason: string }[];
}

/**
 * Boletos (F4-15): emite o boleto pelo parceiro de cobrança (Asaas, a conta de Meios de
 * pagamento), acompanha o pagamento e baixa a conta a receber sozinho. Sem a conta ligada, a tela
 * diz "Falta configurar".
 */
export function BoletosPage() {
  const { api } = useApp();
  const canWrite = useCan('finance.write');
  const queryClient = useQueryClient();
  const capability = useQuery({
    queryKey: ['boletos', 'capability'],
    queryFn: () =>
      api.get<{ available: boolean; provider: string | null; missing: string | null }>(
        '/boletos/capability',
      ),
  });
  const boletos = useQuery({
    queryKey: ['boletos'],
    queryFn: () => api.get<BoletoView[]>('/boletos'),
    refetchInterval: 15_000,
  });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [recon, setRecon] = useState<Reconcile | null>(null);

  const act = async (fn: () => Promise<unknown>, message?: string) => {
    setError(null);
    setNotice(null);
    try {
      await fn();
      await queryClient.invalidateQueries({ queryKey: ['boletos'] });
      if (message) setNotice(message);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const rows = boletos.data ?? [];
  const cap = capability.data;
  return (
    <>
      <PageHeader
        title="Boletos"
        description="Emita boletos pelo seu parceiro de cobrança. Quando o pagamento cai, a conta a receber é baixada e fica tudo conferido."
        actions={
          canWrite && (
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() =>
                  void act(async () => {
                    setRecon(await api.post<Reconcile>('/boletos/reconcile', {}));
                  })
                }
              >
                Conferir pagamentos
              </Button>
              <Button disabled={!cap?.available} onClick={() => setCreating(true)}>
                Novo boleto
              </Button>
            </div>
          )
        }
      />
      {cap && !cap.available && (
        <Alert tone="warning" title="Falta configurar">
          {cap.missing}
        </Alert>
      )}
      {cap?.provider === 'simulator' && (
        <Alert tone="warning" title="Boletos de teste">
          Nenhum parceiro está ligado: os boletos abaixo são do simulador e não valem no banco.
        </Alert>
      )}
      {error && <Alert>{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      {recon && (
        <Alert
          tone={recon.divergences.length > 0 ? 'warning' : 'success'}
          title={`${recon.checked} boleto(s) conferido(s), ${recon.paid} pago(s) agora`}
        >
          {recon.divergences.length === 0
            ? 'Nenhuma divergência entre boletos e contas a receber.'
            : recon.divergences.map((d) => <p key={d.id + d.reason}>{d.reason}</p>)}
        </Alert>
      )}
      {boletos.data && rows.length === 0 ? (
        <EmptyState title="Nenhum boleto ainda">
          Emita um boleto avulso ou para uma conta a receber.
        </EmptyState>
      ) : (
        rows.length > 0 && (
          <DataTable
            caption="Boletos"
            rows={rows}
            columns={[
              {
                header: 'Pagador',
                cell: (b) => (
                  <div>
                    {b.payerName}
                    <div className="text-sm text-muted">{formatTaxId(b.payerTaxId)}</div>
                  </div>
                ),
              },
              { header: 'Descrição', cell: (b) => b.description },
              { header: 'Vencimento', cell: (b) => day(b.dueDate) },
              { header: 'Valor', cell: (b) => brl(b.amountCents) },
              {
                header: 'Situação',
                cell: (b) => (
                  <div className="flex flex-col gap-1">
                    <Badge tone={TONE[b.status]}>{BOLETO_STATUS_LABELS[b.status]}</Badge>
                    {b.failure && <span className="text-sm">{b.failure}</span>}
                    {b.paidCents !== null && b.paidCents !== b.amountCents && (
                      <span className="text-sm">{`Pago ${brl(b.paidCents)}`}</span>
                    )}
                  </div>
                ),
              },
              {
                header: 'Linha digitável',
                cell: (b) =>
                  b.digitableLine ? (
                    <code className="break-all text-sm">{b.digitableLine}</code>
                  ) : (
                    '—'
                  ),
              },
              {
                header: 'Ações',
                cell: (b) => (
                  <div className="flex flex-wrap gap-1">
                    {b.pdfUrl && (
                      <a
                        className="underline"
                        href={b.pdfUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Abrir boleto
                      </a>
                    )}
                    {canWrite && ['registered', 'overdue'].includes(b.status) && (
                      <Button
                        variant="ghost"
                        onClick={() =>
                          void act(() => api.post(`/boletos/${b.id}/refresh`, {}), 'Consultado.')
                        }
                      >
                        Consultar pagamento
                      </Button>
                    )}
                    {canWrite && b.status === 'failed' && (
                      <Button
                        variant="ghost"
                        onClick={() => void act(() => api.post(`/boletos/${b.id}/retry`, {}))}
                      >
                        Registrar de novo
                      </Button>
                    )}
                    {canWrite && ['registered', 'overdue', 'failed'].includes(b.status) && (
                      <Button
                        variant="ghost"
                        onClick={() => void act(() => api.post(`/boletos/${b.id}/cancel`, {}))}
                      >
                        Cancelar
                      </Button>
                    )}
                    {canWrite && cap?.provider === 'simulator' && b.status === 'registered' && (
                      <Button
                        variant="ghost"
                        onClick={() =>
                          void act(() => api.post(`/boletos/${b.id}/simulate-payment`, {}))
                        }
                      >
                        Simular pagamento
                      </Button>
                    )}
                  </div>
                ),
              },
            ]}
          />
        )
      )}
      <p className="mt-4 text-sm text-muted">
        Chega em breve: arquivo de retorno do banco (CNAB), multa e juros por atraso.
      </p>
      {creating && (
        <BoletoDrawer
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            void queryClient.invalidateQueries({ queryKey: ['boletos'] });
          }}
        />
      )}
    </>
  );
}

function BoletoDrawer({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { api } = useApp();
  const [name, setName] = useState('');
  const [taxId, setTaxId] = useState('');
  const [amount, setAmount] = useState('');
  const [due, setDue] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setError(null);
    const digits = normalizeTaxId(taxId);
    const value = parseBRL(amount);
    if (!isValidCpf(digits) && !isValidCnpj(digits)) return setError('CPF ou CNPJ inválido.');
    if (value === null || value < 500) return setError('O boleto precisa de pelo menos R$ 5,00.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return setError('Informe o vencimento.');
    setBusy(true);
    try {
      await api.post('/boletos', {
        payerName: name.trim(),
        payerTaxId: digits,
        amountCents: value,
        dueDate: due,
        description: description.trim(),
      });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer open onOpenChange={(o) => !o && onClose()} title="Novo boleto">
      <div className="flex flex-col gap-4">
        {error && <Alert>{error}</Alert>}
        <TextField label="Nome do pagador" value={name} onChange={(e) => setName(e.target.value)} />
        <TextField
          label="CPF ou CNPJ do pagador"
          inputMode="numeric"
          value={taxId}
          onChange={(e) => setTaxId(e.target.value)}
        />
        <TextField
          label="Valor (R$)"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <TextField
          label="Vencimento"
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
        />
        <TextField
          label="Descrição da cobrança"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <Button loading={busy} onClick={() => void save()}>
          Emitir boleto
        </Button>
      </div>
    </Drawer>
  );
}
