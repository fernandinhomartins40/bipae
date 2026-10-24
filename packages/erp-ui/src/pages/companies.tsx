import { formatTaxId, UFS, type FiscalProfile, type PriceTable } from '@bipae/domain';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Drawer,
  MoneyField,
  PageHeader,
  SelectField,
  TaxIdField,
  TextField,
} from '@bipae/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus, Store } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useApp, useCan } from '../context';
import { CertificateLine, useCertificates } from './certificate';
import { formatRate, useFiscalOptions, useStNetLoadClasses } from './fiscal-lookup';

/** "4781400" → "4781-4/00", aceitando digitação parcial. */
export function formatCnae(text: string): string {
  const d = text.replace(/\D/g, '').slice(0, 7);
  if (d.length <= 4) return d;
  if (d.length <= 5) return `${d.slice(0, 4)}-${d.slice(4)}`;
  return `${d.slice(0, 4)}-${d.slice(4, 5)}/${d.slice(5)}`;
}

interface Company {
  id: string;
  legalName: string;
  tradeName: string | null;
  taxId: string | null;
  uf: string | null;
  taxRegime: string | null;
  ibsCbsRegular?: boolean;
  cnae?: string | null;
  stSpecialRegime?: boolean;
  stNetLoadOptions?: {
    transferMargin?: 'replace' | 'compound' | null;
    industryLoad?: 'standard' | 'optional' | null;
    distributionCenter?: boolean;
  };
  ie?: string | null;
  street?: string | null;
  streetNumber?: string | null;
  complement?: string | null;
  district?: string | null;
  cityCode?: string | null;
  cep?: string | null;
  phone?: string | null;
  nfcePaymentCodes?: Record<string, string>;
  demonstrationProfileId?: string | null;
  municipalRegistration?: string | null;
  nfseSeries?: number;
  nfseSimplesPercent?: string | null;
  nfseTaxFederal?: string | null;
  nfseTaxState?: string | null;
  nfseTaxMunicipal?: string | null;
}
interface StoreRow {
  id: string;
  name: string;
  companyId: string;
  priceTableId: string | null;
}

/**
 * Multi-company: a client (account) may have several companies (CNPJs), each with its own
 * stores. Fiscal settings are per company (UF, CNPJ) from Phase 3 on.
 */
