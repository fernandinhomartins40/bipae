import type { FiscalDocumentStatus, FiscalDocumentView } from '@bipae/domain';
import { buildDanfeNfce, danfeNfceFromXml, receiptToHtml } from '@bipae/pdv-core';
import { Alert, Badge, Button } from '@bipae/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useApp, useCan } from '../context';

const STATUS: Record<
  FiscalDocumentStatus,
  { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }
> = {
  pending: { label: 'Na fila para a SEFAZ', tone: 'neutral' },
  error: { label: 'Falha temporária: nova tentativa automática', tone: 'warning' },
  not_configured: { label: 'Falta configurar', tone: 'warning' },
  authorized: { label: 'Autorizada', tone: 'success' },
  rejected: { label: 'Recusada pela SEFAZ', tone: 'danger' },
  denied: { label: 'Uso denegado', tone: 'danger' },
};

/** Chave de acesso em grupos de 4, como no DANFE. */
const groups = (key: string) => key.replace(/(.{4})/g, '$1 ').trim();

/**
 * NFC-e da venda (F3-14.c): situação na SEFAZ, o que falta configurar, XML autorizado, cupom e
 * nova tentativa. Só homologação, enquanto o dono não pedir produção (regra 4 do projeto).
 */
export function FiscalDocumentSection({ saleId }: { saleId: string }) {
  const { api } = useApp();
  const canWrite = useCan('catalog.write');
  const queryClient = useQueryClient();
  const doc = useQuery({
    queryKey: ['sale', saleId, 'fiscal'],
    queryFn: () => api.get<FiscalDocumentView | null>(`/sales/${saleId}/fiscal`),
    // Enquanto está na fila, a situação muda sozinha.
    refetchInterval: (q) =>
      q.state.data && ['pending', 'error'].includes(q.state.data.status) ? 5000 : false,
  });
  const [receipt, setReceipt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const d = doc.data;

  const xml = async () => (await api.download(`/fiscal/documents/${d!.id}/xml`)).text();
  const download = async () => {
    setError(null);
    try {
      const url = URL.createObjectURL(new Blob([await xml()], { type: 'application/xml' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `NFCe${d!.accessKey}.xml`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const showReceipt = async () => {
    setError(null);
    try {
      const data = danfeNfceFromXml(await xml());
      setReceipt(receiptToHtml(buildDanfeNfce(data, { columns: 48 }), 48));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const retry = async () => {
    setError(null);
    setBusy(true);
    try {
      await api.post(`/fiscal/documents/${d!.id}/retry`);
      await queryClient.invalidateQueries({ queryKey: ['sale', saleId, 'fiscal'] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Nota fiscal">
      <h3 className="mb-2 font-semibold">Nota fiscal (NFC-e)</h3>
      {doc.error && <Alert>{(doc.error as Error).message}</Alert>}
      {doc.data === null && (
        <p className="text-sm text-muted">Esta venda é anterior à emissão da NFC-e pelo Bipaê.</p>
      )}
      {d && (
        <div className="flex flex-col gap-2 text-sm">
          <p>
            <Badge tone={STATUS[d.status].tone}>{STATUS[d.status].label}</Badge>
            <span className="ml-2 text-muted">Ambiente de homologação (sem valor fiscal)</span>
          </p>
          {d.contingency && (
            <p className="font-semibold">
              Emitida em contingência off-line (venda feita sem internet). A transmissão à SEFAZ tem
              prazo de 24 horas.
            </p>
          )}
          {d.number !== null && (
            <p>
              NFC-e nº {d.number}, série {d.series}
              {d.protocol && ` · protocolo ${d.protocol}`}
            </p>
          )}
          {d.accessKey && (
            <p className="break-all font-mono text-xs" aria-label="Chave de acesso">
              {groups(d.accessKey)}
            </p>
          )}
          {d.status === 'not_configured' && (
            <Alert tone="warning" title="Falta configurar para emitir">
              <ul className="list-disc pl-5">
                {d.pendingItems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </Alert>
          )}
          {(d.status === 'rejected' || d.status === 'denied') && (
            <Alert title={`Código ${d.cStat}: ${d.xMotivo ?? ''}`}>
              {d.help && (
                <span className="flex flex-col gap-1" data-testid="rejection-help">
                  <span>
                    <strong>O que aconteceu:</strong> {d.help.cause}
                  </span>
                  <span>
                    <strong>O que fazer:</strong> {d.help.fix}
                  </span>
                  {d.help.next === 'corrigir' && (
                    <span className="text-sm">
                      Depois de corrigir, use &quot;Tentar de novo&quot;: a nota sai com o mesmo
                      número.
                    </span>
                  )}
                </span>
              )}
            </Alert>
          )}
          {d.status === 'error' && d.lastError && (
            <p className="text-muted">Última falha: {d.lastError}</p>
          )}
          {error && <Alert>{error}</Alert>}
          <div className="flex flex-wrap gap-2">
            {d.status === 'authorized' && (
              <>
                <Button variant="secondary" onClick={() => void download()}>
                  Baixar XML
                </Button>
                <Button variant="secondary" onClick={() => void showReceipt()}>
                  Ver cupom
                </Button>
              </>
            )}
            {canWrite && d.status !== 'authorized' && d.status !== 'denied' && (
              <Button variant="secondary" loading={busy} onClick={() => void retry()}>
                Tentar de novo
              </Button>
            )}
          </div>
          {receipt && (
            <div
              className="overflow-x-auto rounded-ui border border-border"
              aria-label="Cupom da NFC-e"
              // O HTML é montado pelo próprio Bipaê (receiptToHtml escapa todo o texto).
              dangerouslySetInnerHTML={{ __html: receipt }}
            />
          )}
        </div>
      )}
    </section>
  );
}
