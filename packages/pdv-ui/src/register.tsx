import { formatTaxId } from '@bipae/domain';
import {
  addItem,
  buildReceipt,
  discountNeedsAuthorization,
  EMPTY_CART,
  encodeReceipt,
  parseScan,
  quantityFromLabelPrice,
  receiptToText,
  removeLine,
  SCALE_MESSAGES,
  setQuantity,
  setSaleDiscount,
  totals,
  type Cart,
  type CatalogProduct,
  type CloseResult,
  type Session,
  type StoredSale,
} from '@bipae/pdv-core';
import type { Platform } from '@bipae/platform';
import { describeLastSync, type SyncStatus } from '@bipae/sync';
import { Alert, Button, cx, Logo, parseDisplayPreferences, playBeep } from '@bipae/ui';
import { CloudOff, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AuthorizablePermission, PosBackend, PosUser } from './backend';
import {
  AuthorizeDialog,
  brl,
  CashDialog,
  CloseResultDialog,
  CustomerDialog,
  DiscountDialog,
  HistoryDialog,
  PaymentDialog,
  QuantityDialog,
  QuotesDialog,
} from './dialogs';
import type { RegisterHandle } from './use-register';

export const DISCOUNT_LIMIT_PERCENT = 10;

const SHORTCUTS = [
  ['F2', 'Buscar'],
  ['F3', 'Quantidade'],
  ['F4', 'Desconto'],
  ['F5', 'Salvar orçamento'],
  ['F6', 'CPF na nota'],
  ['F7', 'Orçamentos'],
  ['F8', 'Remover item'],
  ['F9', 'Caixa'],
  ['F10', 'Pagar'],
  ['F11', 'Vendas'],
  ['F12', 'Limpar venda'],
] as const;

type Dialog =
  | { kind: 'none' }
  | { kind: 'quantity'; line: number; title: string; unit: string; weighable: boolean }
  | { kind: 'weigh'; product: CatalogProduct }
  | { kind: 'discount' }
  | { kind: 'customer' }
  | { kind: 'payment' }
  | { kind: 'cash' }
  | { kind: 'closed'; result: CloseResult }
  | { kind: 'history' }
  | { kind: 'quotes' };