export function CompaniesPage() {
  const { api } = useApp();
  const canManage = useCan('admin.stores');
  const queryClient = useQueryClient();
  const companies = useQuery({
    queryKey: ['companies'],
    queryFn: () => api.get<Company[]>('/companies'),
  });
  const stores = useQuery({ queryKey: ['stores'], queryFn: () => api.get<StoreRow[]>('/stores') });
  const [editing, setEditing] = useState<Company | 'new' | null>(null);
  const [storeFor, setStoreFor] = useState<Company | null>(null);
  const [editingStore, setEditingStore] = useState<{ company: Company; store: StoreRow } | null>(
    null,
  );
  const tables = useQuery({
    queryKey: ['price-tables'],
    queryFn: () => api.get<PriceTable[]>('/price-tables'),
  });
  const tableName = (id: string | null) => tables.data?.find((t) => t.id === id)?.name;
  const certificates = useCertificates().data;
  const fiscal = useFiscalOptions().data;
  const regimeLabel = (id: string | null) => fiscal?.regimes.find((r) => r.id === id)?.label;
  const reload = () =>
    queryClient
      .invalidateQueries({ queryKey: ['companies'] })
      .then(() => queryClient.invalidateQueries({ queryKey: ['stores'] }));

  return (
    <>
      <PageHeader
        title="Empresas e lojas"
        description="Cada empresa é um CNPJ. Cada loja pertence a uma empresa e tem seus próprios caixas."
        actions={
          canManage && (
            <Button
              icon={<Plus className="size-5" aria-hidden />}
              onClick={() => setEditing('new')}
            >
              Nova empresa
            </Button>
          )
        }
      />
      {(companies.error || stores.error) && (
        <Alert>{((companies.error ?? stores.error) as Error).message}</Alert>
      )}
      <div className="flex flex-col gap-4">
        {companies.data?.map((c) => (
          <Card key={c.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex gap-3">
                <Building2 className="mt-1 size-6 text-primary" aria-hidden />
                <div>
                  <p className="text-lg font-semibold">{c.tradeName ?? c.legalName}</p>
                  <p className="text-sm text-muted">
                    {c.tradeName && `${c.legalName} · `}
                    {c.taxId ? formatTaxId(c.taxId) : 'CNPJ não informado'}
                    {c.uf && ` · ${c.uf}`}
                    {regimeLabel(c.taxRegime) && ` · ${regimeLabel(c.taxRegime)}`}
                  </p>
                  {(!c.uf || !c.taxRegime) && (
                    <p className="text-sm text-muted">
                      Falta configurar:{' '}
                      {[!c.uf && 'UF', !c.taxRegime && 'regime tributário']
                        .filter(Boolean)
                        .join(' e ')}
                      . O Bipaê vai precisar disso para calcular os impostos e emitir notas.
                    </p>
                  )}
                  {canManage && c.taxRegime && <RevenueAlerts companyId={c.id} />}
                  <CertificateLine
                    companyId={c.id}
                    certificate={certificates?.find((cert) => cert.companyId === c.id)}
                  />
                </div>
              </div>
              {canManage && (
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => setEditing(c)}>
                    Editar
                  </Button>
                  <Button
                    variant="ghost"
                    icon={<Plus className="size-4" aria-hidden />}
                    onClick={() => setStoreFor(c)}
                  >
                    Nova loja
                  </Button>
                </div>
              )}
            </div>
            <ul className="mt-4 flex flex-wrap gap-2">
              {stores.data
                ?.filter((s) => s.companyId === c.id)
                .map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      disabled={!canManage}
                      onClick={() => setEditingStore({ company: c, store: s })}
                      aria-label={canManage ? `Editar a loja ${s.name}` : undefined}
                      className="inline-flex items-center gap-2 rounded-full bg-surface-2 px-3 py-1 text-sm font-medium enabled:hover:bg-border"
                    >
                      <Store className="size-4" aria-hidden /> {s.name}
                      {tableName(s.priceTableId) && (
                        <span className="text-muted">· {tableName(s.priceTableId)}</span>
                      )}
                    </button>
                  </li>
                ))}
            </ul>
          </Card>
        ))}
      </div>
      {editing && (
        <CompanyForm
          company={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}
      {storeFor && (
        <StoreForm company={storeFor} onClose={() => setStoreFor(null)} onSaved={reload} />
      )}
      {editingStore && (
        <StoreForm
          company={editingStore.company}
          store={editingStore.store}
          tables={tables.data ?? []}
          onClose={() => setEditingStore(null)}
          onSaved={reload}
        />
      )}
    </>
  );
}

/**
 * Percentual com vírgula ("6,54"): aceita ponto ou vírgula, guarda só números, uma vírgula e até
 * duas casas. Sem preenchimento automático, que o navegador usava para pôr "Brasil" no campo.
 */
export function cleanPercent(text: string) {
  const [whole = '', ...rest] = text
    .replace(/\./g, ',')
    .replace(/[^\d,]/g, '')
    .split(',');
  const integer = whole.slice(0, 2);
  return rest.length ? `${integer},${rest.join('').slice(0, 2)}` : integer;
}

function PercentField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <TextField
      label={label}
      hint={hint}
      inputMode="decimal"
      autoComplete="off"
      value={value}
      onChange={(e) => onChange(cleanPercent(e.target.value))}
    />
  );
}

interface SimplesRateAnswer {
  annexes: { annex: string; title: string }[];
  result: { rate: string; bracket: number; nominal: string } | null;
}

