import {
  formatBRL,
  formatTaxId,
  type Cents,
  type DfeSyncResult,
  type NfseReceivedView,
} from '@bipae/domain';
import { Alert, Badge, Button, DataTable } from '@bipae/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useApp, useCan } from '../context';

const money = (cents: number) => formatBRL(cents as Cents);
const date = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');

const ROLE: Record<NfseReceivedView['role'], string> = {
  prestador: 'Sua empresa prestou',
  tomador: 'Sua empresa tomou',
  intermediario: 'Sua empresa intermediou',
};

/**
 * NFS-e em que a empresa aparece (F5-13.l), vindas do Ambiente de Dados Nacional da NFS-e: os
 * serviços que ela contratou (e os que prestou ou intermediou), com o XML de cada nota.
 */
export function ReceivedServices() {
  const { api } = useApp();
  const canWrite = useCan('catalog.write');
  const queryClient = useQueryClient();
  const companies = useQuery({
    queryKey: ['companies'],
    queryFn: () => api.get<{ id: string; legalName: string }[]>('/companies'),
  });
  const notes = useQuery({
    queryKey: ['nfse-received'],
    queryFn: () => api.get<NfseReceivedView[]>('/fiscal/nfse-received'),
  });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sync = async () => {
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      const results: DfeSyncResult[] = [];
      for (const c of companies.data ?? []) {
        results.push(await api.post<DfeSyncResult>(`/fiscal/nfse-received/sync/${c.id}`, {}));
      }
      setMessage(results.map((r) => r.message).join(' ') || 'Nenhuma empresa cadastrada.');
      await queryClient.invalidateQueries({ queryKey: ['nfse-received'] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const xml = async (n: NfseReceivedView) => {
    const url = URL.createObjectURL(await api.download(`/fiscal/nfse-received/${n.id}/xml`));
    const link = document.createElement('a');
    link.href = url;
    link.download = `NFSe${n.accessKey}.xml`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };
  const rows = notes.data ?? [];
  return (
    <section aria-labelledby="nfse-recebidas" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="nfse-recebidas" className="text-lg font-semibold">
          Notas de serviço (NFS-e) da sua empresa
        </h2>
        {canWrite && (
          <Button
            variant="secondary"
            loading={busy}
            icon={<RefreshCw className="size-4" aria-hidden />}
            onClick={() => void sync()}
          >
            Buscar NFS-e agora
          </Button>
        )}
      </div>
      <p className="text-sm text-muted">
        O Bipaê pergunta de hora em hora ao Ambiente Nacional da NFS-e (produção restrita) pelas
        notas de serviço em que o seu CNPJ aparece. Precisa do certificado digital A1 da empresa.
      </p>
      {message && <Alert tone="success">{message}</Alert>}
      {error && <Alert>{error}</Alert>}
      {rows.length > 0 && (
        <DataTable
          caption="Notas de serviço da sua empresa"
          rows={rows}
          columns={[
            { header: 'Emissão', cell: (r) => date(r.issuedAt) },
            {
              header: 'Prestador',
              cell: (r) => `${r.issuerName} · ${formatTaxId(r.issuerTaxId)}`,
            },
            { header: 'Papel', cell: (r) => ROLE[r.role] },
            { header: 'Valor', align: 'right', cell: (r) => money(r.valueCents) },
            {
              header: 'Situação',
              cell: (r) =>
                r.cancelled ? (
                  <Badge tone="neutral">Cancelada</Badge>
                ) : (
                  <Badge tone="success">Válida</Badge>
                ),
            },
            {
              header: 'XML',
              cell: (r) => (
                <Button
                  variant="ghost"
                  aria-label={`Baixar o XML da NFS-e ${r.number ?? r.accessKey}`}
                  onClick={() => void xml(r).catch((e) => setError((e as Error).message))}
                >
                  Baixar
                </Button>
              ),
            },
          ]}
        />
      )}
    </section>
  );
}
