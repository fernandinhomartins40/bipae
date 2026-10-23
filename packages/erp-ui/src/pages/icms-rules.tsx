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
    effect.benefitCode && `cBenef ${effect.benefitCode}`,
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
    benefitCode: e?.benefitCode ?? '',
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
        benefitCode: v.benefitCode || null,
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
        {uf && (
          <NetLoadReference
            uf={uf}
            ncm={form.values.ncm.split(/[,\s]+/).filter(Boolean)[0] ?? ''}
            date={form.values.validFrom}
          />
        )}
        <TextField
          label="Código de benefício fiscal (cBenef, opcional)"
          hint="O código que a SEFAZ da UF dá para a isenção ou redução, como PR810001. Vai em cada item da nota; algumas UFs recusam a nota sem ele."
          value={form.values.benefitCode}
          onChange={text('benefitCode')}
          error={form.errors.benefitCode}
        />
        {uf && form.values.benefitCode.trim().length >= 8 && (
          <CbenefInfo uf={uf} code={form.values.benefitCode} date={form.values.validFrom} />
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

// Linha da tabela oficial sem CEST (no Maranhão, a MVA por embalagem que o CEST não separa).
const cestText = (cest: string) =>
  cest ? cest.replace(/^(\d{2})(\d{3})(\d{2})$/, '$1.$2.$3') : 'não confirmado';
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
          <li
            key={`${m.cest}-${m.item}`}
            className="flex flex-wrap items-center justify-between gap-2"
          >
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

type NetLoadOriginKey = 'internal' | 'n-ne-co-es' | 's-se-except-es';

interface NetLoadRegimeView {
  act: string;
  law: string;
  url: string;
  segmentName: string;
  cestSegments: string[] | null;
  mva: string | null;
  groups: { group: string; label: string }[];
  buyers: { cnae: string; description: string; group: string }[];
  version: {
    validFrom: string;
    amendedBy: string | null;
    loads: {
      group: string;
      goodsClass: string;
      label: string;
      percents: Partial<Record<NetLoadOriginKey, string>>;
    }[];
  };
}

const cnaeText = (cnae: string) => cnae.replace(/^(\d{4})(\d)(\d{2})$/, '$1-$2/$3');
const pctText = (value: string | undefined) => (value ? `${value.replace('.', ',')}%` : '—');

/**
 * Carga líquida pela CNAE do comprador (F3-26.d.CE.b): no Ceará, vários segmentos recolhem a ST
 * como um percentual sobre a nota de entrada, e não por MVA. Fica como referência: a regra de
 * ICMS da empresa não calcula a ST desse jeito (falta configurar).
 */
function NetLoadReference({ uf, ncm, date }: { uf: string; ncm: string; date: string }) {
  const { api } = useApp();
  const code = ncm.replace(/\D/g, '');
  const found = useQuery({
    queryKey: ['st-net-loads', uf, code, date],
    queryFn: () =>
      api.get<{
        uf: string;
        covered: boolean;
        origins: { key: NetLoadOriginKey; label: string }[];
        regimes: NetLoadRegimeView[];
      }>(
        `/fiscal/st-net-loads?uf=${uf}${code.length === 8 ? `&ncm=${code}` : ''}${date ? `&date=${date}` : ''}`,
      ),
    enabled: code.length >= 4,
  });
  if (code.length < 4 || !found.data || found.data.regimes.length === 0) return null;
  const { origins, regimes } = found.data;
  return (
    <section className="rounded-ui border border-border p-3 text-sm" aria-label="Carga líquida">
      <p className="font-semibold">{`Carga líquida em ${uf}, pela CNAE de quem compra`}</p>
      <p className="mt-1 text-muted">
        {`Em ${uf}, a loja cuja CNAE principal está no decreto do segmento recolhe a ST como um percentual sobre o valor da nota de entrada (com a margem, quando o decreto manda), e não por MVA. O Bipaê mostra as tabelas oficiais; o cálculo da ST por carga líquida na nota ainda falta configurar.`}
      </p>
      <div className="mt-2 flex flex-col gap-2">
        {regimes.map((r) => (
          <details key={r.act} className="rounded-ui border border-border p-2">
            <summary className="cursor-pointer font-semibold">
              {`${r.segmentName} · ${r.act}`}
            </summary>
            <p className="mt-2 text-muted">
              {[
                r.cestSegments && `Mercadorias do segmento ${r.cestSegments.join(', ')} do CEST.`,
                r.mva
                  ? `Base: valor da nota + ${pctText(r.mva)} de margem.`
                  : 'Base: valor da nota, sem margem.',
                `Tabela desde ${day(r.version.validFrom)}${r.version.amendedBy ? ` (${r.version.amendedBy})` : ''}.`,
                `${r.law}.`,
              ]
                .filter(Boolean)
                .join(' ')}{' '}
              <a href={r.url} target="_blank" rel="noreferrer" className="underline">
                Ver o decreto
              </a>
            </p>
            {r.groups.map((g) => {
              const rows = r.version.loads.filter((l) => l.group === g.group);
              const cnaes = r.buyers.filter((b) => b.group === g.group);
              return (
                <div key={g.group} className="mt-2">
                  <p className="font-semibold">{g.label}</p>
                  <p className="text-muted">
                    {cnaes.map((b) => `${cnaeText(b.cnae)} ${b.description}`).join(' · ')}
                  </p>
                  {rows.length > 0 ? (
                    <div className="mt-1 overflow-x-auto">
                      <table className="w-full text-left">
                        <thead>
                          <tr>
                            <th scope="col" className="pr-2">
                              Mercadoria
                            </th>
                            {origins.map((o) => (
                              <th key={o.key} scope="col" className="pr-2">
                                {o.label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((l) => (
                            <tr key={l.goodsClass}>
                              <td className="pr-2">{l.label}</td>
                              {origins.map((o) => (
                                <td key={o.key} className="pr-2">
                                  {pctText(l.percents[o.key])}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-muted">
                      Regime normal na entrada (a indústria retém nas saídas internas, pelo art. 2º
                      do decreto).
                    </p>
                  )}
                </div>
              );
            })}
          </details>
        ))}
      </div>
    </section>
  );
}

interface CbenefAnswer {
  uf: string;
  covered: boolean;
  /** A fonte oficial diz que a UF não usa a tabela cBenef (F3-27.c). */
  notUsed: { act: string; url: string } | null;
  valid: boolean;
  entry: {
    code: string;
    csts: string[];
    from: string | null;
    to: string | null;
    description: string;
    act: string;
    kind?: string;
  } | null;
}

/** O que a tabela oficial de cBenef da UF diz do código digitado (F3-27.b). */
function CbenefInfo({ uf, code, date }: { uf: string; code: string; date: string }) {
  const { api } = useApp();
  const wanted = code.trim().toUpperCase();
  const found = useQuery({
    queryKey: ['cbenef', uf, wanted, date],
    queryFn: () =>
      api.get<CbenefAnswer>(
        `/fiscal/cbenef?uf=${uf}&code=${encodeURIComponent(wanted)}${date ? `&date=${date}` : ''}`,
      ),
    // SEM CBENEF também é consultado: algumas UFs deixaram de aceitá-lo (SP, a partir de 01/07/2026).
    enabled: wanted.length >= 8,
  });
  if (!found.data) return null;
  const { covered, notUsed, entry, valid } = found.data;
  if (!covered && notUsed) {
    return (
      <Alert tone="warning" title={`${uf} não usa a tabela cBenef`}>
        {`Segundo a fonte oficial (${notUsed.act}), ${uf} não usa códigos de benefício. Confira com o contador antes de enviar o código na nota.`}
      </Alert>
    );
  }
  if (!covered) {
    return (
      <p className="text-sm text-muted">
        {`A tabela oficial de cBenef de ${uf} ainda não está no Bipaê: confira o código na SEFAZ.`}
      </p>
    );
  }
  if (!entry) {
    return (
      <Alert tone="warning" title={`Código fora da tabela de ${uf}`}>
        {`${wanted} não está na tabela oficial de códigos de benefício de ${uf}. Confira o código com o contador.`}
      </Alert>
    );
  }
  if (/cr[ée]dito presumido/i.test(entry.kind ?? '')) {
    return (
      <Alert tone="warning" title="Código de crédito presumido">
        {`${entry.code} é de crédito presumido: vai no campo cCredPresumido da nota, não no cBenef. ${entry.description}`}
      </Alert>
    );
  }
  const csts = entry.csts.map((c) => `CST ${c}`).join(', ');
  if (!valid) {
    return (
      <Alert tone="warning" title="Código fora da vigência">
        {`${entry.code}: ${entry.description}. ${entry.to ? `Encerrado em ${toDate(entry.to)}` : `Vale a partir de ${toDate(entry.from!)}`} (${entry.act}).`}
      </Alert>
    );
  }
  return (
    <section
      className="rounded-ui border border-border p-3 text-sm"
      aria-label="Código de benefício"
    >
      <p className="font-semibold">{`${entry.code}: ${entry.description}`}</p>
      <p className="mt-1 text-muted">
        {`Vale para ${csts}${entry.from ? ` desde ${toDate(entry.from)}` : ''} (${entry.act}). O CST do produto precisa ser um desses.`}
      </p>
    </section>
  );
}
