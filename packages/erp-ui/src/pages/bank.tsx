import { cents, formatBRL, type BankImportResult, type BankTransactionView } from '@bipae/domain';
import { Alert, Button, DataTable, EmptyState, PageHeader } from '@bipae/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ChangeEvent } from 'react';
import { useApp, useCan } from '../context';

const brl = (value: number) => formatBRL(cents(value));
const day = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

/** Lê o .ofx: os extratos 1.x costumam vir em Windows-1252 (CHARSET:1252). */
async function readOfx(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  const head = new TextDecoder('latin1').decode(bytes.slice(0, 400));
  return new TextDecoder(/CHARSET:\s*1252/i.test(head) ? 'windows-1252' : 'utf-8').decode(bytes);
}

/** Conciliação bancária por OFX (F4-07). */
export function BankPage() {
  const { api } = useApp();
  const queryClient = useQueryClient();
  const canWrite = useCan('finance.write');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const list = useQuery({
    queryKey: ['finance', 'bank', 'pending'],
    queryFn: () => api.get<BankTransactionView[]>('/finance/bank/transactions?status=pending'),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['finance'] });
  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true);
    setMessage(null);
    try {
      const text = await fn();
      if (text) setMessage({ ok: true, text });
      await refresh();
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const upload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    void run(async () => {
      const r = await api.post<BankImportResult>('/finance/bank/import', {
        content: await readOfx(file),
      });
      return `${r.account}: ${r.imported} lançamento(s) novo(s)${r.repeated ? `, ${r.repeated} já importado(s)` : ''}.`;
    });
  };
  return (
    <>
      <PageHeader
        title="Conciliação bancária"
        description="Importe o extrato do banco (.ofx) e ligue cada lançamento à conta a pagar ou a receber."
      />
      {canWrite && (
        <label className="mb-4 inline-flex cursor-pointer items-center gap-2 rounded-ui bg-primary px-4 py-2 font-semibold text-primary-contrast">
          Importar extrato (.ofx)
          <input
            type="file"
            accept=".ofx,.OFX"
            className="sr-only"
            onChange={upload}
            disabled={busy}
          />
        </label>
      )}
      {message && <Alert tone={message.ok ? 'success' : 'danger'}>{message.text}</Alert>}
      {list.data && list.data.length === 0 ? (
        <EmptyState title="Nada para conciliar">
          Baixe o extrato no site do banco, no formato OFX (Money), e importe aqui.
        </EmptyState>
      ) : (
        list.data && (
          <DataTable
            caption="Lançamentos do banco a conciliar"
            rows={list.data}
            columns={[
              { header: 'Data', cell: (t) => day(t.postedOn) },
              {
                header: 'Histórico',
                cell: (t) => (
                  <span>
                    {t.memo || '—'}
                    <span className="block text-sm text-muted">{t.bankAccountName}</span>
                  </span>
                ),
              },
              {
                header: 'Valor',
                align: 'right',
                cell: (t) => (
                  <span className={t.amountCents < 0 ? 'text-danger' : 'text-success'}>
                    {t.amountCents < 0 ? '−' : '+'}
                    {brl(Math.abs(t.amountCents))}
                  </span>
                ),
              },
              {
                header: 'Conciliar',
                cell: (t) =>
                  canWrite && (
                    <div className="flex flex-wrap gap-2">
                      {t.suggestions.map((s) => (
                        <Button
                          key={s.id}
                          variant="secondary"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await api.post(`/finance/bank/transactions/${t.id}/match`, {
                                entryId: s.id,
                              });
                              return `Conciliado com ${s.description}.`;
                            })
                          }
                        >
                          {s.description} ({day(s.dueDate)})
                        </Button>
                      ))}
                      {t.suggestions.length === 0 && (
                        <span className="text-sm text-muted">
                          Nenhuma conta em aberto com esse valor.
                        </span>
                      )}
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            api
                              .post(`/finance/bank/transactions/${t.id}/ignore`)
                              .then(() => undefined),
                          )
                        }
                      >
                        Ignorar
                      </Button>
                    </div>
                  ),
              },
            ]}
          />
        )
      )}
    </>
  );
}
