import {
  formatBRL,
  type Cents,
  type CiapAssetView,
  type CiapDisposalType,
  type EfdSettings,
  type EfdSettingsInput,
  type EfdSummaryView,
} from '@bipae/domain';
import { Alert, Button, Card, MoneyField, PageHeader, SelectField, TextField } from '@bipae/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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

/** Baixa o arquivo que a API devolveu. */
function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const brl = (cents: number) => formatBRL(cents as Cents);

/**
 * Arquivos para o contador: o pacote do mês com os XML (F4-14.a) e o arquivo da EFD ICMS/IPI
 * (F4-14.b), com a apuração conferida antes de baixar.
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
  const monthOk = /^\d{4}-\d{2}$/.test(month);

  const download = async () => {
    setError(null);
    setBusy(true);
    try {
      save(
        await api.download(`/fiscal/accountant-export?companyId=${company}&month=${month}`),
        `bipae-contador-${month}.zip`,
      );
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
        description="O pacote do mês com o XML de cada nota, dos cancelamentos e das inutilizações de números, e o arquivo do SPED (EFD ICMS/IPI)."
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
          <Button loading={busy} disabled={!company || !monthOk} onClick={() => void download()}>
            Baixar pacote do mês
          </Button>
        </div>
        <p className="text-sm text-muted">
          Enquanto a emissão estiver em homologação, as notas do pacote não têm valor fiscal.
        </p>
      </Card>
      {company && <EfdCard companyId={company} month={month} monthOk={monthOk} />}
      {company && <CiapAssetsCard companyId={company} />}
    </>
  );
}

/** Arquivo da EFD ICMS/IPI do mês (F4-14.b.3): configuração, conferência e download. */
function EfdCard({
  companyId,
  month,
  monthOk,
}: {
  companyId: string;
  month: string;
  monthOk: boolean;
}) {
  const { api } = useApp();
  const settings = useQuery({
    queryKey: ['efd-settings', companyId],
    queryFn: () => api.get<EfdSettings>(`/fiscal/efd/settings?companyId=${companyId}`),
  });
  if (!settings.data) return null;
  // Uma empresa nova recomeça o formulário com a configuração dela.
  return (
    <EfdForm
      key={companyId}
      companyId={companyId}
      month={month}
      monthOk={monthOk}
      initial={settings.data}
    />
  );
}

