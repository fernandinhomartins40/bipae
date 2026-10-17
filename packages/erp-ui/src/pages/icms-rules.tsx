import type { CompanyIcmsRuleRow } from '@bipae/domain';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Drawer,
  EmptyState,
  PageHeader,
  SelectField,
  TextField,
} from '@bipae/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useApp, useCan } from '../context';
import { useForm } from '../forms';
import { formatRate } from './fiscal-lookup';

/**
 * Regras de ICMS da empresa (F3-06.e): o que a alíquota geral da UF não cobre, por NCM e com
 * vigência. O caixa usa as regras no cálculo de cada venda, mesmo sem internet.
 */
interface Company {
  id: string;
  legalName: string;
  tradeName: string | null;
  uf: string | null;
}

const toDate = (iso: string) => iso.split('-').reverse().join('/');
const pct = (value: string | undefined) => (value ? formatRate(value) : null);

function describeEffect(effect: CompanyIcmsRuleRow['effect']): string {
  return [
    pct(effect.rate) && `Alíquota ${pct(effect.rate)}`,
    pct(effect.baseReduction) && `Redução da base ${pct(effect.baseReduction)}`,
    pct(effect.fcpRate) && `FCP ${pct(effect.fcpRate)}`,
    effect.st && `ST com MVA ${pct(effect.st.mva)} e alíquota ${pct(effect.st.rate)}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function IcmsRulesPage() {
  const { api } = useApp();
  const canWrite = useCan('fiscal.profile.write');
  const companies = useQuery({
    queryKey: ['companies'],
    queryFn: () => api.get<Company[]>('/companies'),
  });
  const [chosen, setChosen] = useState<string | null>(null);
  const companyId = chosen ?? companies.data?.[0]?.id ?? null;
  const company = companies.data?.find((c) => c.id === companyId);
  const rules = useQuery({
    queryKey: ['icms-rules', companyId],
    queryFn: () => api.get<CompanyIcmsRuleRow[]>(`/fiscal/icms-rules?companyId=${companyId}`),
    enabled: companyId !== null,
  });
  const [editing, setEditing] = useState<CompanyIcmsRuleRow | 'new' | null>(null);

  return (
    <>
      <PageHeader
        title="Regras de ICMS"
        description="Alíquota própria de produtos, redução de base, FCP e substituição tributária, por NCM."
        actions={
          canWrite &&
          companyId && (
            <Button
              icon={<Plus className="size-5" aria-hidden />}
              onClick={() => setEditing('new')}
            >
              Nova regra
            </Button>
          )
        }
      />
      <div className="mb-4 flex flex-col gap-3">
        <Alert tone="warning" title="Sem regra, vale a alíquota geral da UF">
          Cadastre aqui os produtos que pagam ICMS diferente da alíquota geral do seu estado (por
          exemplo, cesta básica ou bebidas), sempre com a orientação do seu contador. Vale a regra
          mais específica para o NCM.
        </Alert>
        {companies.data && companies.data.length > 1 && (
          <SelectField
            label="Empresa"
            value={companyId ?? ''}
            onChange={(e) => setChosen(e.target.value)}
            options={companies.data.map((c) => ({
              value: c.id,
              label: c.tradeName ?? c.legalName,
            }))}
          />
        )}
      </div>
      {rules.error && <Alert>{(rules.error as Error).message}</Alert>}
      {rules.data &&
        (rules.data.length === 0 ? (
          <EmptyState title="Nenhuma regra de ICMS ainda">
            {company?.uf
              ? `Todos os produtos usam a alíquota geral de ${company.uf}.`
              : 'Informe a UF da empresa em Empresas e lojas.'}
          </EmptyState>
        ) : (
          <DataTable
            caption="Regras de ICMS"
            rows={rules.data}
            onRowClick={canWrite ? setEditing : undefined}
            columns={[
              { header: 'Nome', cell: (r) => <span className="font-semibold">{r.name}</span> },
              { header: 'NCM', cell: (r) => r.ncm.join(', ') },
              { header: 'O que muda', cell: (r) => describeEffect(r.effect) },
              {
                header: 'Vigência',
                cell: (r) =>
                  r.validTo
                    ? `${toDate(r.validFrom)} até ${toDate(r.validTo)}`
                    : `Desde ${toDate(r.validFrom)}`,
              },
            ]}
          />
        ))}
      {company?.uf && <PortalReference uf={company.uf} />}
      {editing && companyId && (
        <RuleForm
          companyId={companyId}
          uf={company?.uf ?? null}
          rule={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function RuleForm({
  companyId,
  uf,
  rule,
  onClose,
}: {
  companyId: string;
  uf: string | null;
  rule: CompanyIcmsRuleRow | null;
  onClose: () => void;
}) {
  const { api } = useApp();
  const queryClient = useQueryClient();
  const e = rule?.effect;
  const form = useForm({
    name: rule?.name ?? '',
    ncm: rule?.ncm.join(', ') ?? '',
    validFrom: rule?.validFrom ?? new Date().toISOString().slice(0, 10),
    validTo: rule?.validTo ?? '',
    rate: e?.rate ?? '',
    baseReduction: e?.baseReduction ?? '',
    fcpRate: e?.fcpRate ?? '',
    stMva: e?.st?.mva ?? '',
    stRate: e?.st?.rate ?? '',
    source: rule?.source ?? '',
  });
  const reload = () => queryClient.invalidateQueries({ queryKey: ['icms-rules'] });
  const text = (key: keyof typeof form.values) => (ev: { target: { value: string } }) =>
    form.set(key, ev.target.value);

  const onSubmit = (ev: FormEvent) => {
    ev.preventDefault();
    void form.submit(async (v) => {
      const body = {
        companyId,
        name: v.name,
        ncm: v.ncm.split(/[,\s]+/).filter(Boolean),
        validFrom: v.validFrom,
        validTo: v.validTo || null,
        rate: v.rate || null,
        baseReduction: v.baseReduction || null,
        fcpRate: v.fcpRate || null,
        st: v.stMva || v.stRate ? { mva: v.stMva, rate: v.stRate } : null,
        source: v.source,
      };
      if (rule) await api.put(`/fiscal/icms-rules/${rule.id}`, body);
      else await api.post('/fiscal/icms-rules', body);
      await reload();
      onClose();
    });
  };
  const remove = () =>
    void form.submit(async () => {
      await api.delete(`/fiscal/icms-rules/${rule!.id}`);
      await reload();
      onClose();
    });

  return (
    <Drawer
      open
      onOpenChange={(open) => !open && onClose()}
      title={rule ? 'Editar regra de ICMS' : 'Nova regra de ICMS'}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {form.formError && <Alert>{form.formError}</Alert>}
        <TextField
          label="Nome da regra"
          placeholder="Ex.: Cervejas"
          value={form.values.name}
          onChange={text('name')}
          error={form.errors.name}
          autoFocus
        />
        <TextField
          label="NCM"
          hint="Um ou mais, separados por vírgula. Pode ser só o começo do código: 2203 vale para todas as cervejas de malte."
          value={form.values.ncm}
          onChange={text('ncm')}
          error={form.errors.ncm ?? form.errors['ncm.0']}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Alíquota do ICMS (%)"
            inputMode="decimal"
            value={form.values.rate}
            onChange={text('rate')}
            error={form.errors.rate}
          />
          <TextField
            label="Redução da base (%)"
            inputMode="decimal"
            value={form.values.baseReduction}
            onChange={text('baseReduction')}
            error={form.errors.baseReduction}
          />
          <TextField
            label="FCP (%)"
            inputMode="decimal"
            value={form.values.fcpRate}
            onChange={text('fcpRate')}
            error={form.errors.fcpRate}
          />
        </div>
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-2 font-semibold">Substituição tributária (opcional)</legend>
          <TextField
            label="MVA (%)"
            inputMode="decimal"
            value={form.values.stMva}
            onChange={text('stMva')}
            error={form.errors['st.mva']}
          />
          <TextField
            label="Alíquota da ST (%)"
            inputMode="decimal"
            value={form.values.stRate}
            onChange={text('stRate')}
            error={form.errors['st.rate']}
          />
        </fieldset>
        {uf && (
          <StSuggestion
            uf={uf}
            ncm={form.values.ncm.split(/[,\s]+/).filter(Boolean)[0] ?? ''}
            date={form.values.validFrom}
            onUse={(m) => {
              form.set('stMva', m.mva);
              form.set(
                'source',
                `${m.act}, CEST ${cestText(m.cest)}: IVA-ST de ${m.mva.replace('.', ',')}%`,
              );
            }}
          />
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Vale a partir de"
            type="date"
            value={form.values.validFrom}
            onChange={text('validFrom')}
            error={form.errors.validFrom}
          />
          <TextField
            label="Deixa de valer em (opcional)"
            type="date"
            value={form.values.validTo}
            onChange={text('validTo')}
            error={form.errors.validTo}
          />
        </div>
        <TextField
          label="Fonte"
          placeholder="Ex.: RICMS/SP, art. 54 · orientação do contador"
          value={form.values.source}
          onChange={text('source')}
          error={form.errors.source}
        />
        <div className="flex flex-wrap gap-2 pt-2">
          <Button type="submit" loading={form.submitting}>
            Salvar regra
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          {rule && (
            <Button variant="ghost" onClick={remove}>
              Excluir regra
            </Button>
          )}
        </div>
      </form>
    </Drawer>
  );
}

interface PortalLine {
  description: string;
  general: boolean;
  ncmText?: string;
  rateText: string;
  fcpText?: string;
  note: string;
  updatedAt: string | null;
  stale: boolean;
}

interface PortalRates {
  uf: string;
  portalGeneralRate: string | null;
  confirmedGeneralRate: string | null;
  generalMatches: boolean | null;
  items: PortalLine[];
  source: { page: string; downloadedAt: string };
}

/**
 * Referência do Portal Nacional da DIFAL (F3-25): as alíquotas por mercadoria que a SEFAZ da UF
 * publica, com a data de cada linha. Ajuda o contador a cadastrar as regras; não muda o cálculo.
 */
function PortalReference({ uf }: { uf: string }) {
  const { api } = useApp();
  const portal = useQuery({
    queryKey: ['icms-products', uf],
    queryFn: () => api.get<PortalRates>(`/fiscal/icms-products?uf=${uf}`),
  });
  const [filter, setFilter] = useState('');
  if (!portal.data) return null;
  const p = portal.data;
  const term = filter.trim().toLowerCase();
  const lines = p.items
    .map((line, index) => ({ ...line, id: String(index) }))
    .filter((l) => !term || `${l.description} ${l.ncmText ?? ''}`.toLowerCase().includes(term));
  return (
    <section className="mt-8 flex flex-col gap-3" aria-labelledby="portal-difal">
      <h2 id="portal-difal" className="text-xl font-bold">
        Referência: alíquotas por produto de {uf} no Portal da DIFAL
      </h2>
      <p className="text-sm text-muted">
        Publicado pelas SEFAZ e conferido em {toDate(p.source.downloadedAt)}. Serve de ponto de
        partida para o contador: só vira regra o que você cadastrar acima.
      </p>
      {p.generalMatches === false && (
        <Alert tone="warning" title={`O portal está desatualizado para ${uf}`}>
          A alíquota geral no portal é {formatRate(p.portalGeneralRate!)}, mas a lei vigente diz{' '}
          {formatRate(p.confirmedGeneralRate!)}. As linhas marcadas como defasadas são de antes da
          mudança: confira cada uma na legislação da UF.
        </Alert>
      )}
      <TextField
        label="Procurar no portal"
        placeholder="Mercadoria ou NCM"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <DataTable
        caption={`Alíquotas por produto de ${uf} no Portal da DIFAL`}
        rows={lines}
        columns={[
          {
            header: 'Mercadoria',
            cell: (l) => (
              <span>
                {l.description}
                {l.general && (
                  <>
                    {' '}
                    <Badge>Geral</Badge>
                  </>
                )}
                {l.stale && (
                  <>
                    {' '}
                    <Badge tone="warning">Defasada</Badge>
                  </>
                )}
              </span>
            ),
          },
          { header: 'NCM', cell: (l) => l.ncmText ?? '—' },
          { header: 'Alíquota', cell: (l) => l.rateText || '—' },
          { header: 'FCP', cell: (l) => l.fcpText ?? '—' },
          {
            header: 'Atualizado em',
            cell: (l) => (l.updatedAt ? toDate(l.updatedAt) : 'sem data'),
          },
        ]}
      />
    </section>
  );
}

const cestText = (cest: string) => cest.replace(/^(\d{2})(\d{3})(\d{2})$/, '$1.$2.$3');
const day = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '');

interface StStatus {
  annex: string;
  segmentName: string;
  cest: string;
  inSt: boolean;
  excludedFrom: string | null;
  excludedBy: string | null;
  base: { kind: 'pauta'; act: string; validFrom: string; validTo: string; note: string } | null;
}

interface StMatch {
  item: string;
  cest: string;
  ncmText: string;
  description: string;
  mva: string;
  act: string;
  url: string;
  note: string;
}

/**
 * MVA oficial da UF para o NCM (F3-26): o que a SEFAZ publicou, para a empresa conferir o
 * produto (a descrição do CEST tem limites de embalagem e exceções) e usar com um clique.
 */
function StSuggestion({
  uf,
  ncm,
  date,
  onUse,
}: {
  uf: string;
  ncm: string;
  date: string;
  onUse: (m: StMatch) => void;
}) {
  const { api } = useApp();
  const code = ncm.replace(/\D/g, '');
  const found = useQuery({
    queryKey: ['st-references', uf, code, date],
    queryFn: () =>
      api.get<{
        uf: string;
        covered: boolean;
        items: StMatch[];
        listed: boolean;
        status: StStatus[];
      }>(`/fiscal/st-references?uf=${uf}&ncm=${code}${date ? `&date=${date}` : ''}`),
    enabled: code.length >= 4,
  });
  if (code.length < 4 || !found.data) return null;
  const { items, status, listed, covered } = found.data;
  if (items.length === 0) {
    const inSt = status.filter((s) => s.inSt);
    const out = status.filter((s) => !s.inSt);
    if (status.length > 0 && inSt.length === 0) {
      const first = out[0]!;
      return (
        <Alert tone="warning" title={`Saiu da substituição tributária em ${uf}`}>
          {`${first.segmentName} (CEST ${cestText(first.cest)}) saiu da ST em ${day(first.excludedFrom)} (${first.excludedBy ?? 'legislação da SEFAZ'}). O ICMS deste produto passa a ser cobrado normalmente, sem ST.`}
        </Alert>
      );
    }
    const pauta = inSt.find((x) => x.base?.kind === 'pauta');
    if (pauta?.base) {
      return (
        <Alert tone="warning" title={`Base da ST pela pauta em ${uf}`}>
          {`${pauta.segmentName}, de ${day(pauta.base.validFrom)} a ${day(pauta.base.validTo)} (${pauta.base.act}). ${pauta.base.note} O cálculo da ST por pauta chega em breve no Bipaê; até lá, confira o valor da pauta na SEFAZ.`}
        </Alert>
      );
    }
    if (inSt.length > 0) {
      return (
        <p className="text-sm text-muted">
          {`Este NCM está na ST em ${uf} (${inSt[0]!.segmentName}), mas a MVA dele não está nos atos que o Bipaê tem. Confira na legislação da SEFAZ.`}
        </p>
      );
    }
    return (
      <p className="text-sm text-muted">
        {listed
          ? `Este NCM não está na lista de mercadorias em ST de ${uf}.`
          : covered
            ? `Na tabela oficial de ${uf} que o Bipaê tem, este NCM não aparece com MVA nesta data.`
            : `A tabela oficial de ST de ${uf} ainda não está no Bipaê: confira na legislação da SEFAZ.`}
      </p>
    );
  }
  return (
    <section className="rounded-ui border border-border p-3 text-sm" aria-label="MVA oficial">
      <p className="mb-2 font-semibold">MVA publicada pela SEFAZ de {uf} para este NCM</p>
      <ul className="flex flex-col gap-2">
        {items.slice(0, 5).map((m) => (
          <li key={m.cest} className="flex flex-wrap items-center justify-between gap-2">
            <span>
              <span className="font-semibold">MVA {m.mva.replace('.', ',')}%</span> · CEST{' '}
              {cestText(m.cest)} · {m.description}
            </span>
            <Button variant="secondary" onClick={() => onUse(m)}>
              {`Usar ${m.mva.replace('.', ',')}%`}
            </Button>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-muted">
        {items[0]!.act}. {items[0]!.note} Confira se o produto é o da descrição antes de usar.
      </p>
    </section>
  );
}
