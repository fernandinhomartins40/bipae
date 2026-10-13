import {
  formatBRL,
  parseVariantValues,
  sameVariant,
  variantCombinations,
  variantName,
  type Cents,
  type Page,
  type Product,
} from '@bipae/domain';
import { Alert, Button, TextField } from '@bipae/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useApp } from '../context';

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
      {existing.length > 0 && (
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
