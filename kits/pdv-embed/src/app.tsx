import { isValidCnpj, isValidCpf, type PaymentMethod } from '@bipae/domain';
import {
  addItem,
  cashSuggestions,
  discountNeedsAuthorization,
  EMPTY_CART,
  parseScan,
  percentOf,
  removeLine,
  setQuantity,
  setSaleDiscount,
  summarizePayments,
  totals,
  type Cart,
  type CatalogItem,
  type TenderInput,
} from '@bipae/pdv-core/pure';
import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  PdvApiError,
  uuid,
  type CashClosing,
  type CashSession,
  type Me,
  type PdvApi,
  type Product,
  type Sale,
} from './api';
import { brl, methodLabel, printReceipt, quantity, time } from './format';

export interface PdvEvents {
  emit(
    name: 'sale' | 'sale-cancelled' | 'session-opened' | 'session-closed' | 'error',
    detail: unknown,
  ): void;
}

type Modal =
  | { kind: 'pay' }
  | { kind: 'discount' }
  | { kind: 'movement'; movement: 'withdrawal' | 'supply' }
  | { kind: 'close' }
  | { kind: 'closed'; closing: CashClosing }
  | { kind: 'sales' }
  | { kind: 'weight'; product: Product }
  | { kind: 'quantity'; line: number }
  | { kind: 'done'; sale: Sale };

const toCatalog = (p: Product): CatalogItem => ({
  id: p.id,
  name: p.name,
  unit: p.unit,
  priceCents: p.priceCents,
  isWeighable: p.weighable,
});

const message = (e: unknown) =>
  e instanceof Error ? e.message : 'Algo deu errado. Tente de novo.';

// ------------------------------------------------------------------ building blocks

