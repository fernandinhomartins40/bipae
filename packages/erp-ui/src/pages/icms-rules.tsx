import type { CompanyIcmsRuleRow } from '@bipae/domain';
import {
  Alert,
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
      {editing && companyId && (
        <RuleForm
          companyId={companyId}
          rule={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function RuleForm({
  companyId,
  rule,
  onClose,
}: {
  companyId: string;
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
