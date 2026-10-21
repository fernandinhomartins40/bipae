import type { SellerView } from '@bipae/domain';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
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
import { ApiError } from '../api-client';
import { useForm } from '../forms';
import { formatBp, parsePercentBp } from '../percent';

interface MemberOption {
  userId: string;
  name: string;
}

/**
 * Vendedores (F8-01): quem aparece no caixa para dizer quem vendeu. O código curto é o que o
 * caixa digita; o usuário ligado é quem vai lançar pedidos pelo celular.
 */
export function SellersPage() {
  const { api } = useApp();
  const canWrite = useCan('admin.users');
  const list = useQuery({
    queryKey: ['sellers'],
    queryFn: () => api.get<SellerView[]>('/sellers'),
  });
  const [editing, setEditing] = useState<SellerView | 'new' | null>(null);

  return (
    <>
      <PageHeader
        title="Vendedores"
        description="Quem vende na loja. No caixa, o vendedor é escolhido pelo código ou pelo nome, e as vendas dele aparecem nos relatórios."
        actions={
          canWrite && (
            <Button
              icon={<Plus className="size-5" aria-hidden />}
              onClick={() => setEditing('new')}
            >
              Novo vendedor
            </Button>
          )
        }
      />
      {list.error && <Alert>{(list.error as Error).message}</Alert>}
      {list.data &&
        (list.data.length === 0 ? (
          <EmptyState title="Nenhum vendedor ainda">
            Cadastre os vendedores para saber quem vendeu cada venda e, depois, calcular a comissão.
            {canWrite && (
              <div className="mt-4">
                <Button
                  icon={<Plus className="size-5" aria-hidden />}
                  onClick={() => setEditing('new')}
                >
                  Cadastrar o primeiro vendedor
                </Button>
              </div>
            )}
          </EmptyState>
        ) : (
          <DataTable
            caption="Lista de vendedores"
            rows={list.data}
            onRowClick={canWrite ? setEditing : undefined}
            columns={[
              { header: 'Código', cell: (s) => <span className="tabular-nums">{s.code}</span> },
              { header: 'Nome', cell: (s) => <span className="font-semibold">{s.name}</span> },
              {
                header: 'Comissão',
                cell: (s) => (s.commissionBp === null ? '—' : formatBp(s.commissionBp)),
              },
              { header: 'Usuário', cell: (s) => s.userName ?? '—' },
              {
                header: 'Situação',
                cell: (s) =>
                  s.active ? <Badge tone="success">Ativo</Badge> : <Badge>Inativo</Badge>,
              },
            ]}
          />
        ))}
      {editing && (
        <SellerForm
          seller={editing === 'new' ? null : editing}
          nextCode={nextCode(list.data ?? [])}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

/** Sugere o próximo código livre, para o dono não precisar pensar nisso. */
export function nextCode(sellers: SellerView[]): string {
  const used = sellers.map((s) => Number(s.code)).filter(Number.isFinite);
  return String((used.length ? Math.max(...used) : 0) + 1);
}

function SellerForm({
  seller,
  nextCode: suggested,
  onClose,
}: {
  seller: SellerView | null;
  nextCode: string;
  onClose: () => void;
}) {
  const { api } = useApp();
  const queryClient = useQueryClient();
  const members = useQuery({
    queryKey: ['members'],
    queryFn: () => api.get<MemberOption[]>('/members'),
  });
  const form = useForm({
    name: seller?.name ?? '',
    code: seller?.code ?? suggested,
    userId: seller?.userId ?? '',
    active: seller?.active ?? true,
    commission: seller?.commissionBp != null ? formatBp(seller.commissionBp).replace('%', '') : '',
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void form.submit(async (v) => {
      const { commission, ...rest } = v;
      const commissionBp = commission.trim() ? parsePercentBp(commission) : undefined;
      if (commissionBp === null) {
        const message = 'Comissão inválida. Use um número de 0 a 100, como 2,5.';
        throw new ApiError(400, 'validation', message, [{ path: 'commission', message }]);
      }
      const body = { ...rest, userId: v.userId || null, commissionBp };
      if (seller) await api.put(`/sellers/${seller.id}`, body);
      else await api.post('/sellers', body);
      await queryClient.invalidateQueries({ queryKey: ['sellers'] });
      onClose();
    });
  };

  return (
    <Drawer
      open
      onOpenChange={(open) => !open && onClose()}
      title={seller ? 'Editar vendedor' : 'Novo vendedor'}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {form.formError && <Alert>{form.formError}</Alert>}
        <TextField
          label="Nome do vendedor"
          value={form.values.name}
          onChange={(e) => form.set('name', e.target.value)}
          error={form.errors.name}
          autoFocus
        />
        <TextField
          label="Código no caixa"
          inputMode="numeric"
          hint="Número curto que o caixa digita para escolher o vendedor."
          value={form.values.code}
          onChange={(e) => form.set('code', e.target.value.replace(/\D/g, '').slice(0, 6))}
          error={form.errors.code}
        />
        <TextField
          label="Comissão (%)"
          inputMode="decimal"
          hint="Sobre o que ele vender e o cliente pagar. Mudar vale a partir de hoje; produtos e categorias podem ter um % próprio em Comissões."
          value={form.values.commission}
          onChange={(e) => form.set('commission', e.target.value)}
          error={form.errors.commission ?? form.errors.commissionBp}
        />
        <SelectField
          label="Usuário do Bipaê (opcional)"
          hint="Ligue a um usuário da equipe para ele lançar pedidos pelo celular."
          value={form.values.userId}
          onChange={(e) => form.set('userId', e.target.value)}
          error={form.errors.userId}
          options={[
            { value: '', label: 'Sem usuário (só escolhido no caixa)' },
            ...(members.data ?? []).map((m) => ({ value: m.userId, label: m.name })),
          ]}
        />
        <Checkbox
          label="Ativo (aparece no caixa)"
          checked={form.values.active}
          onChange={(checked) => form.set('active', checked)}
        />
        <Button type="submit" loading={form.submitting}>
          Salvar vendedor
        </Button>
      </form>
    </Drawer>
  );
}