function Dialog(props: {
  title: string;
  onClose?: () => void;
  children: ComponentChildren;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const first = ref.current?.querySelector<HTMLElement>(
      '[data-autofocus], input, button.primary',
    );
    first?.focus();
  }, []);
  return (
    <div
      class="overlay"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && props.onClose) {
          e.stopPropagation();
          props.onClose();
        }
      }}
    >
      <div
        ref={ref}
        class={`dialog${props.wide ? ' wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
      >
        <header class="dialog-head">
          <h2>{props.title}</h2>
          {props.onClose && (
            <button type="button" class="ghost icon" aria-label="Fechar" onClick={props.onClose}>
              ×
            </button>
          )}
        </header>
        {props.children}
      </div>
    </div>
  );
}

function MoneyInput(props: {
  label: string;
  value: number;
  onChange: (cents: number) => void;
  autofocus?: boolean;
}) {
  return (
    <label class="field">
      <span>{props.label}</span>
      <input
        inputMode="numeric"
        data-autofocus={props.autofocus ? '' : undefined}
        value={brl(props.value)}
        onInput={(e) => {
          const digits = (e.currentTarget as HTMLInputElement).value.replace(/\D/g, '').slice(-11);
          props.onChange(Number(digits || '0'));
        }}
        onFocus={(e) => (e.currentTarget as HTMLInputElement).select()}
      />
    </label>
  );
}

function Alert(props: { tone?: 'danger' | 'success' | 'info'; children: ComponentChildren }) {
  return (
    <div
      class={`alert ${props.tone ?? 'danger'}`}
      role={props.tone === 'danger' || !props.tone ? 'alert' : 'status'}
    >
      {props.children}
    </div>
  );
}

// ------------------------------------------------------------------ app

export function PdvApp({ api, events }: { api: PdvApi; events: PdvEvents }) {
  const [me, setMe] = useState<Me | null>(null);
  const [session, setSession] = useState<CashSession | null | undefined>(undefined);
  const [fatal, setFatal] = useState<string | null>(null);

  const load = useCallback(async () => {
    setFatal(null);
    try {
      const [m, s] = await Promise.all([api.me(), api.session()]);
      setMe(m);
      setSession(s);
    } catch (e) {
      setFatal(message(e));
      events.emit('error', { message: message(e) });
    }
  }, [api, events]);

  useEffect(() => {
    void load();
  }, [load]);

  if (fatal) {
    return (
      <div class="center">
        <div class="card narrow">
          <h2>Não foi possível abrir o caixa</h2>
          <Alert>{fatal}</Alert>
          <button type="button" class="primary" onClick={() => void load()}>
            Tentar de novo
          </button>
        </div>
      </div>
    );
  }
  if (!me || session === undefined) {
    return (
      <div class="center muted" role="status">
        Abrindo o caixa…
      </div>
    );
  }
  if (!session) {
    return (
      <OpenSession
        me={me}
        onOpen={async (cents) => {
          const s = await api.openSession(cents);
          setSession(s);
          events.emit('session-opened', s);
        }}
      />
    );
  }
  return <Register api={api} me={me} session={session} events={events} onSession={setSession} />;
}

function OpenSession({ me, onOpen }: { me: Me; onOpen: (cents: number) => Promise<void> }) {
  const [cents, setCents] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div class="center">
      <form
        class="card narrow"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await onOpen(cents);
          } catch (err) {
            setError(message(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <p class="eyebrow">{me.store.name}</p>
        <h2>Abrir o caixa</h2>
        <p class="muted">
          Olá, {me.operator.name.split(' ')[0]}! Quanto tem de troco na gaveta para começar?
        </p>
        {error && <Alert>{error}</Alert>}
        <MoneyInput label="Troco inicial" value={cents} onChange={setCents} autofocus />
        <button type="submit" class="primary big" disabled={busy}>
          {busy ? 'Abrindo…' : 'Abrir caixa'}
        </button>
      </form>
    </div>
  );
}

function Register(props: {
  api: PdvApi;
  me: Me;
  session: CashSession;
  events: PdvEvents;
  onSession: (s: CashSession | null) => void;
}) {
  const { api, me, events } = props;
  const [cart, setCart] = useState<Cart>(EMPTY_CART);
  const [modal, setModal] = useState<Modal | null>(null);
  const [notice, setNotice] = useState<{
    tone: 'danger' | 'success' | 'info';
    text: string;
  } | null>(null);
  const [scan, setScan] = useState('');
  const [results, setResults] = useState<Product[] | null>(null);
  const [busy, setBusy] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);
  const t = useMemo(() => totals(cart), [cart]);

  const focusScan = () => setTimeout(() => scanRef.current?.focus(), 0);
  const refreshSession = () =>
    api
      .session()
      .then(props.onSession)
      .catch(() => undefined);

  const add = (product: Product, quantityMilli = 1000) => {
    try {
      setCart((c) => addItem(c, toCatalog(product), quantityMilli));
      setNotice(null);
    } catch (e) {
      setNotice({ tone: 'danger', text: message(e) });
    }
    setResults(null);
    setScan('');
    focusScan();
  };

  const choose = (product: Product, quantityMilli: number, explicit: boolean) => {
    if (product.weighable && !explicit) setModal({ kind: 'weight', product });
    else add(product, quantityMilli);
  };

  const submitScan = async () => {
    const parsed = parseScan(scan);
    if (!parsed) return;
    setBusy(true);
    try {
      const explicit = /^\s*\d+(?:[.,]\d{1,3})?\s*[*xX]/.test(scan);
      if (parsed.kind === 'barcode' || parsed.kind === 'scale-label') {
        const code = parsed.kind === 'barcode' ? parsed.code : scan.trim();
        const found = await api.products({ barcode: code, limit: 2 });
        if (found.length === 1)
          return choose(
            found[0]!,
            parsed.kind === 'barcode' ? parsed.quantityMilli : 1000,
            explicit,
          );
        const byText = await api.products({ q: code, limit: 10 });
        if (byText.length === 1)
          return choose(
            byText[0]!,
            parsed.kind === 'barcode' ? parsed.quantityMilli : 1000,
            explicit,
          );
        if (byText.length === 0) {
          setNotice({ tone: 'danger', text: `Nenhum produto com o código ${code}.` });
          setScan('');
          return;
        }
        setResults(byText);
        return;
      }
      const found = await api.products({ q: parsed.text, limit: 12 });
      if (found.length === 0)
        setNotice({ tone: 'danger', text: `Nada encontrado para "${parsed.text}".` });
      else if (found.length === 1) choose(found[0]!, parsed.quantityMilli, explicit);
      else setResults(found);
    } catch (e) {
      setNotice({ tone: 'danger', text: message(e) });
    } finally {
      setBusy(false);
    }
  };

  // Shortcuts: F2 pay, F4 discount, F9 sales. Only when no dialog is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (modal) return;
      if (e.key === 'F2' && cart.lines.length > 0) {
        e.preventDefault();
        setModal({ kind: 'pay' });
      } else if (e.key === 'F4' && cart.lines.length > 0) {
        e.preventDefault();
        setModal({ kind: 'discount' });
      } else if (e.key === 'F9') {
        e.preventDefault();
        setModal({ kind: 'sales' });
      }
    };
    const root = scanRef.current?.getRootNode() as ShadowRoot | Document | undefined;
    const target = (root && 'host' in root ? root.host : document) as HTMLElement | Document;
    target.addEventListener('keydown', onKey as EventListener);
    return () => target.removeEventListener('keydown', onKey as EventListener);
  }, [modal, cart.lines.length]);

  const closeModal = () => {
    setModal(null);
    focusScan();
  };

  return (
    <div class="register">
      <header class="topbar">
        <div>
          <strong>{me.store.name}</strong>
          <span class="muted">
            {' '}
            · {me.operator.name} · caixa aberto às {time(props.session.openedAt)}
          </span>
        </div>
        <nav aria-label="Ações do caixa">
          <button type="button" class="ghost" onClick={() => setModal({ kind: 'sales' })}>
            Vendas <kbd>F9</kbd>
          </button>
          <button
            type="button"
            class="ghost"
            onClick={() => setModal({ kind: 'movement', movement: 'supply' })}
          >
            Suprimento
          </button>
          <button
            type="button"
            class="ghost"
            onClick={() => setModal({ kind: 'movement', movement: 'withdrawal' })}
          >
            Sangria
          </button>
          <button
            type="button"
            class="ghost"
            onClick={() =>
              cart.lines.length > 0
                ? setNotice({
                    tone: 'info',
                    text: 'Finalize ou limpe a venda atual antes de fechar o caixa.',
                  })
                : setModal({ kind: 'close' })
            }
          >
            Fechar caixa
          </button>
        </nav>
      </header>

      <div class="body">
        <section class="main">
          <form
            class="scan"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              void submitScan();
            }}
          >
            <label class="sr-only" for="bipae-scan">
              Bipe o código ou digite o nome do produto
            </label>
            <input
              id="bipae-scan"
              ref={scanRef}
              autoFocus
              autocomplete="off"
              placeholder="Bipe o código ou digite o nome (3*código multiplica)"
              value={scan}
              onInput={(e) => {
                setScan((e.currentTarget as HTMLInputElement).value);
                setResults(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setScan('');
                  setResults(null);
                }
              }}
            />
            <button type="submit" class="primary" disabled={busy || !scan.trim()}>
              {busy ? 'Buscando…' : 'Adicionar'}
            </button>
          </form>

          {results && (
            <ul class="results" aria-label="Produtos encontrados">
              {results.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => choose(p, 1000, false)}>
                    <span>
                      {p.name}
                      <small class="muted">
                        {p.barcode ? ` · ${p.barcode}` : p.sku ? ` · ${p.sku}` : ''}
                      </small>
                    </span>
                    <strong>
                      {brl(p.priceCents)}
                      {p.weighable ? `/${p.unit}` : ''}
                    </strong>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

          {cart.lines.length === 0 ? (
            <div class="empty">
              <p class="big-text">Caixa livre</p>
              <p class="muted">Bipe o primeiro produto para começar a venda.</p>
            </div>
          ) : (
            <table class="cart">
              <thead>
                <tr>
                  <th scope="col">Produto</th>
                  <th scope="col" class="num">
                    Qtd.
                  </th>
                  <th scope="col" class="num">
                    Total
                  </th>
                  <th scope="col">
                    <span class="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {cart.lines.map((l, i) => (
                  <tr key={l.line}>
                    <td>
                      {l.name}
                      <small class="muted">
                        {' '}
                        {brl(l.unitPriceCents)}
                        {l.isWeighable ? `/${l.unit}` : ''}
                      </small>
                    </td>
                    <td class="num">
                      <button
                        type="button"
                        class="link"
                        aria-label={`Alterar quantidade de ${l.name}`}
                        onClick={() => setModal({ kind: 'quantity', line: l.line })}
                      >
                        {quantity(l.quantityMilli, l.unit, l.isWeighable)}
                      </button>
                    </td>
                    <td class="num">{brl(t.items[i]!.grossCents)}</td>
                    <td class="actions">
                      <button
                        type="button"
                        class="ghost icon"
                        aria-label={`Remover ${l.name}`}
                        onClick={() => setCart((c) => removeLine(c, l.line))}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <aside class="side" aria-label="Total da venda">
          <dl class="totals">
            <div>
              <dt>Subtotal</dt>
              <dd>{brl(t.subtotalCents)}</dd>
            </div>
            {t.discountCents > 0 && (
              <div>
                <dt>Desconto</dt>
                <dd>-{brl(t.discountCents)}</dd>
              </div>
            )}
            <div class="grand">
              <dt>Total</dt>
              <dd data-testid="total">{brl(t.totalCents)}</dd>
            </div>
          </dl>
          <button
            type="button"
            class="primary big"
            disabled={cart.lines.length === 0}
            onClick={() => setModal({ kind: 'pay' })}
          >
            Pagar <kbd>F2</kbd>
          </button>
          <div class="row">
            <button
              type="button"
              class="secondary"
              disabled={cart.lines.length === 0}
              onClick={() => setModal({ kind: 'discount' })}
            >
              Desconto <kbd>F4</kbd>
            </button>
            <button
              type="button"
              class="secondary"
              disabled={cart.lines.length === 0}
              onClick={() => {
                setCart(EMPTY_CART);
                setNotice(null);
                focusScan();
              }}
            >
              Limpar venda
            </button>
          </div>
          <p class="muted small">
            {props.session.salesCount} venda(s) neste caixa · {brl(props.session.salesTotalCents)}
          </p>
        </aside>
      </div>

      {modal?.kind === 'weight' && (
        <WeightDialog
          product={modal.product}
          onClose={closeModal}
          onConfirm={(milli) => {
            setModal(null);
            add(modal.product, milli);
          }}
        />
      )}
      {modal?.kind === 'quantity' && (
        <QuantityDialog
          line={cart.lines.find((l) => l.line === modal.line)!}
          onClose={closeModal}
          onConfirm={(milli) => {
            try {
              setCart((c) => setQuantity(c, modal.line, milli));
            } catch (e) {
              setNotice({ tone: 'danger', text: message(e) });
            }
            closeModal();
          }}
        />
      )}
      {modal?.kind === 'discount' && (
        <DiscountDialog
          cart={cart}
          maxPercent={me.settings.maxDiscountPercent}
          onClose={closeModal}
          onApply={(next) => {
            setCart(next);
            closeModal();
          }}
        />
      )}
      {modal?.kind === 'pay' && (
        <PayDialog
          api={api}
          cart={cart}
          methods={me.settings.paymentMethods}
          onClose={closeModal}
          onPriceChanged={(productId, priceCents, text) => {
            setCart((c) => ({
              ...c,
              lines: c.lines.map((l) =>
                l.productId === productId ? { ...l, unitPriceCents: priceCents } : l,
              ),
            }));
            setModal(null);
            setNotice({ tone: 'danger', text });
          }}
          onDone={(sale) => {
            setCart(EMPTY_CART);
            setNotice(null);
            setModal({ kind: 'done', sale });
            events.emit('sale', sale);
            void refreshSession();
          }}
        />
      )}
      {modal?.kind === 'done' && <DoneDialog sale={modal.sale} me={me} onClose={closeModal} />}
      {modal?.kind === 'movement' && (
        <MovementDialog
          api={api}
          kind={modal.movement}
          onClose={closeModal}
          onDone={(text) => {
            setNotice({ tone: 'success', text });
            closeModal();
          }}
        />
      )}
      {modal?.kind === 'sales' && (
        <SalesDialog
          api={api}
          me={me}
          onClose={closeModal}
          onCancelled={(sale) => {
            events.emit('sale-cancelled', sale);
            void refreshSession();
          }}
        />
      )}
      {modal?.kind === 'close' && (
        <CloseDialog
          api={api}
          methods={me.settings.paymentMethods}
          onClose={closeModal}
          onClosed={(closing) => {
            events.emit('session-closed', closing);
            setModal({ kind: 'closed', closing });
          }}
        />
      )}
      {modal?.kind === 'closed' && (
        <ClosedDialog
          closing={modal.closing}
          methods={me.settings.paymentMethods}
          onDone={() => props.onSession(null)}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ dialogs

function parseKg(text: string): number {
  const value = Number(text.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(value) ? Math.round(value * 1000) : NaN;
}

function WeightDialog(props: {
  product: Product;
  onClose: () => void;
  onConfirm: (milli: number) => void;
}) {
  const [text, setText] = useState('');
  const milli = parseKg(text);
  const valid = Number.isInteger(milli) && milli > 0;
  return (
    <Dialog title={`Peso de ${props.product.name}`} onClose={props.onClose}>
      <form
        class="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) props.onConfirm(milli);
        }}
      >
        <label class="field">
          <span>Peso em {props.product.unit} (ex.: 1,255)</span>
          <input
            inputMode="decimal"
            data-autofocus
            value={text}
            onInput={(e) => setText((e.currentTarget as HTMLInputElement).value)}
          />
        </label>
        <p class="muted">
          {brl(props.product.priceCents)}/{props.product.unit}
          {valid && ` · ${brl(Math.floor((props.product.priceCents * milli + 500) / 1000))}`}
        </p>
        <button type="submit" class="primary" disabled={!valid}>
          Adicionar
        </button>
      </form>
    </Dialog>
  );
}

function QuantityDialog(props: {
  line: Cart['lines'][number];
  onClose: () => void;
  onConfirm: (milli: number) => void;
}) {
  const { line } = props;
  const [text, setText] = useState(String(line.quantityMilli / 1000).replace('.', ','));
  const milli = line.isWeighable ? parseKg(text) : Number(text) * 1000;
  const valid = Number.isInteger(milli) && milli > 0;
  return (
    <Dialog title={`Quantidade de ${line.name}`} onClose={props.onClose}>
      <form
        class="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) props.onConfirm(milli);
        }}
      >
        <label class="field">
          <span>
            {line.isWeighable ? `Peso em ${line.unit}` : 'Quantidade (unidades inteiras)'}
          </span>
          <input
            inputMode={line.isWeighable ? 'decimal' : 'numeric'}
            data-autofocus
            value={text}
            onInput={(e) => setText((e.currentTarget as HTMLInputElement).value)}
            onFocus={(e) => (e.currentTarget as HTMLInputElement).select()}
          />
        </label>
        <button type="submit" class="primary" disabled={!valid}>
          Confirmar
        </button>
      </form>
    </Dialog>
  );
}

function DiscountDialog(props: {
  cart: Cart;
  maxPercent: number;
  onClose: () => void;
  onApply: (c: Cart) => void;
}) {
  const subtotal = totals({ ...props.cart, saleDiscountCents: 0 }).subtotalCents;
  const [mode, setMode] = useState<'percent' | 'value'>('percent');
  const [percent, setPercent] = useState('');
  const [cents, setCents] = useState(props.cart.saleDiscountCents);
  const value =
    mode === 'percent' ? percentOf(subtotal, Number(percent.replace(',', '.')) || 0) : cents;
  let error: string | null = null;
  let next: Cart | null = null;
  try {
    next = setSaleDiscount(props.cart, value);
    if (discountNeedsAuthorization(next, props.maxPercent)) {
      error = `O limite deste caixa é ${props.maxPercent}% (${brl(percentOf(subtotal, props.maxPercent))}).`;
    }
  } catch (e) {
    error = message(e);
  }
  return (
    <Dialog title="Desconto na venda" onClose={props.onClose}>
      <form
        class="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (next && !error) props.onApply(next);
        }}
      >
        <div class="segmented" role="radiogroup" aria-label="Tipo de desconto">
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'percent'}
            onClick={() => setMode('percent')}
          >
            Em %
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'value'}
            onClick={() => setMode('value')}
          >
            Em R$
          </button>
        </div>
        {mode === 'percent' ? (
          <label class="field">
            <span>Percentual</span>
            <input
              inputMode="decimal"
              data-autofocus
              value={percent}
              onInput={(e) => setPercent((e.currentTarget as HTMLInputElement).value)}
            />
          </label>
        ) : (
          <MoneyInput label="Valor do desconto" value={cents} onChange={setCents} autofocus />
        )}
        <p class="muted">
          Desconto de {brl(value)} · total fica {brl(subtotal - value)}
        </p>
        {error && <Alert>{error}</Alert>}
        <button type="submit" class="primary" disabled={!!error}>
          Aplicar desconto
        </button>
      </form>
    </Dialog>
  );
}

function PayDialog(props: {
  api: PdvApi;
  cart: Cart;
  methods: PaymentMethod[];
  onClose: () => void;
  onDone: (sale: Sale) => void;
  onPriceChanged: (productId: string, priceCents: number, text: string) => void;
}) {
  const t = totals(props.cart);
  const [saleId] = useState(uuid);
  const [tenders, setTenders] = useState<TenderInput[]>([]);
  const [method, setMethod] = useState<PaymentMethod>(props.methods[0]!);
  const [amount, setAmount] = useState(t.totalCents);
  const [document, setDocument] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  // Tenders are validated when added (addTender), so this never throws here.
  const summary = summarizePayments(t.totalCents, tenders);
  const remaining = summary.remainingCents;
  const docDigits = document.replace(/\D/g, '');
  const docValid =
    docDigits === '' ||
    (docDigits.length === 11
      ? isValidCpf(docDigits)
      : docDigits.length === 14 && isValidCnpj(docDigits));

  const addTender = (m: PaymentMethod, cents: number) => {
    setError(null);
    if (cents <= 0) return;
    const next = [...tenders, { method: m, receivedCents: cents }];
    try {
      const s = summarizePayments(t.totalCents, next);
      setTenders(next);
      setAmount(s.remainingCents);
    } catch (e) {
      setError(message(e));
    }
  };

  const finish = async () => {
    setSending(true);
    setError(null);
    try {
      const sale = await props.api.createSale({
        id: saleId,
        items: t.items.map((i) => ({
          productId: i.productId,
          quantityMilli: i.quantityMilli,
          unitPriceCents: i.unitPriceCents,
          discountCents: i.discountCents,
        })),
        subtotalCents: t.subtotalCents,
        discountCents: t.discountCents,
        totalCents: t.totalCents,
        payments:
          summary.payments.length > 0
            ? summary.payments.map((p) => ({
                method: p.method,
                amountCents: p.amountCents,
                changeCents: p.changeCents,
              }))
            : [{ method: 'cash', amountCents: 0, changeCents: 0 }], // total zero (100% de desconto)
        customerDocument: docDigits || null,
      });
      props.onDone(sale);
    } catch (e) {
      if (e instanceof PdvApiError && e.code === 'price_changed' && e.details) {
        props.onPriceChanged(String(e.details.productId), Number(e.details.priceCents), e.message);
        return;
      }
      setError(message(e));
    } finally {
      setSending(false);
    }
  };

  // Paying a total of zero (100% discount with permission) needs one zero cash line.
  const zeroTotal = t.totalCents === 0;
  const ready = (remaining === 0 && tenders.length > 0) || zeroTotal;

  return (
    <Dialog title="Pagamento" onClose={sending ? undefined : props.onClose} wide>
      <div class="pay">
        <div class="stack">
          <p class="pay-total">
            Total <strong>{brl(t.totalCents)}</strong>
          </p>
          {remaining > 0 && (
            <>
              <div class="methods" role="radiogroup" aria-label="Forma de pagamento">
                {props.methods.map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={method === m}
                    onClick={() => setMethod(m)}
                  >
                    {methodLabel(m)}
                  </button>
                ))}
              </div>
              <form
                class="stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  addTender(method, amount);
                }}
              >
                <MoneyInput
                  label={method === 'cash' ? 'Valor recebido' : 'Valor'}
                  value={amount}
                  onChange={setAmount}
                  autofocus
                />
                {method === 'cash' && (
                  <div class="chips" aria-label="Valores rápidos">
                    {cashSuggestions(remaining).map((c) => (
                      <button
                        key={c}
                        type="button"
                        class="chip"
                        onClick={() => addTender('cash', c)}
                      >
                        {brl(c)}
                      </button>
                    ))}
                  </div>
                )}
                <button type="submit" class="secondary">
                  Lançar {methodLabel(method)}
                </button>
              </form>
            </>
          )}
        </div>
        <div class="stack">
          <ul class="tenders" aria-label="Pagamentos lançados">
            {summary.payments.map((p, i) => (
              <li key={i}>
                <span>{methodLabel(p.method)}</span>
                <strong>{brl(p.amountCents + p.changeCents)}</strong>
              </li>
            ))}
            {tenders.length === 0 && <li class="muted">Nenhum pagamento lançado.</li>}
          </ul>
          {tenders.length > 0 && remaining > 0 && (
            <button
              type="button"
              class="link"
              onClick={() => (setTenders([]), setAmount(t.totalCents))}
            >
              Refazer pagamentos
            </button>
          )}
          <dl class="totals">
            <div>
              <dt>Falta</dt>
              <dd>{brl(remaining)}</dd>
            </div>
            {summary.changeCents > 0 && (
              <div class="grand">
                <dt>Troco</dt>
                <dd data-testid="change">{brl(summary.changeCents)}</dd>
              </div>
            )}
          </dl>
          <label class="field">
            <span>CPF ou CNPJ na nota (opcional)</span>
            <input
              inputMode="numeric"
              value={document}
              onInput={(e) => setDocument((e.currentTarget as HTMLInputElement).value)}
            />
          </label>
          {!docValid && <Alert>CPF ou CNPJ inválido.</Alert>}
          {error && <Alert>{error}</Alert>}
          <button
            type="button"
            class="primary big"
            disabled={!ready || !docValid || sending}
            onClick={() => void finish()}
          >
            {sending ? 'Registrando…' : 'Concluir venda'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function DoneDialog(props: { sale: Sale; me: Me; onClose: () => void }) {
  const change = props.sale.payments.reduce((a, p) => a + p.changeCents, 0);
  return (
    <Dialog title={`Venda nº ${props.sale.number} registrada`} onClose={props.onClose}>
      <div class="stack center-text">
        {change > 0 ? (
          <p class="change">
            Troco <strong>{brl(change)}</strong>
          </p>
        ) : (
          <p class="change">
            <strong>Bipou? Bipaê!</strong>
          </p>
        )}
        <div class="row">
          <button
            type="button"
            class="secondary"
            onClick={() => printReceipt(props.sale, props.me)}
          >
            Imprimir comprovante
          </button>
          <button type="button" class="primary" data-autofocus onClick={props.onClose}>
            Nova venda
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function MovementDialog(props: {
  api: PdvApi;
  kind: 'withdrawal' | 'supply';
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const [id] = useState(uuid);
  const [cents, setCents] = useState(0);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const label = props.kind === 'withdrawal' ? 'Sangria' : 'Suprimento';
  return (
    <Dialog title={label} onClose={props.onClose}>
      <form
        class="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            await props.api.movement({
              id,
              kind: props.kind,
              amountCents: cents,
              reason: reason.trim(),
            });
            props.onDone(`${label} de ${brl(cents)} registrada.`);
          } catch (err) {
            setError(message(err));
          }
        }}
      >
        <p class="muted">
          {props.kind === 'withdrawal'
            ? 'Dinheiro retirado da gaveta (ex.: depósito no cofre).'
            : 'Dinheiro colocado na gaveta para troco.'}
        </p>
        <MoneyInput label="Valor" value={cents} onChange={setCents} autofocus />
        <label class="field">
          <span>Motivo</span>
          <input
            value={reason}
            maxLength={200}
            onInput={(e) => setReason((e.currentTarget as HTMLInputElement).value)}
          />
        </label>
        {error && <Alert>{error}</Alert>}
        <button type="submit" class="primary" disabled={cents <= 0 || !reason.trim()}>
          Registrar {label.toLowerCase()}
        </button>
      </form>
    </Dialog>
  );
}

function SalesDialog(props: {
  api: PdvApi;
  me: Me;
  onClose: () => void;
  onCancelled: (s: Sale) => void;
}) {
  const [sales, setSales] = useState<Sale[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<Sale | null>(null);
  const [reason, setReason] = useState('');
  const load = useCallback(() => {
    props.api.sales(30).then(setSales, (e) => setError(message(e)));
  }, [props.api]);
  useEffect(load, [load]);

  return (
    <Dialog title="Vendas deste caixa" onClose={props.onClose} wide>
      {error && <Alert>{error}</Alert>}
      {!sales && !error && <p class="muted">Carregando…</p>}
      {sales?.length === 0 && <p class="muted">Nenhuma venda ainda neste caixa.</p>}
      {cancelling ? (
        <form
          class="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            try {
              const sale = await props.api.cancelSale(cancelling.id, reason.trim());
              props.onCancelled(sale);
              setCancelling(null);
              setReason('');
              load();
            } catch (err) {
              setError(message(err));
            }
          }}
        >
          <p>
            Cancelar a venda nº {cancelling.number} de {brl(cancelling.totalCents)}? O estoque volta
            e o valor sai do caixa.
          </p>
          <label class="field">
            <span>Motivo do cancelamento</span>
            <input
              data-autofocus
              value={reason}
              onInput={(e) => setReason((e.currentTarget as HTMLInputElement).value)}
            />
          </label>
          <div class="row">
            <button type="button" class="secondary" onClick={() => setCancelling(null)}>
              Voltar
            </button>
            <button type="submit" class="danger" disabled={reason.trim().length < 3}>
              Cancelar venda
            </button>
          </div>
        </form>
      ) : (
        sales &&
        sales.length > 0 && (
          <table class="cart">
            <thead>
              <tr>
                <th scope="col">Nº</th>
                <th scope="col">Hora</th>
                <th scope="col" class="num">
                  Total
                </th>
                <th scope="col">
                  <span class="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sales.map((s) => (
                <tr key={s.id} class={s.status === 'cancelled' ? 'cancelled' : ''}>
                  <td>
                    {s.number}
                    {s.status === 'cancelled' && <span class="badge">cancelada</span>}
                  </td>
                  <td>{time(s.createdAt)}</td>
                  <td class="num">{brl(s.totalCents)}</td>
                  <td class="actions">
                    <button type="button" class="ghost" onClick={() => printReceipt(s, props.me)}>
                      Imprimir
                    </button>
                    {s.status === 'completed' && props.me.settings.canCancelSales && (
                      <button
                        type="button"
                        class="ghost danger-text"
                        onClick={() => setCancelling(s)}
                      >
                        Cancelar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}
    </Dialog>
  );
}

function CloseDialog(props: {
  api: PdvApi;
  methods: PaymentMethod[];
  onClose: () => void;
  onClosed: (c: CashClosing) => void;
}) {
  const [counted, setCounted] = useState<Partial<Record<PaymentMethod, number>>>({});
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  return (
    <Dialog title="Fechar o caixa" onClose={props.onClose}>
      <form
        class="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setSending(true);
          setError(null);
          try {
            props.onClosed(await props.api.closeSession(counted));
          } catch (err) {
            setError(message(err));
          } finally {
            setSending(false);
          }
        }}
      >
        <p class="muted">
          Conte o que tem em cada forma de pagamento. Os valores esperados só aparecem depois de
          confirmar (fechamento cego).
        </p>
        {props.methods.map((m, i) => (
          <MoneyInput
            key={m}
            label={m === 'cash' ? 'Dinheiro na gaveta' : `Total em ${methodLabel(m)}`}
            value={counted[m] ?? 0}
            onChange={(c) => setCounted((v) => ({ ...v, [m]: c }))}
            autofocus={i === 0}
          />
        ))}
        {error && <Alert>{error}</Alert>}
        <button type="submit" class="primary" disabled={sending}>
          {sending ? 'Fechando…' : 'Confirmar contagem e fechar'}
        </button>
      </form>
    </Dialog>
  );
}

function ClosedDialog(props: {
  closing: CashClosing;
  methods: PaymentMethod[];
  onDone: () => void;
}) {
  const d = props.closing.differenceCents;
  return (
    <Dialog title="Caixa fechado">
      <div class="stack">
        <table class="cart">
          <thead>
            <tr>
              <th scope="col">Forma</th>
              <th scope="col" class="num">
                Esperado
              </th>
              <th scope="col" class="num">
                Contado
              </th>
            </tr>
          </thead>
          <tbody>
            {props.methods.map((m) => (
              <tr key={m}>
                <td>{methodLabel(m)}</td>
                <td class="num">{brl(props.closing.expectedCents[m] ?? 0)}</td>
                <td class="num">{brl(props.closing.countedCents[m] ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Alert tone={d === 0 ? 'success' : 'danger'}>
          {d === 0
            ? 'Caixa batendo certinho!'
            : d > 0
              ? `Sobra de ${brl(d)}.`
              : `Falta de ${brl(-d)}.`}
        </Alert>
        <button type="button" class="primary" data-autofocus onClick={props.onDone}>
          Concluir
        </button>
      </div>
    </Dialog>
  );
}
