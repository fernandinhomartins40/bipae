import {
  formatBRL,
  PAYMENT_LABELS,
  type Cents,
  type PaymentMethod,
  type SaleItemTaxes,
} from '@bipae/domain';
import { Alert, Drawer } from '@bipae/ui';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../context';
import { FiscalDocumentSection } from './fiscal-document';

/**
 * Detalhe de uma venda (F3-06.d4): os itens, os pagamentos e os impostos que o caixa calculou no
 * fechamento. Os valores são para conferência; o Bipaê ainda não emite a nota.
 */
interface SaleDetail {
  id: string;
  terminalSeq: number;
  totalCents: number;
  discountCents: number;
  occurredAt: string;
  /** A conta do servidor bateu com a do caixa? Nulo quando o caixa não calculou impostos. */
  taxCheck: 'ok' | 'divergente' | null;
  items: {
    line: number;
    name: string;
    unit: string;
    quantityMilli: number;
    totalCents: number;
    taxes: SaleItemTaxes | null;
  }[];
  payments: { method: PaymentMethod; amountCents: number }[];
}

const TAXES = [
  ['icmsCents', 'ICMS'],
  ['icmsStCents', 'ICMS-ST'],
  ['fcpCents', 'FCP'],
  ['pisCents', 'PIS'],
  ['cofinsCents', 'COFINS'],
  ['ibsCents', 'IBS'],
  ['cbsCents', 'CBS'],
] as const;

const money = (cents: number) => formatBRL(cents as Cents);
const quantity = (milli: number, unit: string) =>
  `${(milli / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${unit}`;

export function SaleDetailDrawer({ saleId, onClose }: { saleId: string; onClose: () => void }) {
  const { api } = useApp();
  const sale = useQuery({
    queryKey: ['sale', saleId],
    queryFn: () => api.get<SaleDetail>(`/sales/${saleId}`),
  });
  const data = sale.data;
  const withTaxes = data?.items.filter((item) => item.taxes) ?? [];
  // Soma por tributo, só do que tem valor destacado em algum item.
  const totals = TAXES.map(([key, label]) => ({
    label,
    cents: withTaxes.reduce((sum, item) => sum + (item.taxes![key] ?? 0), 0),
    present: withTaxes.some((item) => item.taxes![key] !== null),
  })).filter((tax) => tax.present);
  const pending = [...new Set(withTaxes.flatMap((item) => item.taxes!.pending))];

  return (
    <Drawer
      open
      onOpenChange={(open) => !open && onClose()}
      title={data ? `Venda nº ${data.terminalSeq}` : 'Venda'}
    >
      {sale.error && <Alert>{(sale.error as Error).message}</Alert>}
      {data && (
        <div className="flex flex-col gap-5">
          <section aria-label="Itens da venda">
            <h3 className="mb-2 font-semibold">Itens</h3>
            <ul className="flex flex-col gap-2">
              {data.items.map((item) => (
                <li key={item.line} className="rounded-ui border border-border p-3">
                  <div className="flex justify-between gap-3">
                    <span>
                      <span className="font-semibold">{item.name}</span>
                      <span className="text-muted">
                        {' '}
                        · {quantity(item.quantityMilli, item.unit)}
                      </span>
                    </span>
                    <span className="tabular-nums">{money(item.totalCents)}</span>
                  </div>
                  {item.taxes && (
                    <p className="mt-1 text-sm text-muted">
                      {item.taxes.cfop && `CFOP ${item.taxes.cfop} · `}
                      {TAXES.filter(([key]) => item.taxes![key] !== null)
                        .map(([key, label]) => `${label} ${money(item.taxes![key]!)}`)
                        .join(' · ') || 'Sem imposto destacado'}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section aria-label="Impostos da venda">
            <h3 className="mb-2 font-semibold">Impostos calculados pelo caixa</h3>
            {withTaxes.length === 0 ? (
              <p className="text-sm text-muted">
                Esta venda não tem impostos calculados. Isso acontece quando a empresa ainda não
                tinha UF e regime tributário informados em Empresas e lojas, ou quando o caixa
                estava numa versão anterior.
              </p>
            ) : (
              <>
                {totals.length > 0 && (
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                    {totals.map((tax) => (
                      <div key={tax.label} className="flex justify-between">
                        <dt className="text-muted">{tax.label}</dt>
                        <dd className="tabular-nums">{money(tax.cents)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                <p className="mt-2 text-sm text-muted">
                  Valores para conferência com o contador. A nota fiscal da venda aparece logo
                  abaixo.
                </p>
                {pending.length > 0 && (
                  <div className="mt-3">
                    <Alert tone="warning" title="Falta configurar para o cálculo ficar completo">
                      <ul className="list-disc pl-5">
                        {pending.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    </Alert>
                  </div>
                )}
                {data.taxCheck === 'divergente' && (
                  <div className="mt-3">
                    <Alert tone="warning" title="O cadastro mudou depois desta venda">
                      O caixa calculou com os dados fiscais que tinha no momento, e eles já eram
                      diferentes dos da retaguarda (por exemplo, o regime ou o perfil fiscal foi
                      alterado e o caixa ainda não tinha sincronizado). Os valores acima são os que
                      o caixa calculou.
                    </Alert>
                  </div>
                )}
              </>
            )}
          </section>

          <FiscalDocumentSection saleId={saleId} />

          <section aria-label="Pagamentos">
            <h3 className="mb-2 font-semibold">Pagamento</h3>
            <ul className="text-sm">
              {data.payments.map((payment, index) => (
                <li key={index} className="flex justify-between">
                  <span>{PAYMENT_LABELS[payment.method]}</span>
                  <span className="tabular-nums">{money(payment.amountCents)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 flex justify-between font-semibold">
              <span>Total</span>
              <span className="tabular-nums">{money(data.totalCents)}</span>
            </p>
          </section>
        </div>
      )}
    </Drawer>
  );
}
