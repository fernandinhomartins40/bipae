import { Alert, Button, Card, PageHeader, SelectField, TextField } from '@bipae/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useApp } from '../context';

/** Mês passado (AAAA-MM), em Brasília: é o que o contador costuma pedir. */
const lastMonth = () => {
  const [year, month] = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' })
    .format(new Date())
    .slice(0, 7)
    .split('-')
    .map(Number) as [number, number];
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
};

/**
 * Arquivos para o contador (F4-14.a): o pacote do mês com os XML das NFC-e, dos cancelamentos e
 * das inutilizações, e um resumo em planilha.
 */
export function AccountantPage() {
  const { api } = useApp();
  const companies = useQuery({
    queryKey: ['companies'],
    queryFn: () =>
      api.get<{ id: string; legalName: string; tradeName: string | null }[]>('/companies'),
  });
  const [companyId, setCompanyId] = useState('');
  const [month, setMonth] = useState(lastMonth());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const company = companyId || companies.data?.[0]?.id || '';

  const download = async () => {
    setError(null);
    setBusy(true);
    try {
      const blob = await api.download(
        `/fiscal/accountant-export?companyId=${company}&month=${month}`,
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `bipae-contador-${month}.zip`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Arquivos para o contador"
        description="O pacote do mês com o XML de cada NFC-e autorizada, dos cancelamentos e das inutilizações de números, e um resumo em planilha. É o que o escritório de contabilidade importa no sistema dele."
      />
      <Card className="flex max-w-xl flex-col gap-3">
        <SelectField
          label="Empresa"
          value={company}
          onChange={(e) => setCompanyId(e.target.value)}
          options={(companies.data ?? []).map((c) => ({
            value: c.id,
            label: c.tradeName ?? c.legalName,
          }))}
        />
        <TextField
          label="Mês"
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        />
        {error && <Alert>{error}</Alert>}
        <div>
          <Button
            loading={busy}
            disabled={!company || !/^\d{4}-\d{2}$/.test(month)}
            onClick={() => void download()}
          >
            Baixar pacote do mês
          </Button>
        </div>
        <p className="text-sm text-muted">
          Enquanto a emissão estiver em homologação, as notas do pacote não têm valor fiscal. O
          arquivo do SPED chega em breve.
        </p>
      </Card>
    </>
  );
}
