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
import { CodeSuggestions, codeHint, useFiscalOptions } from './fiscal-lookup';

/**
 * Perfis fiscais (F1-02): o "jeito de tributar" reaproveitado por vários produtos (CFOP, CSOSN
 * ou CST, origem e cClassTrib). Os códigos são conferidos nas tabelas oficiais (F3-06); o cálculo
 * dos impostos é feito pelo caixa a cada venda (F3-06.d3); a emissão da nota vem depois.
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
        <Alert tone="warning" title="A emissão de NFC-e chega em breve">
          O Bipaê confere cada código na tabela oficial e já calcula os impostos de cada venda, para
          você conferir em Vendas. A nota fiscal ainda não é emitida. Na dúvida sobre CFOP, CSOSN ou
          cClassTrib, confirme com o seu contador.
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
  const options = useFiscalOptions().data;
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
    cstPisCofins: d?.cstPisCofins ?? '',
    cClassTrib: d?.cClassTrib ?? '',
  });
  const digits =
    (
      key: 'cfopInterna' | 'cfopInterestadual' | 'csosn' | 'cstIcms' | 'cstPisCofins' | 'cClassTrib',
      max: number,
    ) =>
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
        // No Simples o PIS e a COFINS vão no documento de arrecadação, não na nota.
        cstPisCofins: regime === 'normal' ? v.cstPisCofins || null : null,
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
          options={
            // Lista oficial quando já carregou; a lista curta do domínio enquanto isso.
            options
              ? options.origins.map((o) => ({ value: o.code, label: `${o.code} — ${o.description}` }))
              : ICMS_ORIGINS.map((o) => ({ value: String(o.code), label: `${o.code} — ${o.label}` }))
          }
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="CFOP dentro do estado"
            inputMode="numeric"
            value={form.values.cfopInterna}
            onChange={digits('cfopInterna', 4)}
            error={form.errors.cfopInterna}
            list="cfop-interna-opcoes"
            hint={codeHint(options?.cfopInterna, form.values.cfopInterna, 4, 'Começa com 5. Ex.: 5102 (revenda).')}
          />
          <TextField
            label="CFOP para outro estado"
            inputMode="numeric"
            value={form.values.cfopInterestadual}
            onChange={digits('cfopInterestadual', 4)}
            error={form.errors.cfopInterestadual}
            list="cfop-interestadual-opcoes"
            hint={codeHint(
              options?.cfopInterestadual,
              form.values.cfopInterestadual,
              4,
              'Começa com 6. Ex.: 6102 (revenda).',
            )}
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
            list="csosn-opcoes"
            hint={codeHint(
              options?.csosn,
              form.values.csosn,
              3,
              'Ex.: 102 (sem permissão de crédito), 500 (ICMS já recolhido por ST).',
            )}
            value={form.values.csosn}
            onChange={digits('csosn', 3)}
            error={form.errors.csosn}
          />
        ) : (
          <TextField
            label="CST do ICMS"
            inputMode="numeric"
            list="cst-icms-opcoes"
            hint={codeHint(
              options?.cstIcms,
              form.values.cstIcms,
              2,
              'Ex.: 00 (tributada integralmente), 60 (ICMS cobrado antes por ST).',
            )}
            value={form.values.cstIcms}
            onChange={digits('cstIcms', 2)}
            error={form.errors.cstIcms}
          />
        )}
        {regime === 'normal' && (
          <TextField
            label="CST do PIS e da COFINS"
            inputMode="numeric"
            list="cst-pis-cofins-opcoes"
            hint={codeHint(
              options?.cstPisCofins,
              form.values.cstPisCofins,
              2,
              'Ex.: 01 (tributada pela alíquota do regime), 04 (monofásica), 06 (alíquota zero).',
            )}
            value={form.values.cstPisCofins}
            onChange={digits('cstPisCofins', 2)}
            error={form.errors.cstPisCofins}
          />
        )}
        <TextField
          label="cClassTrib (IBS/CBS) — opcional"
          inputMode="numeric"
          list="class-trib-opcoes"
          hint={codeHint(
            options?.classTrib,
            form.values.cClassTrib,
            6,
            'Classificação tributária da Reforma, com 6 dígitos. Ex.: 000001 (tributação integral).',
          )}
          value={form.values.cClassTrib}
          onChange={digits('cClassTrib', 6)}
          error={form.errors.cClassTrib}
        />
        <CodeSuggestions id="cfop-interna-opcoes" list={options?.cfopInterna} />
        <CodeSuggestions id="cfop-interestadual-opcoes" list={options?.cfopInterestadual} />
        <CodeSuggestions id="cst-pis-cofins-opcoes" list={options?.cstPisCofins} />
        <CodeSuggestions id="csosn-opcoes" list={options?.csosn} />
        <CodeSuggestions id="cst-icms-opcoes" list={options?.cstIcms} />
        <CodeSuggestions id="class-trib-opcoes" list={options?.classTrib} />
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
