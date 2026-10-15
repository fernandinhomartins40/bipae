import {
  cents,
  formatBRL,
  type Page,
  type Product,
  type PromotionRule,
  type PromotionView,
} from '@bipae/domain';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  DataTable,
  Drawer,
  EmptyState,
  MoneyField,
  PageHeader,
  SelectField,
  TextField,
} from '@bipae/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { useApp, useCan } from '../context';
import { parseQuantity } from './purchase-orders';

const brl = (value: number) => formatBRL(cents(value));
const qty = (milli: number) => (milli / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const day = (iso: string) => iso.split('-').reverse().join('/');
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

const KINDS: Record<PromotionRule['kind'], string> = {
  buy_x_pay_y: 'Leve X pague Y',
  quantity_tier: 'Preço por quantidade',
  combo: 'Combo',
};

/** Resumo da regra para a lista ("Leve 3 pague 2", "A partir de 6: R$ 7,99"...). */
export function describeRule(rule: PromotionRule): string {
  if (rule.kind === 'buy_x_pay_y') return `Leve ${rule.buy} pague ${rule.pay}`;
  if (rule.kind === 'quantity_tier') {
    return rule.tiers
      .map((t) => `a partir de ${qty(t.minQuantityMilli)}: ${brl(t.unitPriceCents)} cada`)
      .join('; ')
      .replace(/^a/, 'A');
  }
  return `${rule.items.length} produtos por ${brl(rule.priceCents)}`;
}

/** Promoções do caixa (F5-02): leve X pague Y, preço por quantidade e combo. */
export function PromotionsPage() {
  const { api } = useApp();
  const canWrite = useCan('catalog.write');
  const list = useQuery({
    queryKey: ['promotions'],
    queryFn: () => api.get<PromotionView[]>('/promotions'),
  });
  const [open, setOpen] = useState<PromotionView | 'new' | null>(null);
  const now = today();
  const rows = list.data ?? [];
  return (
    <>
      <PageHeader
        title="Promoções"
        description="Leve X pague Y, preço por quantidade e combos. O caixa aplica sozinho, mesmo sem internet; promoções não se somam no mesmo item."
        actions={
          canWrite && (
            <Button icon={<Plus className="size-4" aria-hidden />} onClick={() => setOpen('new')}>
              Nova promoção
            </Button>
          )
        }
      />
      {list.error && <Alert>{(list.error as Error).message}</Alert>}
      {list.data && rows.length === 0 ? (
        <EmptyState title="Nenhuma promoção ainda">
          Crie a primeira: ela chega aos caixas na próxima sincronização.
        </EmptyState>
      ) : (
        rows.length > 0 && (
          <DataTable
            caption="Promoções"
            rows={rows}
            onRowClick={canWrite ? (r) => setOpen(r) : undefined}
            columns={[
              { header: 'Nome', cell: (r) => <span className="font-semibold">{r.name}</span> },
              { header: 'Tipo', cell: (r) => KINDS[r.rule.kind] },
              { header: 'Regra', cell: (r) => describeRule(r.rule) },
              {
                header: 'Vigência',
                cell: (r) =>
                  r.endsOn ? `${day(r.startsOn)} a ${day(r.endsOn)}` : `Desde ${day(r.startsOn)}`,
              },
              {
                header: 'Situação',
                cell: (r) =>
                  !r.active ? (
                    <Badge>Desligada</Badge>
                  ) : r.endsOn && r.endsOn < now ? (
                    <Badge>Encerrada</Badge>
                  ) : r.startsOn > now ? (
                    <Badge tone="warning">Agendada</Badge>
                  ) : (
                    <Badge tone="success">Valendo</Badge>
                  ),
              },
            ]}
          />
        )
      )}
      {open && (
        <PromotionDrawer promotion={open === 'new' ? null : open} onClose={() => setOpen(null)} />
      )}
    </>
  );
}

interface Picked {
  id: string;
  name: string;
  /** Combo: quantidade de unidades do produto no combo. */
  quantity: string;
}

function PromotionDrawer({
  promotion,
  onClose,
}: {
  promotion: PromotionView | null;
  onClose: () => void;
}) {
  const { api } = useApp();
  const queryClient = useQueryClient();
  const rule = promotion?.rule;
  const [name, setName] = useState(promotion?.name ?? '');
  const [startsOn, setStartsOn] = useState(promotion?.startsOn ?? today());
  const [endsOn, setEndsOn] = useState(promotion?.endsOn ?? '');
  const [active, setActive] = useState(promotion?.active ?? true);
  const [kind, setKind] = useState<PromotionRule['kind']>(rule?.kind ?? 'buy_x_pay_y');
  const [buy, setBuy] = useState(rule?.kind === 'buy_x_pay_y' ? String(rule.buy) : '3');
  const [pay, setPay] = useState(rule?.kind === 'buy_x_pay_y' ? String(rule.pay) : '2');
  const [tiers, setTiers] = useState<{ quantity: string; priceCents: number | null }[]>(
    rule?.kind === 'quantity_tier'
      ? rule.tiers.map((t) => ({ quantity: qty(t.minQuantityMilli), priceCents: t.unitPriceCents }))
      : [{ quantity: '', priceCents: null }],
  );
  const [comboPrice, setComboPrice] = useState<number | null>(
    rule?.kind === 'combo' ? rule.priceCents : null,
  );
  const [items, setItems] = useState<Picked[]>(
    rule?.kind === 'combo'
      ? rule.items.map((i) => ({
          id: i.productId,
          name: promotion?.products.find((p) => p.id === i.productId)?.name ?? 'Produto',
          quantity: qty(i.quantityMilli),
        }))
      : (promotion?.products ?? []).map((p) => ({ ...p, quantity: '1' })),
  );
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const found = useQuery({
    queryKey: ['products', 'promotion-search', q],
    queryFn: () => api.get<Page<Product>>(`/products?q=${encodeURIComponent(q)}&limit=8`),
    enabled: q.length >= 2,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const buildRule = (): PromotionRule => {
    if (kind === 'buy_x_pay_y') {
      return {
        kind,
        productIds: items.map((i) => i.id),
        buy: Number(buy),
        pay: Number(pay),
      };
    }
    if (kind === 'quantity_tier') {
      return {
        kind,
        productIds: items.map((i) => i.id),
        tiers: tiers.map((t, n) => {
          const milli = parseQuantity(t.quantity);
          if (!milli || t.priceCents === null) throw new Error(`Complete a faixa ${n + 1}.`);
          return { minQuantityMilli: milli, unitPriceCents: t.priceCents };
        }),
      };
    }
    if (comboPrice === null) throw new Error('Informe o preço do combo.');
    return {
      kind,
      priceCents: comboPrice,
      items: items.map((i) => {
        const milli = parseQuantity(i.quantity);
        if (!milli) throw new Error(`Quantidade inválida em ${i.name}.`);
        return { productId: i.id, quantityMilli: milli };
      }),
    };
  };

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      const body = { name, startsOn, endsOn: endsOn || null, active, rule: buildRule() };
      if (promotion) await api.put(`/promotions/${promotion.id}`, body);
      else await api.post('/promotions', body);
      await queryClient.invalidateQueries({ queryKey: ['promotions'] });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open
      onOpenChange={(o) => !o && onClose()}
      title={promotion ? 'Editar promoção' : 'Nova promoção'}
    >
      <div className="flex flex-col gap-4">
        {error && <Alert>{error}</Alert>}
        <TextField
          label="Nome da promoção"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <SelectField
          label="Tipo"
          value={kind}
          onChange={(e) => setKind(e.target.value as PromotionRule['kind'])}
          options={Object.entries(KINDS).map(([value, label]) => ({ value, label }))}
        />
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Começa em"
            type="date"
            value={startsOn}
            onChange={(e) => setStartsOn(e.target.value)}
          />
          <TextField
            label="Termina em"
            type="date"
            value={endsOn}
            hint="Em branco: sem data para acabar."
            onChange={(e) => setEndsOn(e.target.value)}
          />
        </div>

        {kind === 'buy_x_pay_y' && (
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Leve"
              inputMode="numeric"
              value={buy}
              onChange={(e) => setBuy(e.target.value)}
            />
            <TextField
              label="Pague"
              inputMode="numeric"
              value={pay}
              onChange={(e) => setPay(e.target.value)}
            />
          </div>
        )}
        {kind === 'quantity_tier' && (
          <div className="flex flex-col gap-2">
            {tiers.map((t, n) => (
              <div key={n} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                <TextField
                  label={`Faixa ${n + 1}: a partir de`}
                  inputMode="decimal"
                  value={t.quantity}
                  onChange={(e) =>
                    setTiers((list) =>
                      list.map((x, i) => (i === n ? { ...x, quantity: e.target.value } : x)),
                    )
                  }
                />
                <MoneyField
                  label={`Faixa ${n + 1}: preço de cada`}
                  value={t.priceCents}
                  onChange={(priceCents) =>
                    setTiers((list) => list.map((x, i) => (i === n ? { ...x, priceCents } : x)))
                  }
                />
                <Button
                  variant="ghost"
                  aria-label={`Tirar a faixa ${n + 1}`}
                  icon={<X className="size-4" aria-hidden />}
                  disabled={tiers.length === 1}
                  onClick={() => setTiers((list) => list.filter((_, i) => i !== n))}
                />
              </div>
            ))}
            <Button
              variant="secondary"
              onClick={() => setTiers((list) => [...list, { quantity: '', priceCents: null }])}
              disabled={tiers.length >= 10}
            >
              Adicionar faixa
            </Button>
          </div>
        )}
        {kind === 'combo' && (
          <MoneyField label="Preço do combo" value={comboPrice} onChange={setComboPrice} />
        )}

        <div className="flex flex-col gap-2">
          <TextField
            label="Adicionar produto"
            placeholder="Digite o nome ou o código"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            hint={
              kind === 'combo'
                ? 'Os produtos que formam o combo.'
                : 'Os produtos escolhidos contam juntos (ex.: todos os sabores do mesmo suco).'
            }
          />
          {q.length >= 2 && found.data && (
            <ul className="rounded-ui border border-border" aria-label="Produtos encontrados">
              {found.data.items.length === 0 && (
                <li className="p-3 text-muted">Nenhum produto encontrado.</li>
              )}
              {found.data.items.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="w-full p-3 text-left hover:bg-surface-2"
                    onClick={() => {
                      if (!items.some((i) => i.id === p.id)) {
                        setItems([...items, { id: p.id, name: p.name, quantity: '1' }]);
                      }
                      setSearch('');
                    }}
                  >
                    {p.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {items.length > 0 && (
            <ul className="flex flex-col gap-2" aria-label="Produtos da promoção">
              {items.map((item, n) => (
                <li
                  key={item.id}
                  className="flex items-end justify-between gap-3 rounded-ui border border-border p-3"
                >
                  <span className="font-semibold">{item.name}</span>
                  {kind === 'combo' && (
                    <TextField
                      label={`Unidades de ${item.name}`}
                      inputMode="numeric"
                      className="w-24"
                      value={item.quantity}
                      onChange={(e) =>
                        setItems(
                          items.map((x, i) => (i === n ? { ...x, quantity: e.target.value } : x)),
                        )
                      }
                    />
                  )}
                  <Button
                    variant="ghost"
                    aria-label={`Tirar ${item.name}`}
                    icon={<X className="size-4" aria-hidden />}
                    onClick={() => setItems(items.filter((_, i) => i !== n))}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
        <Checkbox
          label="Promoção ligada"
          checked={active}
          onChange={setActive}
          hint="Desligada, ela sai dos caixas na próxima sincronização e fica no histórico."
        />
        <Button loading={busy} onClick={() => void save()} disabled={!name.trim()}>
          Salvar promoção
        </Button>
      </div>
    </Drawer>
  );
}