function EfdForm({
  companyId,
  month,
  monthOk,
  initial,
}: {
  companyId: string;
  month: string;
  monthOk: boolean;
  initial: EfdSettings;
}) {
  const { api } = useApp();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<EfdSettings>(initial);
  const [previousCredit, setPreviousCredit] = useState<number | null>(0);
  const [checked, setChecked] = useState<{ query: string; view: EfdSummaryView } | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<'save' | 'check' | 'file' | null>(null);

  const set = (patch: Partial<EfdSettings>) => setForm({ ...form, ...patch });
  const text = (v: string) => (v.trim() ? v : null);
  // Inventário (F4-14.b.5): em fevereiro vai o de 31/12 sozinho; em outro mês, só se pedir.
  const [inventoryDate, setInventoryDate] = useState('');
  const query =
    `companyId=${companyId}&month=${month}&previousCreditCents=${previousCredit ?? 0}` +
    (inventoryDate ? `&inventoryDate=${inventoryDate}` : '');
  // A conferência só vale para o mês e o saldo com que foi feita.
  const summary = checked?.query === query ? checked.view : null;

  const run = async (kind: 'save' | 'check' | 'file', job: () => Promise<void>) => {
    setMessage(null);
    setBusy(kind);
    try {
      await job();
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };
  const saveSettings = () =>
    run('save', async () => {
      const body: EfdSettingsInput = { ...form, companyId };
      setForm(await api.put<EfdSettings>('/fiscal/efd/settings', body));
      await queryClient.invalidateQueries({ queryKey: ['efd-settings', companyId] });
      setMessage({ ok: true, text: 'Configuração do SPED salva.' });
    });
  const check = () =>
    run('check', async () =>
      setChecked({ query, view: await api.get<EfdSummaryView>(`/fiscal/efd/summary?${query}`) }),
    );
  const file = () =>
    run('file', async () => {
      save(
        await api.download(`/fiscal/efd/file?${query}`),
        summary?.fileName ?? `EFD-${month}.txt`,
      );
    });

  return (
    <Card className="mt-4 flex max-w-xl flex-col gap-3">
      <h2 className="text-lg font-semibold">Arquivo do SPED (EFD ICMS/IPI)</h2>
      <p className="text-sm text-muted">
        Montado das notas autorizadas do mês, pelo Guia Prático oficial. Confira com o contador e
        valide no programa da Receita (PVA) antes de transmitir.
      </p>
      <SelectField
        label="Perfil do estabelecimento"
        value={form.profile}
        onChange={(e) => set({ profile: e.target.value as EfdSettings['profile'] })}
        options={[
          { value: 'A', label: 'Perfil A' },
          { value: 'B', label: 'Perfil B' },
          { value: 'C', label: 'Perfil C' },
        ]}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label="Contador (nome)"
          value={form.accountantName ?? ''}
          onChange={(e) => set({ accountantName: text(e.target.value) })}
        />
        <TextField
          label="CPF do contador"
          value={form.accountantCpf ?? ''}
          onChange={(e) => set({ accountantCpf: text(e.target.value) })}
        />
        <TextField
          label="CRC"
          value={form.accountantCrc ?? ''}
          onChange={(e) => set({ accountantCrc: text(e.target.value) })}
        />
        <TextField
          label="E-mail do contador"
          type="email"
          value={form.accountantEmail ?? ''}
          onChange={(e) => set({ accountantEmail: text(e.target.value) })}
        />
        <TextField
          label="Dia do vencimento do ICMS"
          hint="No mês seguinte"
          inputMode="numeric"
          value={form.icmsDueDay ? String(form.icmsDueDay) : ''}
          onChange={(e) => {
            const day = Number(e.target.value.replace(/\D/g, ''));
            set({ icmsDueDay: day >= 1 && day <= 31 ? day : null });
          }}
        />
        <TextField
          label="Código de receita do ICMS"
          hint="Como na guia da sua UF"
          value={form.icmsRevenueCode ?? ''}
          onChange={(e) => set({ icmsRevenueCode: text(e.target.value) })}
        />
      </div>
      <p className="text-sm text-muted">
        Crédito do ativo imobilizado (CIAP): as compras marcadas como ativo viram bens e o crédito
        entra em 48 parcelas. O arquivo precisa da conta contábil do ativo e do código de ajuste da
        sua UF; peça ao contador.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label="Conta do ativo imobilizado (código)"
          value={form.ciapAccountCode ?? ''}
          onChange={(e) => set({ ciapAccountCode: text(e.target.value) })}
        />
        <TextField
          label="Nome da conta do ativo"
          value={form.ciapAccountName ?? ''}
          onChange={(e) => set({ ciapAccountName: text(e.target.value) })}
        />
        <TextField
          label="Nível da conta"
          hint="Como no plano de contas"
          inputMode="numeric"
          value={form.ciapAccountLevel ? String(form.ciapAccountLevel) : ''}
          onChange={(e) => {
            const level = Number(e.target.value.replace(/\D/g, ''));
            set({ ciapAccountLevel: level >= 1 ? level : null });
          }}
        />
        <TextField
          label="Código de ajuste do CIAP (E111)"
          hint="Tabela 5.1.1 da sua UF, 8 caracteres"
          value={form.ciapAdjustmentCode ?? ''}
          onChange={(e) => set({ ciapAdjustmentCode: text(e.target.value.toUpperCase()) })}
        />
      </div>
      <SelectField
        label="Saídas com ICMS já cobrado por ST (CST 60) no índice do CIAP"
        value={
          form.ciapStOutputsTaxed === null ? '' : form.ciapStOutputsTaxed ? 'taxed' : 'untaxed'
        }
        onChange={(e) =>
          set({
            ciapStOutputsTaxed: e.target.value === '' ? null : e.target.value === 'taxed',
          })
        }
        options={[
          { value: '', label: 'Ainda não sei (não contam, com aviso)' },
          { value: 'taxed', label: 'Contam como tributadas' },
          { value: 'untaxed', label: 'Não contam como tributadas' },
        ]}
      />
      <div>
        <Button variant="secondary" loading={busy === 'save'} onClick={() => void saveSettings()}>
          Salvar configuração
        </Button>
      </div>
      <MoneyField
        label="Saldo credor de ICMS do mês anterior"
        value={previousCredit}
        onChange={setPreviousCredit}
      />
      <TextField
        label="Data do inventário (opcional)"
        hint="Em fevereiro o arquivo já leva o estoque de 31/12. Preencha só se o fisco pediu outro."
        type="date"
        value={inventoryDate}
        onChange={(e) => setInventoryDate(e.target.value)}
      />
      {message && <Alert tone={message.ok ? 'success' : 'danger'}>{message.text}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          loading={busy === 'check'}
          disabled={!monthOk}
          onClick={() => void check()}
        >
          Conferir o mês
        </Button>
        <Button loading={busy === 'file'} disabled={!monthOk} onClick={() => void file()}>
          Baixar arquivo do SPED
        </Button>
      </div>
      {summary && (
        <div className="flex flex-col gap-2 text-sm" data-testid="efd-summary">
          <p>
            {summary.documents} nota(s) no arquivo. ICMS das saídas{' '}
            {brl(summary.settlement.debitsCents)}, créditos {brl(summary.settlement.creditsCents)}.{' '}
            {summary.settlement.adjustmentCreditsCents > 0 &&
              `Crédito do ativo (CIAP): ${brl(summary.settlement.adjustmentCreditsCents)}. `}
            {summary.settlement.dueCents > 0
              ? `A recolher: ${brl(summary.settlement.dueCents)}.`
              : `Saldo credor para o mês seguinte: ${brl(summary.settlement.creditCarriedCents)}.`}
          </p>
          {summary.warnings.length > 0 && (
            <Alert tone="warning">
              <ul className="list-disc pl-4">
                {summary.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </Alert>
          )}
        </div>
      )}
    </Card>
  );
}

const DISPOSAL_LABELS: Record<CiapDisposalType, string> = {
  AT: 'Venda ou transferência',
  PE: 'Perda, extravio ou deterioração',
  OT: 'Outra saída',
};

const totalOf = (a: CiapAssetView) =>
  a.icmsOwnCents + a.icmsStCents + a.icmsFreightCents + a.icmsDifalCents;

const brDate = (iso: string) => iso.split('-').reverse().join('/');

/**
 * Bens do ativo no CIAP (F4-14.b.7): os que vieram de compras marcadas como ativo imobilizado e os
 * que já existiam antes do Bipaê, com o frete do CT-e, o DIFAL e a baixa do bem.
 */
function CiapAssetsCard({ companyId }: { companyId: string }) {
  const { api } = useApp();
  const queryClient = useQueryClient();
  const key = ['ciap-assets', companyId];
  const assets = useQuery({
    queryKey: key,
    queryFn: () => api.get<CiapAssetView[]>(`/fiscal/efd/ciap-assets?companyId=${companyId}`),
  });
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState({
    description: '',
    enteredOn: '',
    own: 0 as number | null,
    st: 0 as number | null,
    freight: 0 as number | null,
    difal: 0 as number | null,
  });
  // Uma baixa por vez: o bem aberto, o tipo, a data ou a chave da NF-e de saída.
  const [closing, setClosing] = useState<{
    id: string;
    type: CiapDisposalType;
    on: string;
    accessKey: string;
  } | null>(null);
  const [credit, setCredit] = useState<{
    id: string;
    freight: number | null;
    difal: number | null;
  } | null>(null);

  const run = async (job: () => Promise<void>, done: string) => {
    setMessage(null);
    setBusy(true);
    try {
      await job();
      await queryClient.invalidateQueries({ queryKey: key });
      setMessage({ ok: true, text: done });
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const create = () =>
    run(async () => {
      await api.post('/fiscal/efd/ciap-assets', {
        companyId,
        description: adding.description,
        enteredOn: adding.enteredOn,
        icmsOwnCents: adding.own ?? 0,
        icmsStCents: adding.st ?? 0,
        icmsFreightCents: adding.freight ?? 0,
        icmsDifalCents: adding.difal ?? 0,
      });
      setAdding({ description: '', enteredOn: '', own: 0, st: 0, freight: 0, difal: 0 });
    }, 'Bem anotado no CIAP.');
  const saveCredit = () =>
    run(async () => {
      if (!credit) return;
      await api.patch(`/fiscal/efd/ciap-assets/${credit.id}`, {
        icmsFreightCents: credit.freight ?? 0,
        icmsDifalCents: credit.difal ?? 0,
      });
      setCredit(null);
    }, 'Crédito do bem atualizado.');
  const writeOff = () =>
    run(async () => {
      if (!closing) return;
      await api.post(`/fiscal/efd/ciap-assets/${closing.id}/write-off`, {
        type: closing.type,
        ...(closing.type === 'AT'
          ? { accessKey: closing.accessKey.replace(/\D/g, '') }
          : { on: closing.on }),
      });
      setClosing(null);
    }, 'Saída do bem registrada. Ela vai no arquivo do mês dela.');
  const undo = (id: string) =>
    run(async () => {
      await api.delete(`/fiscal/efd/ciap-assets/${id}/write-off`);
    }, 'Saída desfeita.');

  const list = assets.data ?? [];
  return (
    <Card className="mt-4 flex max-w-xl flex-col gap-3" data-testid="ciap-assets">
      <h2 className="text-lg font-semibold">Bens do ativo (CIAP)</h2>
      <p className="text-sm text-muted">
        O ICMS do ativo imobilizado vira crédito em 48 parcelas. Compras marcadas como ativo entram
        sozinhas; aqui você anota o que já existia antes do Bipaê, o ICMS do frete (CT-e) e o DIFAL,
        e dá baixa no bem que foi vendido, perdido ou saiu.
      </p>
      {list.length === 0 && <p className="text-sm text-muted">Nenhum bem no CIAP ainda.</p>}
      {list.map((a) => (
        <div key={a.id} className="flex flex-col gap-2 rounded-md border border-border p-3 text-sm">
          <div className="flex flex-wrap justify-between gap-2">
            <strong>{a.description}</strong>
            <span>
              Crédito total {brl(totalOf(a))} em {a.installments} parcelas
            </span>
          </div>
          <p className="text-muted">
            Entrada em {brDate(a.enteredOn)}
            {a.origin === 'manual' ? ' (anterior ao Bipaê)' : ''}. Parcelas em arquivo baixado:{' '}
            {a.appropriatedInstallments}.
            {a.writeOffType &&
              a.writtenOffOn &&
              ` Saída: ${DISPOSAL_LABELS[a.writeOffType]} em ${brDate(a.writtenOffOn)}.`}
          </p>
          <div className="flex flex-wrap gap-2">
            {a.writeOffType ? (
              <Button variant="secondary" disabled={busy} onClick={() => void undo(a.id)}>
                Desfazer a saída
              </Button>
            ) : (
              <>
                <Button
                  variant="secondary"
                  disabled={busy || a.appropriatedInstallments > 0}
                  onClick={() =>
                    setCredit({ id: a.id, freight: a.icmsFreightCents, difal: a.icmsDifalCents })
                  }
                >
                  Frete e DIFAL
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setClosing({ id: a.id, type: 'AT', on: '', accessKey: '' })}
                >
                  Dar baixa
                </Button>
              </>
            )}
          </div>
          {credit?.id === a.id && (
            <div className="flex flex-col gap-2">
              <MoneyField
                label="ICMS do frete (CT-e)"
                value={credit.freight}
                onChange={(freight) => setCredit({ ...credit, freight })}
              />
              <MoneyField
                label="DIFAL pago na guia"
                value={credit.difal}
                onChange={(difal) => setCredit({ ...credit, difal })}
              />
              <div className="flex gap-2">
                <Button loading={busy} onClick={() => void saveCredit()}>
                  Salvar
                </Button>
                <Button variant="secondary" onClick={() => setCredit(null)}>
                  Cancelar
                </Button>
              </div>
            </div>
          )}
          {closing?.id === a.id && (
            <div className="flex flex-col gap-2">
              <SelectField
                label="O que aconteceu com o bem"
                value={closing.type}
                onChange={(e) =>
                  setClosing({ ...closing, type: e.target.value as CiapDisposalType })
                }
                options={(Object.keys(DISPOSAL_LABELS) as CiapDisposalType[]).map((value) => ({
                  value,
                  label: DISPOSAL_LABELS[value],
                }))}
              />
              {closing.type === 'AT' ? (
                <TextField
                  label="Chave da NF-e de saída"
                  hint="A NF-e autorizada da venda ou da transferência; a data da baixa é a da nota."
                  value={closing.accessKey}
                  onChange={(e) => setClosing({ ...closing, accessKey: e.target.value })}
                />
              ) : (
                <TextField
                  label="Data da saída"
                  type="date"
                  value={closing.on}
                  onChange={(e) => setClosing({ ...closing, on: e.target.value })}
                />
              )}
              <div className="flex gap-2">
                <Button loading={busy} onClick={() => void writeOff()}>
                  Registrar a saída
                </Button>
                <Button variant="secondary" onClick={() => setClosing(null)}>
                  Cancelar
                </Button>
              </div>
            </div>
          )}
        </div>
      ))}
      <h3 className="font-semibold">Bem de antes do Bipaê</h3>
      <TextField
        label="Descrição"
        value={adding.description}
        onChange={(e) => setAdding({ ...adding, description: e.target.value })}
      />
      <TextField
        label="Data da entrada"
        type="date"
        value={adding.enteredOn}
        onChange={(e) => setAdding({ ...adding, enteredOn: e.target.value })}
      />
      <MoneyField
        label="ICMS da operação própria"
        value={adding.own}
        onChange={(own) => setAdding({ ...adding, own })}
      />
      <MoneyField
        label="ICMS da substituição tributária"
        value={adding.st}
        onChange={(st) => setAdding({ ...adding, st })}
      />
      <MoneyField
        label="ICMS do frete (CT-e)"
        value={adding.freight}
        onChange={(freight) => setAdding({ ...adding, freight })}
      />
      <MoneyField
        label="DIFAL pago na guia"
        value={adding.difal}
        onChange={(difal) => setAdding({ ...adding, difal })}
      />
      {message && <Alert tone={message.ok ? 'success' : 'danger'}>{message.text}</Alert>}
      <div>
        <Button
          loading={busy}
          disabled={!adding.description.trim() || !adding.enteredOn}
          onClick={() => void create()}
        >
          Anotar o bem
        </Button>
      </div>
    </Card>
  );
}
