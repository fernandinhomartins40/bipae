import { formatBRL, cents } from '@bipae/domain';
import type { PdvService } from '@bipae/pdv-core';
import { Alert, Button, Modal, TextField } from '@bipae/ui';
import { useEffect, useState, type FormEvent } from 'react';

const brl = (value: number) => formatBRL(cents(value));

/** Há quanto tempo a comanda está aberta, em linguagem curta ("há 1 h 20 min"). */
export function openFor(openedAt: string, now = new Date()): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(openedAt).getTime()) / 60_000));
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `há ${hours} h${rest ? ` ${rest} min` : ''}`;
}

/** Valor por pessoa, com os centavos que sobram nas primeiras (a soma bate com o total). */
export function splitBill(totalCents: number, people: number): number[] {
  const n = Math.max(1, Math.floor(people));
  const base = Math.floor(totalCents / n);
  const rest = totalCents - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rest ? 1 : 0));
}

type TabRow = Awaited<ReturnType<PdvService['listTabs']>>[number];

/**
 * Comandas do caixa (F5-07): as abertas, com o valor e o tempo, e a abertura de uma nova pela mesa
 * ou pelo número. Abrir traz a comanda para o caixa; dali se lança mais itens, guarda ou fecha.
 */
export function TabsDialog({
  pdv,
  onOpen,
  onCancel,
  onClose,
}: {
  pdv: PdvService;
  onOpen: (tabId: string | null, label?: string) => Promise<void>;
  onCancel: (tab: TabRow) => Promise<void>;
  onClose: () => void;
}) {
  const [tabs, setTabs] = useState<TabRow[] | null>(null);
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reload = () => void pdv.listTabs().then(setTabs);
  useEffect(reload, [pdv]);

  const run = async (action: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Algo deu errado.');
      reload();
    } finally {
      setBusy(false);
    }
  };
  const create = (e: FormEvent) => {
    e.preventDefault();
    void run(() => onOpen(null, label));
  };

  return (
    <Modal mobileFullscreen open onOpenChange={(o) => !o && onClose()} title="Comandas" wide>
      <div className="flex flex-col gap-4">
        <form onSubmit={create} className="flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1">
            <TextField
              label="Nova comanda (mesa ou número)"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Mesa 5"
              autoFocus
            />
          </div>
          <Button type="submit" loading={busy} disabled={!label.trim()}>
            Abrir comanda
          </Button>
        </form>
        {error && <Alert>{error}</Alert>}
        {tabs && tabs.length === 0 && (
          <p className="text-muted">Nenhuma comanda aberta neste caixa.</p>
        )}
        {tabs && tabs.length > 0 && (
          <ul className="flex flex-col divide-y divide-border" aria-label="Comandas abertas">
            {tabs.map((tab) => (
              <li key={tab.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="flex flex-col">
                  <span className="font-semibold">{tab.label}</span>
                  <span className="text-sm text-muted">
                    {tab.items} {tab.items === 1 ? 'item' : 'itens'} · aberta{' '}
                    {openFor(tab.openedAt)}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-semibold tabular-nums">{brl(tab.totalCents)}</span>
                  <Button onClick={() => void run(() => onOpen(tab.id))} disabled={busy}>
                    Abrir
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => void run(() => onCancel(tab))}
                    disabled={busy}
                  >
                    Cancelar
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
