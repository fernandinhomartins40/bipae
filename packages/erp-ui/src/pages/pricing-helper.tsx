import {
  cents,
  formatBRL,
  markupPrice,
  percentToBasisPoints,
  PricingError,
  type ProductPricing,
} from '@bipae/domain';
import { Alert, Button, TextField } from '@bipae/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useApp } from '../context';

const brl = (value: number) => formatBRL(cents(value));
const percentText = (bp: number) =>
  (bp / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 });

/**
 * Formação de preço (F4-03): margem, impostos da venda e despesas sobre o preço, pelo divisor
 * de markup. Os impostos vêm do motor fiscal (regime e perfil do produto); no Simples, a pessoa
 * informa a alíquota efetiva do DAS.
 */
export function PricingHelper({
  productId,
  costCents,
  onUse,
}: {
  productId: string;
  costCents: number | null;
  onUse: (priceCents: number) => void;
}) {
  const { api } = useApp();
  const info = useQuery({
    queryKey: ['products', productId, 'pricing'],
    queryFn: () => api.get<ProductPricing>(`/products/${productId}/pricing`),
  });
  const [margin, setMargin] = useState('30');
  const [expenses, setExpenses] = useState('0');
  const [taxes, setTaxes] = useState<string | null>(null);
  const data = info.data;
  const taxesText = taxes ?? (data ? percentText(data.taxesBp) : '');

  let result: ReturnType<typeof markupPrice> | null = null;
  let problem: string | null = null;
  const marginBp = percentToBasisPoints(margin);
  const expensesBp = percentToBasisPoints(expenses);
  const taxesBp = percentToBasisPoints(taxesText);
  if (costCents === null) problem = 'Informe o custo do produto para formar o preço.';
  else if (marginBp === null || expensesBp === null || taxesBp === null)
    problem = 'Percentual inválido.';
  else {
    try {
      result = markupPrice({ costCents, marginBp, taxesBp, expensesBp });
    } catch (e) {
      problem = e instanceof PricingError ? e.message : 'Não foi possível calcular.';
    }
  }

  return (
    <section aria-label="Formar preço" className="flex flex-col gap-3 rounded-ui bg-surface-2 p-4">
      <h3 className="font-semibold">Formar preço</h3>
      {data && data.taxes.length > 0 && (
        <p className="text-sm text-muted">
          Impostos da venda ({data.regime}):{' '}
          {data.taxes.map((t) => `${t.label} ${percentText(t.bp)}%`).join(' · ')}
        </p>
      )}
      {data?.notes.map((note) => (
        <p key={note} className="text-sm text-muted">
          {note}
        </p>
      ))}
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField
          label="Margem (%)"
          inputMode="decimal"
          value={margin}
          onChange={(e) => setMargin(e.target.value)}
        />
        <TextField
          label={data?.simples ? 'Alíquota do DAS (%)' : 'Impostos da venda (%)'}
          inputMode="decimal"
          value={taxesText}
          onChange={(e) => setTaxes(e.target.value)}
        />
        <TextField
          label="Despesas (%)"
          hint="Aluguel, folha, cartão... em % do preço."
          inputMode="decimal"
          value={expenses}
          onChange={(e) => setExpenses(e.target.value)}
        />
      </div>
      {problem && <Alert tone="warning">{problem}</Alert>}
      {result && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p data-testid="suggested-price">
            Preço sugerido: <strong>{brl(result.priceCents)}</strong>
            <span className="block text-sm text-muted">
              Custo {brl(result.costCents)} · impostos {brl(result.taxesCents)} · despesas{' '}
              {brl(result.expensesCents)} · margem {brl(result.marginCents)}
            </span>
          </p>
          <Button variant="secondary" onClick={() => onUse(result!.priceCents)}>
            Usar este preço
          </Button>
        </div>
      )}
    </section>
  );
}