export function Register({
  handle,
  session,
  user,
  platform,
  backend,
  syncStatus,
  onSyncNow,
  onSessionClosed,
  onExit,
}: {
  handle: RegisterHandle;
  session: Session;
  user: PosUser;
  platform: Platform;
  backend: PosBackend;
  syncStatus: SyncStatus | null;
  onSyncNow: () => void;
  onSessionClosed: () => void;
  onExit: () => void;
}) {
  const { pdv, context } = handle;
  const [cart, setCartState] = useState<Cart>(EMPTY_CART);
  // Mirror updated synchronously on every change, so keyboard shortcuts always see the
  // latest cart even if React has not re-rendered yet (fast "scan + F-key").
  const cartRef = useRef<Cart>(EMPTY_CART);
  const setCart = useCallback((next: Cart | ((c: Cart) => Cart)) => {
    cartRef.current = typeof next === 'function' ? next(cartRef.current) : next;
    setCartState(cartRef.current);
  }, []);
  const [selected, setSelected] = useState<number | null>(null);
  const [input, setInput] = useState('');
  const [results, setResults] = useState<CatalogProduct[]>([]);
  const [message, setMessage] = useState<{ tone: 'danger' | 'success' | 'warning'; text: string } | null>(null);
  const [dialog, setDialog] = useState<Dialog>({ kind: 'none' });
  const [discountAuthorizedBy, setDiscountAuthorizedBy] = useState<string | null>(null);
  const [lastSale, setLastSale] = useState<StoredSale | null>(null);
  const [auth, setAuth] = useState<{ permission: AuthorizablePermission; resolve: (id: string | null) => void } | null>(null);
  const [beep, setBeep] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const t = useMemo(() => totals(cart), [cart]);
  const can = (p: string) => user.permissions.includes(p);

  const [caps, setCaps] = useState<Awaited<ReturnType<Platform['capabilities']>> | null>(null);
  useEffect(() => {
    void platform.preferences.get('bipae.display').then((raw) => setBeep(parseDisplayPreferences(raw).beep));
    void platform.capabilities().then(setCaps);
  }, [platform]);

  const focusInput = () => setTimeout(() => inputRef.current?.focus(), 0);
  const fail = (error: unknown) =>
    setMessage({ tone: 'danger', text: error instanceof Error ? error.message : 'Algo deu errado.' });

  const requestAuthorization = useCallback(
    (permission: AuthorizablePermission) => new Promise<string | null>((resolve) => setAuth({ permission, resolve })),
    [],
  );

  const add = (product: CatalogProduct, quantityMilli: number) => {
    try {
      const next = addItem(cartRef.current, product, quantityMilli);
      setCart(next);
      setSelected(next.lines.at(-1)?.line ?? null);
      setMessage(null);
      setResults([]);
      setLastSale(null);
    } catch (error) {
      fail(error);
    }
  };

  const readScale = platform.scale && caps?.scale.available
    ? async () => {
        const reading = await platform.scale!.read();
        if (!reading.stable) throw new Error(SCALE_MESSAGES.unstable);
        return reading.grams;
      }
    : undefined;

  // A scan is async (local database lookup). Shortcuts pressed meanwhile wait for it.
  const pendingScan = useRef<Promise<void> | null>(null);
  const scanNow = () => {
    const run = handleScan().finally(() => {
      if (pendingScan.current === run) pendingScan.current = null;
    });
    pendingScan.current = run;
    return run;
  };

  const handleScan = async () => {
    const text = input;
    setInput('');
    const scan = parseScan(text);
    if (!scan) return;
    const explicitQuantity = /^\d+(?:[.,]\d{1,3})?\s*[*xX]/.test(text.trim());
    try {
      if (scan.kind === 'scale-label') {
        const product = await pdv.findByPlu(scan.plu);
        if (!product) return fail(new Error(`Etiqueta de balança com código ${scan.plu} não encontrado.`));
        const quantity = scan.quantityMilli ?? quantityFromLabelPrice(scan.totalCents!, product.priceCents);
        return add(product, quantity);
      }
      if (scan.kind === 'barcode') {
        const product = await pdv.findByCode(scan.code);
        if (!product) return fail(new Error(`Código ${scan.code} não encontrado. Confira ou busque pelo nome.`));
        if (product.isWeighable && !explicitQuantity) return setDialog({ kind: 'weigh', product });
        return add(product, scan.quantityMilli);
      }
      const found = await pdv.search(scan.text);
      if (found.length === 0) return fail(new Error(`Nada encontrado para "${scan.text}".`));
      if (found.length === 1) {
        if (found[0]!.isWeighable && !explicitQuantity) return setDialog({ kind: 'weigh', product: found[0]! });
        return add(found[0]!, scan.quantityMilli);
      }
      setResults(found);
    } catch (error) {
      fail(error);
    }
  };

  const applyDiscount = async (cents: number) => {
    try {
      const next = setSaleDiscount(cartRef.current, cents);
      let by: string | null = null;
      if (discountNeedsAuthorization(next, DISCOUNT_LIMIT_PERCENT)) {
        by = can('pos.discount.above_limit') ? user.id : await requestAuthorization('pos.discount.above_limit');
        if (!by) return fail(new Error('Desconto não autorizado.'));
      }
      setCart(next);
      setDiscountAuthorizedBy(by);
      setDialog({ kind: 'none' });
    } catch (error) {
      fail(error);
    }
  };

  const print = async (sale: StoredSale) => {
    if (!platform.printer) return fail(new Error('Nenhuma impressora disponível neste aparelho.'));
    const caps = await platform.capabilities();
    const columns = 48;
    const blocks = buildReceipt(
      sale,
      { businessName: context.businessName, taxId: context.taxId, terminalName: context.terminal.name, operatorName: user.name },
      columns,
    );
    try {
      if (caps.printer.available && caps.printer.via === 'browser') {
        await platform.printer.print({ kind: 'text', data: receiptToText(blocks, columns) });
      } else {
        await platform.printer.print({ kind: 'escpos', data: encodeReceipt(blocks) });
      }
    } catch (error) {
      fail(error);
    }
  };

  const pay = async (tenders: Parameters<typeof pdv.completeSale>[1]) => {
    const sale = await pdv.completeSale(cart, tenders, {
      discountLimitPercent: DISCOUNT_LIMIT_PERCENT,
      discountAuthorizedBy,
    });
    playBeep(beep);
    setLastSale(sale);
    setCart(EMPTY_CART);
    setSelected(null);
    setDiscountAuthorizedBy(null);
    setDialog({ kind: 'none' });
    const change = sale.payments.reduce((a, p) => a + p.changeCents, 0);
    setMessage({
      tone: 'success',
      text: `Bipaê! Venda nº ${sale.terminalSeq} concluída.${change > 0 ? ` Troco: ${brl(change)}.` : ''}`,
    });
    if (platform.cashDrawer && caps?.cashDrawer.available && sale.payments.some((p) => p.method === 'cash')) {
      void platform.cashDrawer.open().catch(() => undefined);
    }
    onSyncNow();
    focusInput();
  };

  const onKeyDown = (e: globalThis.KeyboardEvent) => {
    const cart = cartRef.current;
    if (dialog.kind !== 'none' || auth) return;
    const actions: Record<string, () => void> = {
      F2: () => inputRef.current?.focus(),
      F3: () => {
        const line = cart.lines.find((l) => l.line === selected);
        if (line) setDialog({ kind: 'quantity', line: line.line, title: line.name, unit: line.unit, weighable: line.isWeighable });
      },
      F4: () => cart.lines.length > 0 && setDialog({ kind: 'discount' }),
      F5: () =>
        void pdv
          .saveQuote(cart)
          .then(() => {
            setCart(EMPTY_CART);
            setMessage({ tone: 'success', text: 'Orçamento salvo. Abra com F7.' });
          })
          .catch(fail),
      F6: () => setDialog({ kind: 'customer' }),
      F7: () => setDialog({ kind: 'quotes' }),
      F8: () => {
        if (selected === null) return;
        setCart((c) => removeLine(c, selected));
        setSelected(null);
      },
      F9: () => setDialog({ kind: 'cash' }),
      F10: () => cart.lines.length > 0 && setDialog({ kind: 'payment' }),
      F11: () => setDialog({ kind: 'history' }),
      F12: () => {
        if (cart.lines.length > 0 && confirm('Limpar todos os itens desta venda?')) setCart(EMPTY_CART);
      },
      ArrowUp: () => {
        const i = cart.lines.findIndex((l) => l.line === selected);
        setSelected(cart.lines[Math.max(0, i - 1)]?.line ?? null);
      },
      ArrowDown: () => {
        const i = cart.lines.findIndex((l) => l.line === selected);
        setSelected(cart.lines[Math.min(cart.lines.length - 1, i + 1)]?.line ?? null);
      },
    };
    const action = actions[e.key];
    if (action) {
      e.preventDefault();
      action();
    }
  };

  // Shortcuts work wherever the focus is (e.g. after a dialog closes), not only inside the screen.
  // Layout effect: updated right after each render, before the next key can arrive, so a
  // fast "scan + F10" never sees the previous (empty) cart.
  const keyHandler = useRef(onKeyDown);
  useLayoutEffect(() => {
    keyHandler.current = onKeyDown;
  });
  useEffect(() => {
    const listener = (e: globalThis.KeyboardEvent) => {
      const pending = pendingScan.current;
      if (pending && /^Fd+$/.test(e.key)) {
        e.preventDefault();
        // The cart ref is updated synchronously by the scan, so the key sees the new item.
        void pending.then(() => keyHandler.current(e));
        return;
      }
      keyHandler.current(e);
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  const closeDialog = () => {
    setDialog({ kind: 'none' });
    focusInput();
  };

  return (
    <div className="flex h-screen flex-col bg-bg">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-4 py-2">
        <div className="flex items-center gap-3">
          <Logo className="text-xl" />
          <span className="font-semibold">{context.terminal.name}</span>
          <span className="text-sm text-muted">· {user.name}</span>
        </div>
        <div className="flex items-center gap-3">
          <SyncBadge status={syncStatus} onSync={onSyncNow} />
          <Button variant="ghost" onClick={onExit}>
            Sair do caixa
          </Button>
        </div>
      </header>
      {!handle.persistent && (
        <Alert tone="warning">
          Este navegador não guarda dados no aparelho. Sem internet, as vendas podem ser perdidas se a página fechar. Use o Chrome ou o Edge atualizados, ou o Bipaê Desktop.
        </Alert>
      )}

      <div className="grid flex-1 gap-4 overflow-hidden p-4 lg:grid-cols-[1fr_380px]">
        <section className="flex min-h-0 flex-col gap-3" aria-label="Itens da venda">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void scanNow();
            }}
          >
            <label htmlFor="pdv-input" className="sr-only">
              Bipe o código ou digite o nome do produto
            </label>
            <input
              id="pdv-input"
              ref={inputRef}
              autoFocus
              autoComplete="off"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Bipe o código ou digite o nome (ex.: 3*arroz)"
              className="min-h-16 w-full rounded-ui border-2 border-primary bg-surface px-4 text-2xl"
            />
          </form>
          {message && <Alert tone={message.tone}>{message.text}</Alert>}
          {results.length > 0 && (
            <ul className="max-h-60 overflow-y-auto rounded-ui border border-border bg-surface" aria-label="Resultados da busca">
              {results.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="flex w-full justify-between gap-3 px-4 py-3 text-left hover:bg-surface-2"
                    onClick={() => (p.isWeighable ? setDialog({ kind: 'weigh', product: p }) : add(p, 1000))}
                  >
                    <span>{p.name}</span>
                    <span className="tabular-nums">
                      {brl(p.priceCents)}
                      {p.isWeighable ? '/kg' : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto rounded-ui border border-border bg-surface">
            {cart.lines.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-muted">
                <p className="text-lg font-semibold text-text">Caixa livre</p>
                <p>Bipe o primeiro produto. Bipou? Bipaê!</p>
              </div>
            ) : (
              <table className="w-full text-left">
                <caption className="sr-only">Itens da venda</caption>
                <thead className="sticky top-0 bg-surface-2 text-sm text-muted">
                  <tr>
                    <th scope="col" className="px-3 py-2">#</th>
                    <th scope="col" className="px-3 py-2">Produto</th>
                    <th scope="col" className="px-3 py-2 text-right">Qtd.</th>
                    <th scope="col" className="px-3 py-2 text-right">Preço</th>
                    <th scope="col" className="px-3 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {t.items.map((item) => (
                    <tr
                      key={item.line}
                      aria-selected={selected === item.line}
                      onClick={() => setSelected(item.line)}
                      className={cx('cursor-pointer border-t border-border', selected === item.line && 'bg-warning-soft')}
                    >
                      <td className="px-3 py-2 text-muted">{item.line}</td>
                      <td className="px-3 py-2 font-medium">{item.name}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {(item.quantityMilli / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} {item.unit}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{brl(item.unitPriceCents)}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">{brl(item.totalCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <aside className="flex flex-col gap-3" aria-label="Resumo">
          <div className="rounded-ui bg-primary p-5 text-primary-contrast">
            <p className="text-sm font-semibold uppercase tracking-wide opacity-90">Total</p>
            <p className="text-5xl font-extrabold tabular-nums" aria-live="polite" data-testid="pdv-total">
              {brl(t.totalCents)}
            </p>
            {t.discountCents > 0 && <p className="mt-1">Descontos: {brl(t.discountCents)}</p>}
            <p className="mt-1 text-sm opacity-90">{cart.lines.length} itens</p>
          </div>
          {cart.customerTaxId && <p className="text-sm">CPF/CNPJ na nota: {formatTaxId(cart.customerTaxId)}</p>}
          <Button size="lg" onClick={() => setDialog({ kind: 'payment' })} disabled={cart.lines.length === 0} aria-keyshortcuts="F10">
            Pagar (F10)
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => setDialog({ kind: 'discount' })} disabled={cart.lines.length === 0}>
              Desconto (F4)
            </Button>
            <Button variant="secondary" onClick={() => setDialog({ kind: 'customer' })}>
              CPF na nota (F6)
            </Button>
            <Button variant="secondary" onClick={() => setDialog({ kind: 'cash' })}>
              Caixa (F9)
            </Button>
            <Button variant="secondary" onClick={() => setDialog({ kind: 'history' })}>
              Vendas (F11)
            </Button>
          </div>
          {lastSale && (
            <Button variant="ghost" onClick={() => void print(lastSale)}>
              Imprimir comprovante da venda nº {lastSale.terminalSeq}
            </Button>
          )}
        </aside>
      </div>

      <footer className="hidden flex-wrap gap-x-4 gap-y-1 border-t border-border bg-surface px-4 py-2 text-sm text-muted md:flex" aria-label="Atalhos do teclado">
        {SHORTCUTS.map(([key, label]) => (
          <span key={key}>
            <kbd className="rounded border border-border bg-surface-2 px-1.5 font-mono text-text">{key}</kbd> {label}
          </span>
        ))}
      </footer>

      {dialog.kind === 'weigh' && (
        <QuantityDialog
          title={dialog.product.name}
          unit={dialog.product.unit}
          weighable
          {...(readScale && { onReadScale: readScale })}
          onConfirm={(q) => {
            add(dialog.product, q);
            closeDialog();
          }}
          onClose={closeDialog}
        />
      )}
      {dialog.kind === 'quantity' && (
        <QuantityDialog
          title={dialog.title}
          unit={dialog.unit}
          weighable={dialog.weighable}
          onConfirm={(q) => {
            try {
              setCart((c) => setQuantity(c, dialog.line, q));
            } catch (error) {
              fail(error);
            }
            closeDialog();
          }}
          onClose={closeDialog}
        />
      )}
      {dialog.kind === 'discount' && (
        <DiscountDialog
          subtotalCents={t.subtotalCents - t.itemDiscountCents}
          limitPercent={DISCOUNT_LIMIT_PERCENT}
          canExceed={can('pos.discount.above_limit')}
          onConfirm={(c) => void applyDiscount(c)}
          onClose={closeDialog}
        />
      )}
      {dialog.kind === 'customer' && (
        <CustomerDialog
          current={cart.customerTaxId}
          onConfirm={(taxId) => {
            setCart((c) => ({ ...c, customerTaxId: taxId }));
            closeDialog();
          }}
          onClose={closeDialog}
        />
      )}
      {dialog.kind === 'payment' && <PaymentDialog totalCents={t.totalCents} onPaid={pay} onClose={closeDialog} />}
      {dialog.kind === 'cash' && (
        <CashDialog
          pdv={pdv}
          canWithdraw={can('pos.cash.withdrawal')}
          requestAuthorization={requestAuthorization}
          onClosed={(result) => setDialog({ kind: 'closed', result })}
          onClose={closeDialog}
        />
      )}
      {dialog.kind === 'closed' && (
        <CloseResultDialog
          result={dialog.result}
          onClose={() => {
            setDialog({ kind: 'none' });
            onSyncNow();
            onSessionClosed();
          }}
        />
      )}
      {dialog.kind === 'history' && (
        <HistoryDialog
          pdv={pdv}
          sessionId={session.id}
          canCancel={can('pos.sale.cancel')}
          requestAuthorization={requestAuthorization}
          onReprint={(s) => void print(s)}
          onClose={closeDialog}
        />
      )}
      {dialog.kind === 'quotes' && (
        <QuotesDialog
          pdv={pdv}
          onLoad={(id) =>
            void pdv
              .loadQuote(id)
              .then((c) => {
                setCart(c);
                closeDialog();
              })
              .catch(fail)
          }
          onClose={closeDialog}
        />
      )}
      {auth && (
        <AuthorizeDialog
          permission={auth.permission}
          backend={backend}
          onAuthorized={(id) => {
            auth.resolve(id);
            setAuth(null);
            focusInput();
          }}
          onClose={() => {
            auth.resolve(null);
            setAuth(null);
            focusInput();
          }}
        />
      )}
    </div>
  );
}

function SyncBadge({ status, onSync }: { status: SyncStatus | null; onSync: () => void }) {
  if (!status) return null;
  const offline = status.lastError !== null;
  return (
    <button
      type="button"
      onClick={onSync}
      className={cx(
        'flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold',
        offline ? 'bg-warning-soft text-text' : 'bg-success-soft text-success',
      )}
      title={status.lastError ?? 'Sincronizar agora'}
      data-testid="sync-status"
    >
      {offline ? <CloudOff className="size-4" aria-hidden /> : <RefreshCw className={cx('size-4', status.syncing && 'animate-spin')} aria-hidden />}
      {offline ? 'Sem conexão' : describeLastSync(status.lastSyncAt)}
      {status.pending > 0 && ` · ${status.pending} para enviar`}
    </button>
  );
}