/**
 * Para quem não sabe o percentual do Simples: o anexo e o faturamento dos últimos 12 meses dão a
 * alíquota efetiva, pela tabela da LC 123/2006 que o servidor guarda.
 */
function SimplesRateHelper({ onUse }: { onUse: (percent: string) => void }) {
  const { api } = useApp();
  const [open, setOpen] = useState(false);
  const [annex, setAnnex] = useState('III');
  const [revenue, setRevenue] = useState<number | null>(0);
  const [answer, setAnswer] = useState<SimplesRateAnswer['result']>(null);
  const [error, setError] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['fiscal', 'simples-rate'],
    queryFn: () => api.get<SimplesRateAnswer>('/fiscal/simples-rate'),
    enabled: open,
    staleTime: Infinity,
  });
  if (!open) {
    return (
      <Button variant="ghost" onClick={() => setOpen(true)}>
        Não sei o percentual: calcular para mim
      </Button>
    );
  }
  const calculate = async () => {
    setError(null);
    setAnswer(null);
    try {
      const r = await api.get<SimplesRateAnswer>(
        `/fiscal/simples-rate?annex=${annex}&rbt12Cents=${revenue ?? 0}`,
      );
      setAnswer(r.result);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const percent = answer?.rate.replace('.', ',');
  return (
    <div className="flex flex-col gap-3 rounded-ui border border-border p-3 sm:col-span-2">
      <p className="font-semibold">Calcular o percentual do Simples</p>
      <SelectField
        label="Anexo do Simples do seu serviço"
        hint="Aparece no extrato mensal do Simples (PGDAS-D), na linha da atividade. Atividade do Anexo V com folha de salários de 28% ou mais do faturamento usa o Anexo III (fator R)."
        value={annex}
        onChange={(e) => setAnnex(e.target.value)}
        options={(list.data?.annexes ?? [{ annex: 'III', title: '' }]).map((a) => ({
          value: a.annex,
          label: `Anexo ${a.annex}${a.title ? ` · ${a.title}` : ''}`,
        }))}
      />
      <MoneyField label="Faturamento dos últimos 12 meses" value={revenue} onChange={setRevenue} />
      <p className="text-sm text-muted">
        A receita bruta dos 12 meses anteriores (no extrato do DAS aparece como RBT12). Empresa
        começando agora: deixe zero.
      </p>
      <Button variant="secondary" onClick={() => void calculate()}>
        Calcular
      </Button>
      {error && <Alert>{error}</Alert>}
      {answer && percent && (
        <div className="flex flex-col gap-2">
          <p>
            Alíquota efetiva: <strong>{percent}%</strong> (faixa {answer.bracket}, alíquota nominal{' '}
            {answer.nominal.replace('.', ',')}%), pela LC 123/2006.
          </p>
          <Button
            onClick={() => {
              onUse(percent);
              setOpen(false);
            }}
          >
            Usar {percent}%
          </Button>
        </div>
      )}
    </div>
  );
}

function CompanyForm({
  company,
  onClose,
  onSaved,
}: {
  company: Company | null;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}) {
  const { api } = useApp();
  const [v, setV] = useState({
    legalName: company?.legalName ?? '',
    tradeName: company?.tradeName ?? '',
    taxId: company?.taxId ?? '',
    uf: company?.uf ?? '',
    taxRegime: company?.taxRegime ?? '',
    ibsCbsRegular: company?.ibsCbsRegular ?? false,
    cnae: formatCnae(company?.cnae ?? ''),
    stSpecialRegime: company?.stSpecialRegime ?? false,
    transferMargin: company?.stNetLoadOptions?.transferMargin ?? '',
    industryLoad: company?.stNetLoadOptions?.industryLoad ?? '',
    distributionCenter: company?.stNetLoadOptions?.distributionCenter ?? false,
    ie: company?.ie ?? '',
    street: company?.street ?? '',
    streetNumber: company?.streetNumber ?? '',
    complement: company?.complement ?? '',
    district: company?.district ?? '',
    cityCode: company?.cityCode ?? '',
    cep: company?.cep ?? '',
    phone: company?.phone ?? '',
    voucher: company?.nfcePaymentCodes?.voucher ?? '10',
    demonstrationProfileId: company?.demonstrationProfileId ?? '',
    municipalRegistration: company?.municipalRegistration ?? '',
    nfseSeries: String(company?.nfseSeries ?? 1),
    nfseSimplesPercent: company?.nfseSimplesPercent?.replace('.', ',') ?? '',
    nfseTaxFederal: company?.nfseTaxFederal?.replace('.', ',') ?? '',
    nfseTaxState: company?.nfseTaxState?.replace('.', ',') ?? '',
    nfseTaxMunicipal: company?.nfseTaxMunicipal?.replace('.', ',') ?? '',
  });
  const profiles = useQuery({
    queryKey: ['fiscal-profiles'],
    queryFn: () => api.get<FiscalProfile[]>('/fiscal-profiles'),
  });
  const fiscal = useFiscalOptions().data;
  const regime = fiscal?.regimes.find((r) => r.id === v.taxRegime);
  const ufRate = fiscal?.ufRates.find((r) => r.uf === v.uf);
  const netLoad = useStNetLoadClasses(v.uf || null, v.cnae).data;
  const [error, setError] = useState<string | null>(null);
  const simplesRegime = v.taxRegime === 'simples' || v.taxRegime === 'simples-excesso';
  const otherRegime = v.taxRegime === 'presumido' || v.taxRegime === 'real';
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const body = {
      legalName: v.legalName,
      tradeName: v.tradeName || null,
      taxId: v.taxId || null,
      uf: v.uf || null,
      taxRegime: v.taxRegime || null,
      ibsCbsRegular: v.ibsCbsRegular,
      cnae: v.cnae || null,
      stSpecialRegime: v.stSpecialRegime,
      stNetLoadOptions: {
        transferMargin: v.transferMargin || null,
        industryLoad: v.industryLoad || null,
        distributionCenter: v.distributionCenter,
      },
      ie: v.ie || null,
      street: v.street || null,
      streetNumber: v.streetNumber || null,
      complement: v.complement || null,
      district: v.district || null,
      cityCode: v.cityCode || null,
      cep: v.cep || null,
      phone: v.phone || null,
      nfcePaymentCodes: { voucher: v.voucher },
      demonstrationProfileId: v.demonstrationProfileId || null,
      municipalRegistration: v.municipalRegistration || null,
      nfseSeries: Number(v.nfseSeries) || 1,
      // Só vão os percentuais do regime escolhido (os outros campos nem aparecem).
      nfseSimplesPercent: (simplesRegime && v.nfseSimplesPercent) || null,
      nfseTaxFederal: (otherRegime && v.nfseTaxFederal) || null,
      nfseTaxState: (otherRegime && v.nfseTaxState) || null,
      nfseTaxMunicipal: (otherRegime && v.nfseTaxMunicipal) || null,
    };
    try {
      if (company) await api.patch(`/companies/${company.id}`, body);
      else await api.post('/companies', body);
      await onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <Drawer
      open
      onOpenChange={(o) => !o && onClose()}
      title={company ? 'Editar empresa' : 'Nova empresa'}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        {error && <Alert>{error}</Alert>}
        <TextField
          label="Razão social"
          value={v.legalName}
          onChange={(e) => setV({ ...v, legalName: e.target.value })}
          autoFocus
        />
        <TextField
          label="Nome fantasia"
          value={v.tradeName}
          onChange={(e) => setV({ ...v, tradeName: e.target.value })}
        />
        <TaxIdField label="CNPJ" value={v.taxId} onChange={(taxId) => setV({ ...v, taxId })} />
        <SelectField
          label="UF"
          value={v.uf}
          onChange={(e) => setV({ ...v, uf: e.target.value })}
          options={[{ value: '', label: 'Selecione' }, ...UFS.map((u) => ({ value: u, label: u }))]}
          hint={
            !ufRate
              ? 'O estado onde a empresa está inscrita.'
              : ufRate.rate
                ? `ICMS geral de ${ufRate.uf}: ${formatRate(ufRate.rate)} (${ufRate.law}).`
                : `A alíquota geral de ICMS de ${ufRate.uf} ainda não foi confirmada em fonte oficial: o cálculo vai pedir a alíquota ao seu contador.`
          }
        />
        <SelectField
          label="Regime tributário"
          value={v.taxRegime}
          onChange={(e) => setV({ ...v, taxRegime: e.target.value })}
          options={[
            { value: '', label: 'Selecione' },
            ...(fiscal?.regimes ?? []).map((r) => ({ value: r.id, label: r.label })),
          ]}
          hint={
            regime
              ? `${regime.hint} Na nota: CRT ${regime.crt}, ICMS com ${regime.icmsCode === 'csosn' ? 'CSOSN' : 'CST'}.`
              : 'Não é o tipo da empresa (MEI, LTDA...), é como ela paga imposto. Na dúvida, pergunte ao contador.'
          }
        />
        {regime?.ibsCbsRegularOption && (
          <Checkbox
            label="Apura o IBS e a CBS pelo regime regular"
            checked={v.ibsCbsRegular}
            onChange={(ibsCbsRegular) => setV({ ...v, ibsCbsRegular })}
            hint="Só se a empresa fez essa opção no Simples Nacional (LC 123/2006, art. 13, §§ 9º e 10). Ela vale por semestre (de janeiro ou de julho), é feita em setembro ou março e não pode ser desfeita no meio do semestre. Sem ela, o IBS e a CBS vão no DAS."
          />
        )}
        <TextField
          label="CNAE principal"
          inputMode="numeric"
          placeholder="0000-0/00"
          value={v.cnae}
          onChange={(e) => setV({ ...v, cnae: formatCnae(e.target.value) })}
          hint={
            netLoad?.regime
              ? `ST com carga líquida do ${netLoad.regime.act} (${netLoad.regime.segmentName.toLowerCase()}): a compra calcula a ST de entrada pela classe da mercadoria de cada produto.`
              : 'A atividade principal do cartão do CNPJ. No Ceará, ela decide a ST com carga líquida.'
          }
        />
        {netLoad?.regime && (
          <Checkbox
            label="Tem Regime Especial de Tributação (RET) com a SEFAZ"
            checked={v.stSpecialRegime}
            onChange={(stSpecialRegime) => setV({ ...v, stSpecialRegime })}
            hint="Com RET, a carga sai do decreto quando ele traz (Anexo III ou a tabela dos farmacêuticos); quando não traz, vem do termo do regime e a compra mostra 'falta configurar'."
          />
        )}
        {netLoad?.choices?.transferMargin && (
          <SelectField
            label="Margem na transferência recebida"
            value={v.transferMargin}
            onChange={(e) =>
              setV({ ...v, transferMargin: e.target.value as typeof v.transferMargin })
            }
            options={[
              { value: '', label: 'Ainda não escolhi' },
              {
                value: 'replace',
                label: `${formatRate(netLoad.choices.transferMargin.transferMva)} no lugar da margem do caput`,
              },
              {
                value: 'compound',
                label: `Margem do caput (${formatRate(netLoad.choices.transferMargin.caputMva)}) e mais ${formatRate(netLoad.choices.transferMargin.transferMva)} sobre ela`,
              },
            ]}
            hint={`O ${netLoad.choices.act} diz que a base da transferência${netLoad.choices.transferMargin.interstateOnly ? ' vinda de outra UF' : ''} é "a definida no caput, acrescida de ${formatRate(netLoad.choices.transferMargin.transferMva)}", e o caput já tem margem. A SEFAZ-CE não publicou a conta: escolha com o contador. Sem escolha, a compra mostra "falta configurar".`}
          />
        )}
        {netLoad?.choices?.industryLoad && (
          <SelectField
            label="Carga da retenção da indústria"
            value={v.industryLoad}
            onChange={(e) => setV({ ...v, industryLoad: e.target.value as typeof v.industryLoad })}
            options={[
              { value: '', label: 'Ainda não escolhi' },
              {
                value: 'standard',
                label: `${netLoad.choices.industryLoad.standardArticle}: ${formatRate(netLoad.choices.industryLoad.standardLoad)}`,
              },
              {
                value: 'optional',
                label: `${netLoad.choices.industryLoad.article}: ${formatRate(netLoad.choices.industryLoad.load)}`,
              },
            ]}
            hint={`A CNAE desta empresa "poderá reter" pela carga do ${netLoad.choices.industryLoad.article} do ${netLoad.choices.act}, no lugar da do ${netLoad.choices.industryLoad.standardArticle}. Sem escolha, a nota de venda mostra "falta configurar".`}
          />
        )}
        {netLoad?.choices?.distributionCenter && v.stSpecialRegime && (
          <Checkbox
            label="Centro de distribuição que transferiu 50% das compras para outras UFs"
            checked={v.distributionCenter}
            onChange={(distributionCenter) => setV({ ...v, distributionCenter })}
            hint={`Só se a empresa comprovou à SEFAZ (${netLoad.choices.distributionCenter.article} do ${netLoad.choices.act}) que, no ano anterior, transferiu ao menos 50% do que comprou para estabelecimentos dela em outras UFs. Muda a carga da entrada.`}
          />
        )}
        <fieldset className="flex flex-col gap-4 rounded-ui border border-border p-4">
          <legend className="px-1 font-semibold">Dados para a nota fiscal (NFC-e)</legend>
          <TextField
            label="Inscrição estadual"
            inputMode="numeric"
            value={v.ie}
            onChange={(e) => setV({ ...v, ie: e.target.value })}
          />
          <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <TextField
              label="Rua"
              value={v.street}
              onChange={(e) => setV({ ...v, street: e.target.value })}
            />
            <TextField
              label="Número"
              value={v.streetNumber}
              onChange={(e) => setV({ ...v, streetNumber: e.target.value })}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Complemento (opcional)"
              value={v.complement}
              onChange={(e) => setV({ ...v, complement: e.target.value })}
            />
            <TextField
              label="Bairro"
              value={v.district}
              onChange={(e) => setV({ ...v, district: e.target.value })}
            />
          </div>
          <CityPicker
            uf={v.uf}
            value={v.cityCode}
            onChange={(cityCode) => setV({ ...v, cityCode })}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="CEP"
              inputMode="numeric"
              value={v.cep}
              onChange={(e) => setV({ ...v, cep: e.target.value })}
            />
            <TextField
              label="Telefone (opcional)"
              inputMode="tel"
              value={v.phone}
              onChange={(e) => setV({ ...v, phone: e.target.value })}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <p className="text-sm text-muted">
              Pix sai na nota como Pix estático (código 20): o caixa ainda não gera QR Code
              dinâmico, que depende da integração com um banco (PSP).
            </p>
            <SelectField
              label="Vale na nota"
              value={v.voucher}
              onChange={(e) => setV({ ...v, voucher: e.target.value })}
              options={[
                { value: '10', label: 'Vale alimentação' },
                { value: '11', label: 'Vale refeição' },
                { value: '12', label: 'Vale presente' },
                { value: '13', label: 'Vale combustível' },
              ]}
            />
          </div>
        </fieldset>
        <fieldset className="flex flex-col gap-3">
          <legend className="font-semibold">Venda condicional pela NF-e</legend>
          <p className="text-sm text-muted">
            Com um perfil escolhido, as notas do Ajuste SINIEF 02/18 saem pelo Bipaê: a remessa para
            demonstração junto com as peças e, na volta, o retorno e a entrada simbólica. O imposto
            fica suspenso. O Ajuste não diz o CSOSN, o CST do PIS/COFINS nem a classificação do
            IBS/CBS dessas notas, por isso o perfil é escolhido pela empresa, com o contador. No
            regime normal, o perfil precisa do CST 50 (suspensão).
          </p>
          <SelectField
            label="Perfil fiscal da venda condicional"
            value={v.demonstrationProfileId}
            onChange={(e) => setV({ ...v, demonstrationProfileId: e.target.value })}
            options={[
              { value: '', label: 'Não emitir as notas pelo Bipaê' },
              ...(profiles.data ?? []).map((f) => ({ value: f.id, label: f.name })),
            ]}
          />
        </fieldset>
        <fieldset className="flex flex-col gap-3">
          <legend className="font-semibold">NFS-e Nacional (serviços)</legend>
          <p className="text-sm text-muted">
            Para a nota dos serviços das ordens de serviço. A nota mostra quanto de imposto há no
            preço (Lei 12.741/2012); os campos abaixo mudam conforme o regime escolhido acima.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Inscrição municipal"
              value={v.municipalRegistration}
              onChange={(e) => setV({ ...v, municipalRegistration: e.target.value })}
            />
            <TextField
              label="Série da NFS-e"
              hint="De 1 a 49999 (emissão pelo Bipaê)."
              inputMode="numeric"
              value={v.nfseSeries}
              onChange={(e) => setV({ ...v, nfseSeries: e.target.value.replace(/\D/g, '') })}
            />
            {simplesRegime && (
              <>
                <PercentField
                  label="Percentual aproximado do Simples (%)"
                  hint="A alíquota efetiva do seu Simples. Ex.: 6 ou 6,54."
                  value={v.nfseSimplesPercent}
                  onChange={(p) => setV({ ...v, nfseSimplesPercent: p })}
                />
                <SimplesRateHelper onUse={(p) => setV({ ...v, nfseSimplesPercent: p })} />
              </>
            )}
            {otherRegime && (
              <>
                <PercentField
                  label="Tributos federais aproximados (%)"
                  hint="PIS, COFINS, IRPJ e CSLL sobre o serviço. Ex.: 11,33."
                  value={v.nfseTaxFederal}
                  onChange={(p) => setV({ ...v, nfseTaxFederal: p })}
                />
                <PercentField
                  label="Tributos estaduais aproximados (%)"
                  hint="Em serviço, quase sempre 0."
                  value={v.nfseTaxState}
                  onChange={(p) => setV({ ...v, nfseTaxState: p })}
                />
                <PercentField
                  label="Tributos municipais aproximados (%)"
                  hint="O ISS do seu município. Ex.: 5."
                  value={v.nfseTaxMunicipal}
                  onChange={(p) => setV({ ...v, nfseTaxMunicipal: p })}
                />
              </>
            )}
          </div>
          {v.taxRegime === 'mei' && (
            <p className="text-sm text-muted">O MEI não informa o percentual dos tributos.</p>
          )}
          {!v.taxRegime && (
            <p className="text-sm text-muted">
              Escolha o regime tributário acima para ver os percentuais pedidos.
            </p>
          )}
        </fieldset>
        <Button type="submit">Salvar empresa</Button>
      </form>
    </Drawer>
  );
}

/** Município da tabela do IBGE, buscado dentro da UF da empresa (F3-14). */
export function CityPicker({
  uf,
  value,
  onChange,
}: {
  uf: string;
  value: string;
  onChange: (code: string) => void;
}) {
  const { api } = useApp();
  const [search, setSearch] = useState('');
  const current = useQuery({
    queryKey: ['municipio', value],
    queryFn: () =>
      api.get<{ code: string; name: string; uf: string }>(`/fiscal/municipios/${value}`),
    enabled: /^\d{7}$/.test(value),
  });
  const found = useQuery({
    queryKey: ['municipios', uf, search],
    queryFn: () =>
      api.get<{ code: string; name: string }[]>(
        `/fiscal/municipios?uf=${uf}&q=${encodeURIComponent(search.trim())}`,
      ),
    enabled: Boolean(uf) && search.trim().length >= 2,
  });
  if (!uf) return <p className="text-sm text-muted">Escolha a UF para informar o município.</p>;
  return (
    <div className="flex flex-col gap-2">
      <TextField
        label="Município"
        placeholder="Digite o nome da cidade"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        hint={
          current.data
            ? `Escolhido: ${current.data.name} - ${current.data.uf} (IBGE ${current.data.code})`
            : 'Busca na tabela oficial do IBGE.'
        }
      />
      {found.data && search.trim().length >= 2 && (
        <ul className="rounded-ui border border-border" aria-label="Municípios encontrados">
          {found.data.length === 0 && <li className="p-3 text-muted">Nenhum município.</li>}
          {found.data.map((m) => (
            <li key={m.code}>
              <button
                type="button"
                className="w-full p-3 text-left hover:bg-surface-2"
                onClick={() => {
                  onChange(m.code);
                  setSearch('');
                }}
              >
                {m.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StoreForm({
  company,
  store,
  tables = [],
  onClose,
  onSaved,
}: {
  company: Company;
  store?: StoreRow;
  tables?: PriceTable[];
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}) {
  const { api } = useApp();
  const [name, setName] = useState(store?.name ?? '');
  const [priceTableId, setPriceTableId] = useState(store?.priceTableId ?? '');
  const [error, setError] = useState<string | null>(null);
  return (
    <Drawer
      open
      onOpenChange={(o) => !o && onClose()}
      title={
        store
          ? `Editar loja ${store.name}`
          : `Nova loja em ${company.tradeName ?? company.legalName}`
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            if (store)
              await api.patch(`/stores/${store.id}`, { name, priceTableId: priceTableId || null });
            else await api.post('/stores', { companyId: company.id, name });
            await onSaved();
            onClose();
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        {error && <Alert>{error}</Alert>}
        <TextField
          label="Nome da loja"
          placeholder="Ex.: Loja Centro"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        {store && (
          <SelectField
            label="Tabela de preço da loja"
            hint="Os caixas desta loja usam estes preços. Clientes com tabela própria usam a deles."
            value={priceTableId}
            onChange={(e) => setPriceTableId(e.target.value)}
            options={[
              { value: '', label: 'Preço do cadastro do produto' },
              ...tables.map((t) => ({ value: t.id, label: t.name })),
            ]}
          />
        )}
        <Button type="submit">{store ? 'Salvar loja' : 'Criar loja'}</Button>
      </form>
    </Drawer>
  );
}

interface CompanyRevenue {
  year: number;
  yearRevenueCents: number;
  alerts: { level: 'info' | 'warning' | 'critical'; message: string }[];
  note: string;
}

const ALERT_TONE = { info: 'warning', warning: 'warning', critical: 'danger' } as const;

/** Avisos dos limites do regime pela receita do ano (F3-29): MEI, teto e sublimite do Simples. */
function RevenueAlerts({ companyId }: { companyId: string }) {
  const { api } = useApp();
  const revenue = useQuery({
    queryKey: ['companies', companyId, 'revenue'],
    queryFn: () => api.get<CompanyRevenue>(`/companies/${companyId}/revenue`),
    staleTime: 10 * 60_000,
    retry: false,
  });
  if (!revenue.data || revenue.data.alerts.length === 0) return null;
  return (
    <div className="mt-2 flex flex-col gap-2">
      {revenue.data.alerts.map((alert) => (
        <Alert key={alert.message} tone={ALERT_TONE[alert.level]} title="Limite do regime">
          {alert.message} <span className="text-sm text-muted">{revenue.data.note}</span>
        </Alert>
      ))}
    </div>
  );
}
