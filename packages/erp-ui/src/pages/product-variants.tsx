import {
  formatBRL,
  parseVariantValues,
  sameVariant,
  variantCombinations,
  variantGrid,
  variantName,
  type Cents,
  type Page,
  type Product,
  type VariantGrid,
} from '@bipae/domain';
import { Alert, Button, MoneyField, TextField } from '@bipae/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useApp, useCan } from '../context';

/**
 * Grade de variações (F1-04): o produto vira "modelo" e cada combinação (ex.: P / Azul) vira um
 * produto filho, com preço, código de barras e estoque próprios. No caixa aparecem as variações.
 */
export function VariantsEditor({ product }: { product: Product }) {
  const { api } = useApp();
  const queryClient = useQueryClient();
  const children = useQuery({
    queryKey: ['products', 'variants', product.id],
    queryFn: () => api.get<Page<Product>>(`/products?parentId=${product.id}&limit=200`),
  });
  const [attrs, setAttrs] = useState([
    { name: 'Tamanho', values: '' },
    { name: 'Cor', values: '' },
  ]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const combos = variantCombinations(
    attrs.map((a) => ({ name: a.name, values: parseVariantValues(a.values) })),
  );
  const existing = children.data?.items ?? [];
  const missing = combos.filter((c) => !existing.some((p) => sameVariant(p.attributes, c)));
  const [swap, setSwap] = useState(false);
  const grid = variantGrid(existing, swap);

  const generate = async () => {
    setBusy(true);
    setMessage(null);
    try {
      for (const attributes of missing) {
        await api.post('/products', {
          name: variantName(product.name, attributes),
          priceCents: product.priceCents,
          costCents: product.costCents,
          unit: product.unit,
          isWeighable: product.isWeighable,
          ncm: product.ncm,
          cest: product.cest,
          fiscalProfileId: product.fiscalProfileId,
          parentId: product.id,
          attributes,
        });
      }
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      setMessage({
        ok: true,
        text: missing.length === 1 ? '1 variação criada.' : `${missing.length} variações criadas.`,
      });
      setAttrs((list) => list.map((a) => ({ ...a, values: '' })));
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-6 border-t border-border pt-4" aria-labelledby="variacoes">
      <h3 id="variacoes" className="font-bold">
        Variações (grade)
      </h3>
      <p className="mb-3 text-sm text-muted">
        Para produtos com tamanho, cor, sabor... Cada combinação vira um produto com preço, código
        de barras e estoque próprios. No caixa aparecem as variações, não o modelo.
      </p>
      {message && (
        <div className="mb-3">
          <Alert tone={message.ok ? 'success' : 'danger'}>{message.text}</Alert>
        </div>
      )}
      <div className="flex flex-col gap-3">
        {attrs.map((a, index) => (
          <div key={index} className="grid gap-2 sm:grid-cols-[10rem_1fr]">
            <TextField
              label={`Atributo ${index + 1}`}
              value={a.name}
              onChange={(e) =>
                setAttrs((list) =>
                  list.map((it, i) => (i === index ? { ...it, name: e.target.value } : it)),
                )
              }
            />
            <TextField
              label={`Valores de ${a.name || `atributo ${index + 1}`}`}
              placeholder="Separe por vírgula: P, M, G"
              value={a.values}
              onChange={(e) =>
                setAttrs((list) =>
                  list.map((it, i) => (i === index ? { ...it, values: e.target.value } : it)),
                )
              }
            />
          </div>
        ))}
        <Button
          variant="secondary"
          loading={busy}
          disabled={missing.length === 0}
          onClick={() => void generate()}
        >
          {missing.length === 0
            ? 'Gerar variações'
            : missing.length === 1
              ? 'Gerar 1 variação'
              : `Gerar ${missing.length} variações`}
        </Button>
      </div>
      {grid && <VariantMatrix grid={grid} onSwap={() => setSwap((x) => !x)} />}
      {!grid && existing.length > 0 && (
        <ul className="mt-4 flex flex-col gap-1" aria-label="Variações deste produto">
          {existing.map((v) => (
            <li
              key={v.id}
              className="flex justify-between gap-2 rounded-ui bg-surface-2 px-3 py-2 text-sm"
            >
              <span>{v.name}</span>
              <span className="text-muted">{formatBRL(v.priceCents as Cents)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const units = (milli: number) =>
  (milli / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 3 });

/**
 * Grade em matriz (F5-12.a): tamanho nas linhas, cor nas colunas. Cada cruzamento mostra o
 * estoque somado das lojas e o preço, que pode ser trocado ali mesmo (a troca de preço pede a
 * permissão de preço e entra na auditoria, como no cadastro).
 */
function VariantMatrix({ grid, onSwap }: { grid: VariantGrid<Product>; onSwap: () => void }) {
  const { api } = useApp();
  const queryClient = useQueryClient();
  const canPrice = useCan('catalog.price.write');
  const ids = grid.rows.flatMap((r) => grid.cols.map((c) => grid.cell(r, c)?.id)).filter(Boolean);
  const stock = useQuery({
    queryKey: ['stock', 'variants', ids],
    queryFn: () =>
      api.get<{ productId: string; quantityMilli: number }[]>(
        `/stock?${ids.map((id) => `productId=${id}`).join('&')}`,
      ),
    enabled: ids.length > 0,
  });
  const [prices, setPrices] = useState<Record<string, number | null>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const onHand = (id: string) =>
    (stock.data ?? []).filter((s) => s.productId === id).reduce((t, s) => t + s.quantityMilli, 0);
  const label = (row: string, col: string) => (col ? `${row} / ${col}` : row);
  const changed = Object.entries(prices).filter(([id, cents]) => {
    const v = grid.rows
      .flatMap((r) => grid.cols.map((c) => grid.cell(r, c)))
      .find((x) => x?.id === id);
    return v && cents !== null && cents !== v.priceCents;
  });

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      for (const [id, cents] of changed) {
        const v = grid.rows
          .flatMap((r) => grid.cols.map((c) => grid.cell(r, c)))
          .find((x) => x?.id === id)!;
        await api.put(`/products/${id}`, {
          ...v,
          priceCents: cents,
          components: v.components.map(({ productId, quantity }) => ({ productId, quantity })),
        });
      }
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      setPrices({});
      setMessage({
        ok: true,
        text: changed.length === 1 ? '1 preço alterado.' : `${changed.length} preços alterados.`,
      });
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4">
      {message && (
        <div className="mb-3">
          <Alert tone={message.ok ? 'success' : 'danger'}>{message.text}</Alert>
        </div>
      )}
      {grid.colName && (
        <Button variant="ghost" onClick={onSwap}>
          Trocar linhas e colunas
        </Button>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">
            Grade: {grid.rowName}
            {grid.colName ? ` × ${grid.colName}` : ''}, com estoque e preço
          </caption>
          <thead>
            <tr>
              <th scope="col" className="p-2 text-left text-muted">
                {grid.rowName}
                {grid.colName ? ` × ${grid.colName}` : ''}
              </th>
              {grid.cols.map((c) => (
                <th key={c} scope="col" className="p-2 text-left">
                  {c || 'Preço e estoque'}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((r) => (
              <tr key={r} className="border-t border-border">
                <th scope="row" className="p-2 text-left align-top">
                  {r}
                </th>
                {grid.cols.map((c) => {
                  const v = grid.cell(r, c);
                  if (!v) {
                    return (
                      <td key={c} className="p-2 align-top text-muted">
                        —
                      </td>
                    );
                  }
                  return (
                    <td key={c} className="min-w-36 p-2 align-top">
                      {canPrice ? (
                        <MoneyField
                          label={`Preço ${label(r, c)}`}
                          value={prices[v.id] ?? v.priceCents}
                          onChange={(cents) => setPrices((p) => ({ ...p, [v.id]: cents }))}
                        />
                      ) : (
                        <span>{formatBRL(v.priceCents as Cents)}</span>
                      )}
                      <p className="mt-1 text-muted" aria-label={`Estoque ${label(r, c)}`}>
                        Estoque: {stock.data ? units(onHand(v.id)) : '…'}
                      </p>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canPrice && (
        <Button
          className="mt-3"
          variant="secondary"
          loading={busy}
          disabled={changed.length === 0}
          onClick={() => void save()}
        >
          {changed.length > 1 ? `Salvar ${changed.length} preços` : 'Salvar preços da grade'}
        </Button>
      )}
    </div>
  );
}
