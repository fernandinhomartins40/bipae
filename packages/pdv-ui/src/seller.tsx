import type { CartSeller } from '@bipae/pdv-core';
import { Button, cx, Modal, TextField } from '@bipae/ui';
import { useState, type FormEvent } from 'react';

const plain = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const noZeros = (code: string) => code.replace(/^0+(?=\d)/, '');

/** Quem casa com o que foi digitado: o código exato primeiro, depois pelo nome. */
export function matchSellers(sellers: CartSeller[], text: string): CartSeller[] {
  const typed = text.trim();
  if (!typed) return sellers;
  if (/^\d+$/.test(typed)) {
    return sellers.filter((s) => noZeros(s.code) === noZeros(typed));
  }
  const words = plain(typed).split(/\s+/);
  return sellers.filter((s) => words.every((w) => plain(s.name).includes(w)));
}

/**
 * Vendedor da venda (F8-01): o caixa digita o código ou o nome e confirma com Enter. A lista vem
 * do último retrato, então funciona sem internet.
 */
export function SellerDialog({
  sellers,
  current,
  onConfirm,
  onClose,
}: {
  sellers: CartSeller[];
  current: CartSeller | null;
  onConfirm: (seller: CartSeller | null) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const found = matchSellers(sellers, text);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (found.length === 1 || (found.length > 0 && text.trim())) return onConfirm(found[0]!);
    setError(
      text.trim() ? 'Nenhum vendedor com esse código ou nome.' : 'Digite o código ou o nome.',
    );
  };
  return (
    <Modal mobileFullscreen open onOpenChange={(o) => !o && onClose()} title="Vendedor da venda">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label="Código ou nome do vendedor"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          error={error}
          autoFocus
        />
        <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto" aria-label="Vendedores">
          {found.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onConfirm(s)}
                className={cx(
                  'flex min-h-11 w-full items-center justify-between rounded-ui border border-border px-3 text-left hover:bg-surface-2',
                  current?.id === s.id && 'border-primary font-semibold',
                )}
              >
                <span>{s.name}</span>
                <span className="tabular-nums text-muted">{s.code}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <Button type="submit">Confirmar</Button>
          {current && (
            <Button variant="secondary" onClick={() => onConfirm(null)}>
              Sem vendedor
            </Button>
          )}
        </div>
      </form>
    </Modal>
  );
}
