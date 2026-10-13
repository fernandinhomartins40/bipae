import { ICMS_ORIGINS, type FiscalProfile } from '@bipae/domain';
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

/**
 * Perfis fiscais (F1-02): o "jeito de tributar" reaproveitado por vários produtos (CFOP, CSOSN
 * ou CST, origem e cClassTrib). O cálculo dos impostos chega com a emissão de notas (Fase 3);
 * até lá o perfil fica guardado e já vinculado aos produtos.
 */
export function FiscalProfilesPage() {
  const { api } = useApp();
  const canWrite = useCan('fiscal.profile.write');
  const list = useQuery({
    queryKey: ['fiscal-profiles'],
    queryFn: () => api.get<FiscalProfile[]>('/fiscal-profiles'),
  });
  const [editing, setEditing] = useState<FiscalProfile | 'new' | null>(null);

  return (
    <>
      <PageHeader
        title="Perfis fiscais"
        description="Como cada grupo de produtos é tributado. Escolha o perfil no cadastro do produto."
        actions={
          canWrite && (
            <Button
              icon={<Plus className="size-5" aria-hidden />}
              onClick={() => setEditing('new')}
            >
              Novo perfil
            </Button>
          )
        }
      />
      <div className="mb-4">
        <Alert tone="warning" title="O cálculo dos impostos chega com a emissão de NFC-e">
          Por enquanto o Bipaê guarda o perfil e o vínculo com os produtos, sem calcular impostos.
          Na dúvida sobre CFOP, CSOSN ou cClassTrib, confirme com o seu contador.
        </Alert>
      </div>
      {list.error && <Alert>{(list.error as Error).message}</Alert>}
      {list.data &&
        (list.data.length === 0 ? (
          <EmptyState title="Nenhum perfil fiscal ainda" />
        ) : (
          <DataTable
            caption="Lista de perfis fiscais"
            rows={list.data}
            onRowClick={canWrite ? setEditing : undefined}
            columns={[
              { header: 'Nome', cell: (p) => <span className="font-semibold">{p.name}</span> },
              {
                header: 'CFOP (no estado / fora)',
                cell: (p) => `${p.data.cfopInterna} / ${p.data.cfopInterestadual}`,
              },
              {
                header: 'CSOSN ou CST',
                cell: (p) =>
                  p.data.csosn
                    ? `CSOSN ${p.data.csosn}`
                    : p.data.cstIcms
                      ? `CST ${p.data.cstIcms}`
                      : '—',
              },
              { header: 'cClassTrib', cell: (p) => p.data.cClassTrib ?? '—' },
            ]}
          />
        ))}
      {editing && (
        <FiscalProfileForm
          profile={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function FiscalProfileForm({
  profile,
  onClose,
}: {
  profile: FiscalProfile | null;
  onClose: () => void;
}) {
  const { api } = useApp();
  const queryClient = useQueryClient();
  const d = profile?.data;
  const [regime, setRegime] = useState<'simples' | 'normal'>(
    d?.cstIcms && !d.csosn ? 'normal' : 'simples',
  );
  const form = useForm({
    name: profile?.name ?? '',
    origem: String(d?.origem ?? 0),
    cfopInterna: d?.cfopInterna ?? '5102',
    cfopInterestadual: d?.cfopInterestadual ?? '6102',
    csosn: d?.csosn ?? '102',
    cstIcms: d?.cstIcms ?? '00',
    cClassTrib: d?.cClassTrib ?? '',
  });
  const digits =
    (key: 'cfopInterna' | 'cfopInterestadual' | 'csosn' | 'cstIcms' | 'cClassTrib', max: number) =>
    (e: { target: { value: string } }) =>
      form.set(key, e.target.value.replace(/\D/g, '').slice(0, max));

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void form.submit(async (v) => {
      const body = {
        name: v.name,
        origem: Number(v.origem),
        cfopInterna: v.cfopInterna,
        cfopInterestadual: v.cfopInterestadual,
        csosn: regime === 'simples' ? v.csosn : null,
        cstIcms: regime === 'normal' ? v.cstIcms : null,
        cClassTrib: v.cClassTrib || null,
      };
      if (profile) await api.put(`/fiscal-profiles/${profile.id}`, body);
      else await api.post('/fiscal-profiles', body);
      await queryClient.invalidateQueries({ queryKey: ['fiscal-profiles'] });
      onClose();
    });
  };

  return (
    <Drawer
      open
      onOpenChange={(open) => !open && onClose()}
      title={profile ? 'Editar perfil fiscal' : 'Novo perfil fiscal'}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {form.formError && <Alert>{form.formError}</Alert>}
        <TextField
          label="Nome do perfil"
          placeholder="Ex.: Revenda — Simples Nacional"
          value={form.values.name}
          onChange={(e) => form.set('name', e.target.value)}
          error={form.errors.name}
          autoFocus
        />
        <SelectField
          label="Origem da mercadoria"
          value={form.values.origem}
          onChange={(e) => form.set('origem', e.target.value)}
          options={ICMS_ORIGINS.map((o) => ({
            value: String(o.code),
            label: `${o.code} — ${o.label}`,
          }))}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="CFOP dentro do estado"
            inputMode="numeric"
            value={form.values.cfopInterna}
            onChange={digits('cfopInterna', 4)}
            error={form.errors.cfopInterna}
          />
          <TextField
            label="CFOP para outro estado"
            inputMode="numeric"
            value={form.values.cfopInterestadual}
            onChange={digits('cfopInterestadual', 4)}
            error={form.errors.cfopInterestadual}
          />
        </div>
        <SelectField
          label="Regime da empresa"
          value={regime}
          onChange={(e) => setRegime(e.target.value as 'simples' | 'normal')}
          options={[
            { value: 'simples', label: 'Simples Nacional (usa CSOSN)' },
            { value: 'normal', label: 'Lucro Presumido ou Real (usa CST)' },
          ]}
        />
        {regime === 'simples' ? (
          <TextField
            label="CSOSN"
            inputMode="numeric"
            hint="Ex.: 102 (sem permissão de crédito), 500 (ICMS já recolhido por ST)."
            value={form.values.csosn}
            onChange={digits('csosn', 3)}
            error={form.errors.csosn}
          />
        ) : (
          <TextField
            label="CST do ICMS"
            inputMode="numeric"
            hint="Ex.: 00 (tributada integralmente), 60 (ICMS cobrado antes por ST)."
            value={form.values.cstIcms}
            onChange={digits('cstIcms', 2)}
            error={form.errors.cstIcms}
          />
        )}
        <TextField
          label="cClassTrib (IBS/CBS) — opcional"
          inputMode="numeric"
          hint="Classificação tributária da Reforma, com 6 dígitos."
          value={form.values.cClassTrib}
          onChange={digits('cClassTrib', 6)}
          error={form.errors.cClassTrib}
        />
        <div className="flex gap-2 pt-2">
          <Button type="submit" loading={form.submitting}>
            Salvar perfil
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
        </div>
      </form>
    </Drawer>
  );
}
