import { parseBRL, type CatalogProduct } from '@bipae/domain';
import { Alert, Button, Modal, TextField } from '@bipae/ui';
import { useState, type FormEvent } from 'react';
import type { QuickProductInput } from './backend';

/**
 * Cadastro rápido no caixa (MF-07): o operador bipou um código que não está cadastrado e tem
 * permissão de cadastrar. O catálogo pré-preenche o nome; o operador confere, põe o preço e salva.
 */
export function QuickProductDialog({
  code,
  catalog,
  onSave,
  onClose,
}: {
  code: string;
  catalog: CatalogProduct | null;
  onSave: (input: QuickProductInput) => Promise<void>;
  onClose: () => void;
}) {
  const found = catalog?.found ? catalog : null;
  const [name, setName] = useState(found?.description ?? '');
  const [price, setPrice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const priceCents = parseBRL(price);
    if (!name.trim()) return setError('Informe o nome do produto.');
    if (priceCents === null || priceCents <= 0) return setError('Informe o preço de venda.');
    setBusy(true);
    setError(null);
    try {
      await onSave({
        name: name.trim(),
        barcodes: [code],
        unit: found?.unit ?? 'UN',
        priceCents,
        isWeighable: found?.weighable === true,
        ncm: found?.ncm ?? null,
        cest: found?.cest ?? null,
        catalog: found
          ? {
              brand: found.brand ?? null,
              manufacturer: found.manufacturer ?? null,
              department: found.department ?? null,
              category: found.category ?? null,
              packageDescription: found.packageDescription ?? null,
              content: found.content ?? null,
              source: found.source ?? null,
            }
          : null,
        packs: found?.packs ?? [],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível cadastrar. Tente de novo.');
      setBusy(false);
    }
  };

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Cadastrar produto">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-muted">
          O código {code} não está cadastrado.
          {found
            ? ' Achamos no catálogo: confira o nome e informe o preço.'
            : ' Informe o nome e o preço.'}
        </p>
        {found && (
          <p className="text-sm">
            {[found.brand, found.packageDescription].filter(Boolean).join(' · ')}
          </p>
        )}
        {error && <Alert>{error}</Alert>}
        <TextField
          label="Nome do produto"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus={!found}
        />
        <TextField
          label="Preço de venda (R$)"
          inputMode="decimal"
          placeholder="0,00"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          autoFocus={!!found}
        />
        <div className="flex gap-2">
          <Button type="submit" loading={busy}>
            Cadastrar e vender
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
        </div>
      </form>
    </Modal>
  );
}
