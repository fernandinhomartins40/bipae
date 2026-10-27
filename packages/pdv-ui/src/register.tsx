import {
  formatTaxId,
  maxRedeem,
  type CatalogProduct as CatalogEntry,
  type TerminalPaymentSettings,
} from '@bipae/domain';
import {
  addItem,
  buildDanfeNfce,
  buildReceipt,
  danfeNfceFromXml,
  discountNeedsAuthorization,
  EMPTY_CART,
  encodeReceipt,
  parseScan,
  quantityFromLabelPrice,
  receiptToHtml,
  receiptToText,
  removeLine,
  SCALE_MESSAGES,
  setQuantity,
  setLineDiscount,
  setSaleDiscount,
  totals,
  localDay,
  withPromotions,
  type Cart,
  type CartSeller,
  type CatalogProduct,
  type Promotion,
  type CloseResult,
  type Session,
  type StoredSale,
  repriceLines,
  type PdvService,
} from '@bipae/pdv-core';
import type { Platform, UpdateInfo } from '@bipae/platform';
import { useTefDriver } from './tef-screen';
import { describeLastSync, type SyncStatus } from '@bipae/sync';
import { Alert, Button, cx, Logo, parseDisplayPreferences, playBeep } from '@bipae/ui';
import {
  CloudOff,
  Ellipsis,
  Hash,
  History,
  Percent,
  RefreshCw,
  ScanBarcode,
  Trash2,
  Truck,
  UserRound,
  Users,
  UtensilsCrossed,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AuthorizablePermission, PosBackend, PosUser } from './backend';
import {
  AuthorizeDialog,
  OperatorDialog,
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
import { QuickProductDialog } from './quick-product';
import { splitBill, TabsDialog } from './tabs';
import { DeliveryDialog } from './delivery';
import { SellerDialog } from './seller';
import { CameraScanButton } from './camera-scan';
import {
  enterFullscreen,
  exitFullscreen,
  useAppViewport,
  useCompactLayout,
  useFullscreenOnFirstTouch,
  useFullscreenState,
} from './app-screen';
import {
  ActionSheet,
  CompactRegister,
  SaleList,
  SheetAction,
  SheetSection,
} from './compact-register';
import {
  ActionTile,
  CategoryTabs,
  EmptySale,
  GuideTip,
  LastItem,
  ModeSwitch,
  PayButton,
  ProductGrid,
  ProductThumb,
  SaleSuccess,
  SearchResults,
  type SaleLineView,
  type TileTone,
} from './register-parts';
import {
  layoutPrefKey,
  playSuccessSound,
  prefersReducedMotion,
  REGISTER_MODES,
  SUCCESS_SOUND_PREF,
  TIPS_PREF,
  usePreference,
  type RegisterMode,
} from './register-prefs';
import {
  loadSelfCheckout,
  newSelfCheckout,
  PinDialog,
  SELF_CHECKOUT_PREF,
  type SelfCheckoutState,
} from './self-checkout';
import type { RegisterHandle } from './use-register';

export /** O que dizer ao operador quando a nota ainda não pode sair como cupom fiscal (F3-14.c). */
const FISCAL_NOTICE: Record<string, string> = {
  pending: 'A NFC-e desta venda ainda está na fila. Saiu o comprovante simples.',
  error: 'A SEFAZ não respondeu ainda; a NFC-e será enviada de novo. Saiu o comprovante simples.',
  not_configured:
    'A NFC-e não foi emitida: falta configurar dados fiscais na retaguarda. Saiu o comprovante simples.',
  rejected:
    'A SEFAZ recusou a NFC-e desta venda; veja o motivo na retaguarda. Saiu o comprovante simples.',
  denied: 'A SEFAZ denegou a NFC-e desta venda. Saiu o comprovante simples.',
};

const DISCOUNT_LIMIT_PERCENT = 10;

/** Quantos produtos a grade mostra de cada vez; o resto se acha pela busca. */
const GRID_LIMIT = 60;
/** Espera depois da última tecla antes de buscar pelo nome enquanto se digita. */
const LIVE_SEARCH_MS = 180;

const qty = (milli: number, unit: string) =>
  `${(milli / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${unit}`;

/** De quanto em quanto tempo o caixa pergunta se há versão nova (F2-09). */
const UPDATE_CHECK_MS = 60_000;

type Dialog =
  | { kind: 'none' }
  | { kind: 'quantity'; line: number; title: string; unit: string; weighable: boolean }
  | { kind: 'weigh'; product: CatalogProduct }
  | { kind: 'discount'; line: number | null }
  | { kind: 'customer' }
  | { kind: 'payment' }
  | { kind: 'cash' }
  | { kind: 'closed'; result: CloseResult }
  | { kind: 'history' }
  | { kind: 'quotes' }
  | { kind: 'quick-product'; code: string; catalog: CatalogEntry | null }
  | { kind: 'operator' }
  | { kind: 'tabs' }
  | { kind: 'delivery' }
  | { kind: 'seller' };

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
  onSyncNow: () => Promise<void> | void;
  onSessionClosed: () => void;
  onExit: () => void;
}) {
  const { pdv, context } = handle;
  const [cart, setCartState] = useState<Cart>(EMPTY_CART);
  // Mirror updated synchronously on every change, so keyboard shortcuts always see the
  // latest cart even if React has not re-rendered yet (fast "scan + F-key").
  const cartRef = useRef<Cart>(EMPTY_CART);
  // Venda concluída na tela (F8-15): some quando a próxima venda ganha o primeiro item.
  const [celebrate, setCelebrate] = useState(false);
  const setCart = useCallback((next: Cart | ((c: Cart) => Cart)) => {
    cartRef.current = typeof next === 'function' ? next(cartRef.current) : next;
    setCartState(cartRef.current);
    if (cartRef.current.lines.length > 0) setCelebrate(false);
  }, []);
  const [selected, setSelected] = useState<number | null>(null);
  const [input, setInput] = useState('');
  const [results, setResults] = useState<CatalogProduct[]>([]);
  const [message, setMessage] = useState<{
    tone: 'danger' | 'success' | 'warning';
    text: string;
  } | null>(null);
  // Venda em andamento guardada no aparelho (PIE R2-02): recarregar a página, fechar a aba ou
  // faltar luz não perde os itens; ao voltar, a venda reaparece sozinha.
  const [draftLoaded, setDraftLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    void pdv
      .loadDraft()
      .then((draft) => {
        if (!alive) return;
        if (draft && cartRef.current.lines.length === 0) {
          setCart(draft);
          setMessage({ tone: 'success', text: 'A venda que estava em andamento foi recuperada.' });
        }
      })
      .catch(() => undefined)
      .finally(() => alive && setDraftLoaded(true));
    return () => {
      alive = false;
    };
  }, [pdv, setCart]);
  useEffect(() => {
    if (draftLoaded) void pdv.saveDraft(cart).catch(() => undefined);
  }, [cart, draftLoaded, pdv]);
  const [dialog, setDialog] = useState<Dialog>({ kind: 'none' });
  // Celular e tablet em pé (F8-14): tela inteira, sem rolar a página, ações numa folha.
  const compact = useCompactLayout();
  useAppViewport(compact);
  useFullscreenOnFirstTouch(compact);
  const fullscreen = useFullscreenState();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [discountAuthorizedBy, setDiscountAuthorizedBy] = useState<string | null>(null);
  const [lastSale, setLastSale] = useState<StoredSale | null>(null);
  const [auth, setAuth] = useState<{
    permission: AuthorizablePermission;
    resolve: (id: string | null) => void;
  } | null>(null);
  const [beep, setBeep] = useState(true);
  // Crediário do cliente da venda (F2-02), lido do banco local quando o pagamento abre.
  const [creditInfo, setCreditInfo] = useState<{ availableCents: number } | null>(null);
  const customerTaxId = cart.customerTaxId;
  useEffect(() => {
    if (dialog.kind !== 'payment' || !customerTaxId) return;
    let alive = true;
    void pdv.creditAvailable(customerTaxId).then((info) => {
      if (alive) setCreditInfo(info);
    });
    return () => {
      alive = false;
    };
  }, [dialog.kind, customerTaxId, pdv]);
  const inputRef = useRef<HTMLInputElement>(null);
  // Atualização entre vendas (F2-09): o caixa pergunta de tempos em tempos e só oferece com o
  // carrinho vazio; o atualizador recusa instalar no meio de uma venda.
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [updating, setUpdating] = useState(false);
  useEffect(() => {
    const updater = platform.updater;
    if (!updater) return;
    const check = () =>
      void updater
        .check()
        .then(setUpdate)
        .catch(() => undefined);
    check();
    const timer = setInterval(check, UPDATE_CHECK_MS);
    return () => clearInterval(timer);
  }, [platform]);
  // Promoções do último retrato de preços (F5-02): recarregam a cada sincronização.
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  useEffect(() => {
    let alive = true;
    void pdv.promotions().then((list) => alive && setPromotions(list));
    return () => {
      alive = false;
    };
  }, [pdv, syncStatus?.lastSyncAt]);
  const priced = useMemo(
    () => withPromotions(cart, promotions, localDay(new Date())),
    [cart, promotions],
  );
  const t = useMemo(() => totals(priced), [priced]);
  // Quem está operando agora (F2-03): começa com quem abriu o caixa e muda na troca de operador.
  const [operator, setOperator] = useState<Pick<PosUser, 'id' | 'name' | 'permissions'>>(user);
  const can = (p: string) => operator.permissions.includes(p);

  // Preferências deste aparelho (F8-15): modo de tela por caixa, dicas vistas e o som.
  const modePref = usePreference<RegisterMode>(
    platform,
    layoutPrefKey(context.terminal.id),
    'spotlight',
    ['spotlight', 'grid'],
  );
  const mode = modePref.value;
  const tipsPref = usePreference(platform, TIPS_PREF, 'new', ['new', 'seen'] as const);
  const soundPref = usePreference(platform, SUCCESS_SOUND_PREF, 'off', ['off', 'on'] as const);
  const soundOn = soundPref.value === 'on';

  // Grade de produtos (F8-15): abas das categorias e os produtos da aba, do banco do caixa.
  const [category, setCategory] = useState<string | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [gridProducts, setGridProducts] = useState<CatalogProduct[]>([]);
  useEffect(() => {
    if (mode !== 'grid') return;
    let alive = true;
    void pdv.categories().then((list) => {
      if (!alive) return;
      setCategories(list);
      setCategory((c) => (c !== null && !list.includes(c) ? null : c));
    });
    return () => {
      alive = false;
    };
  }, [mode, pdv, syncStatus?.lastSyncAt]);
  useEffect(() => {
    if (mode !== 'grid') return;
    let alive = true;
    void pdv
      .browse(category, GRID_LIMIT, cart.customerTaxId)
      .then((list) => alive && setGridProducts(list));
    return () => {
      alive = false;
    };
  }, [mode, category, pdv, cart.customerTaxId, syncStatus?.lastSyncAt]);
  // Fotos dos itens da venda (F2-14): o hash vem do catálogo local, sem rede.
  const [lineImages, setLineImages] = useState<Map<string, string>>(() => new Map());
  const lineProductIds = cart.lines.map((l) => l.productId).join(',');
  useEffect(() => {
    let alive = true;
    void pdv
      .imageHashes(lineProductIds ? lineProductIds.split(',') : [])
      .then((map) => alive && setLineImages(map))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [pdv, lineProductIds, syncStatus?.lastSyncAt]);
  const inCart = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of cart.lines)
      map.set(l.productId, (map.get(l.productId) ?? 0) + l.quantityMilli / 1000);
    return map;
  }, [cart.lines]);

  const tefDriver = useTefDriver(platform);
  const [caps, setCaps] = useState<Awaited<ReturnType<Platform['capabilities']>> | null>(null);
  useEffect(() => {
    void platform.preferences
      .get('bipae.display')
      .then((raw) => setBeep(parseDisplayPreferences(raw).beep));
    void platform.capabilities().then(setCaps);
  }, [platform]);

  const focusInput = () => setTimeout(() => inputRef.current?.focus(), 0);
  const fail = (error: unknown) =>
    setMessage({
      tone: 'danger',
      text: error instanceof Error ? error.message : 'Algo deu errado.',
    });

  // Autoatendimento (F5-06): o estado fica no aparelho; recarregar a página não sai do modo.
  const [selfCheckout, setSelfCheckout] = useState<SelfCheckoutState | null>(null);
  const [pinRequest, setPinRequest] = useState<{
    mode: 'create' | 'check';
    title: string;
    description: string;
    resolve: (ok: boolean) => void;
  } | null>(null);
  useEffect(() => {
    void loadSelfCheckout(platform).then(setSelfCheckout);
  }, [platform]);
  const selfMode = selfCheckout !== null;
  const askPin = (title: string, description: string) =>
    new Promise<boolean>((resolve) =>
      setPinRequest({ mode: 'check', title, description, resolve }),
    );
  const startSelfCheckout = () =>
    setPinRequest({
      mode: 'create',
      title: 'Ligar o autoatendimento',
      description:
        'O cliente vai bipar e pagar sozinho. Escolha um PIN de atendente: ele confirma o pagamento, tira itens e desliga o modo.',
      resolve: () => undefined,
    });
  const stopSelfCheckout = async () => {
    if (
      !(await askPin(
        'Desligar o autoatendimento',
        'Atendente: digite o PIN para voltar ao caixa normal.',
      ))
    )
      return;
    await platform.preferences.remove(SELF_CHECKOUT_PREF);
    setSelfCheckout(null);
    setMessage(null);
  };
  /** Tirar item: no autoatendimento, só com o atendente. */
  const removeSelected = async () => {
    if (selected === null) return;
    if (
      selfMode &&
      !(await askPin('Tirar item', 'Atendente: digite o PIN para tirar o item da compra.'))
    )
      return;
    setCart((c) => removeLine(c, selected));
    setSelected(null);
  };

  // Comandas (F5-07): abrir traz para o caixa; guardar devolve o caixa livre.
  const [people, setPeople] = useState(2);
  const openTab = async (tabId: string | null, label?: string) => {
    const current = cartRef.current;
    if (current.lines.length > 0 && !current.tabId) {
      throw new Error('Termine ou limpe a venda atual antes de abrir uma comanda.');
    }
    if (current.tabId) await pdv.saveTab(current);
    const next = tabId ? await pdv.loadTab(tabId) : await pdv.openTab(label ?? '');
    setCart(next);
    setSelected(null);
    setPeople(2);
    setDialog({ kind: 'none' });
    setMessage({
      tone: 'success',
      text: `Comanda ${next.tabLabel} na tela: bipe os itens e toque em Guardar na comanda.`,
    });
    focusInput();
  };
  const saveTabNow = async () => {
    const current = cartRef.current;
    try {
      await pdv.saveTab(current);
      setCart(EMPTY_CART);
      setSelected(null);
      setMessage({ tone: 'success', text: `Comanda ${current.tabLabel} guardada.` });
    } catch (error) {
      fail(error);
    }
    focusInput();
  };
  const cancelTab = async (tab: { id: string; label: string }) => {
    const reason = window.prompt(`Por que cancelar a comanda ${tab.label}?`);
    if (!reason) return;
    if (!can('pos.sale.cancel') && !(await requestAuthorization('pos.sale.cancel'))) {
      throw new Error('Cancelamento não autorizado.');
    }
    await pdv.cancelTab(tab.id, reason);
    if (cartRef.current.tabId === tab.id) setCart(EMPTY_CART);
    setMessage({ tone: 'success', text: `Comanda ${tab.label} cancelada.` });
  };

  const requestAuthorization = useCallback(
    (permission: AuthorizablePermission) =>
      new Promise<string | null>((resolve) => setAuth({ permission, resolve })),
    [],
  );

  // Tabela de preço em vigor nesta venda (F1-03): a do cliente, senão a da loja.
  const [priceTable, setPriceTable] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void pdv
      .activePriceTable(cart.customerTaxId)
      .then((t) => alive && setPriceTable(t?.name ?? null));
    return () => {
      alive = false;
    };
  }, [pdv, cart.customerTaxId, syncStatus?.lastSyncAt]);

  // Meios de pagamento da loja (F8-08), do último retrato.
  const [payments, setPayments] = useState<TerminalPaymentSettings | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void pdv.paymentSettings().then((p) => alive && setPayments(p));
    return () => {
      alive = false;
    };
  }, [pdv, syncStatus?.lastSyncAt]);

  // Vendedores (F8-01): do último retrato, recarregados a cada sincronização.
  const [sellers, setSellers] = useState<CartSeller[]>([]);
  useEffect(() => {
    let alive = true;
    void pdv.sellers().then((list) => alive && setSellers(list));
    return () => {
      alive = false;
    };
  }, [pdv, syncStatus?.lastSyncAt]);

  // Fidelidade (F6-08.b): os pontos do cliente da venda, do último retrato, sem internet.
  const [loyalty, setLoyalty] = useState<Awaited<ReturnType<PdvService['loyaltyFor']>> | null>(
    null,
  );
  useEffect(() => {
    let alive = true;
    const taxId = cart.customerTaxId;
    void (taxId ? pdv.loyaltyFor(taxId) : Promise.resolve(null)).then(
      (l) => alive && setLoyalty(l),
    );
    return () => {
      alive = false;
    };
  }, [pdv, cart.customerTaxId, syncStatus?.lastSyncAt, lastSale]);
  const applyLoyalty = () => {
    if (!loyalty?.program) return;
    const base = totals({ ...priced, loyalty: null });
    const use = maxRedeem(loyalty.points, base.totalCents - base.deliveryFeeCents, loyalty.program);
    if (use.points === 0) {
      setMessage({
        tone: 'warning',
        text: `Para usar pontos, o mínimo é ${loyalty.program.minRedeemPoints}.`,
      });
      return;
    }
    setCart((c) => ({ ...c, loyalty: use }));
  };

  /** O CPF/CNPJ na venda muda a tabela de preço: recalcula o que já está no carrinho. */
  const setCustomer = async (taxId: string | null) => {
    try {
      const prices = await pdv.pricesFor(
        cartRef.current.lines.map((l) => l.productId),
        taxId,
      );
      // Os pontos são do cliente: trocar o CPF desfaz o uso.
      setCart((c) => repriceLines({ ...c, customerTaxId: taxId, loyalty: null }, prices));
    } catch (error) {
      fail(error);
    }
  };

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

  const readScale =
    platform.scale && caps?.scale.available
      ? async () => {
          const reading = await platform.scale!.read();
          if (!reading.stable) throw new Error(SCALE_MESSAGES.unstable);
          return reading.grams;
        }
      : undefined;

  // A scan is async (local database lookup). Shortcuts pressed meanwhile wait for it.
  const pendingScan = useRef<Promise<void> | null>(null);
  const scanNow = (text?: string) => {
    const run = handleScan(text).finally(() => {
      if (pendingScan.current === run) pendingScan.current = null;
    });
    pendingScan.current = run;
    return run;
  };

  // Busca por nome enquanto se digita (F8-15): os produtos aparecem com foto para tocar. Só com
  // letras: o leitor de código digita números e não pode disparar buscas no meio do código.
  const searchSeq = useRef(0);
  const liveResults = useRef(false);
  useEffect(() => {
    const seq = ++searchSeq.current;
    const scan = parseScan(input);
    if (!scan || scan.kind !== 'search' || !/\p{L}/u.test(scan.text) || scan.text.length < 2) {
      if (liveResults.current) {
        liveResults.current = false;
        setResults([]);
      }
      return;
    }
    const timer = setTimeout(() => {
      void pdv
        .search(scan.text, 12, cartRef.current.customerTaxId)
        .then((found) => {
          if (searchSeq.current !== seq) return;
          liveResults.current = true;
          setResults(found);
        })
        .catch(() => undefined);
    }, LIVE_SEARCH_MS);
    return () => clearTimeout(timer);
  }, [input, pdv]);

  /** Tocar num produto (busca ou grade): entra na venda, com o "3*" digitado se houver. */
  const pick = (product: CatalogProduct) => {
    const typed = parseScan(input);
    const explicit = typed?.kind === 'search' && /^\d+(?:[.,]\d{1,3})?\s*[*xX]/.test(input.trim());
    searchSeq.current++;
    liveResults.current = false;
    setInput('');
    if (product.isWeighable && !explicit) setDialog({ kind: 'weigh', product });
    else add(product, explicit && typed?.kind === 'search' ? typed.quantityMilli : 1000);
    focusInput();
  };

  /** Fecha a tela de venda concluída e deixa o caixa pronto para a próxima. */
  const nextSale = () => {
    setCelebrate(false);
    setMessage(null);
    focusInput();
  };

  const handleScan = async (typed?: string) => {
    const text = typed ?? input;
    if (typed === undefined) setInput('');
    // Nada digitado: o Enter fecha a venda concluída e segue para a próxima.
    if (!text.trim() && celebrate) return nextSale();
    const scan = parseScan(text);
    if (!scan) return;
    searchSeq.current++;
    liveResults.current = false;
    const explicitQuantity = /^\d+(?:[.,]\d{1,3})?\s*[*xX]/.test(text.trim());
    try {
      if (scan.kind === 'scale-label') {
        const product = await pdv.findByPlu(scan.plu, cartRef.current.customerTaxId);
        if (!product)
          return fail(new Error(`Etiqueta de balança com código ${scan.plu} não encontrado.`));
        const quantity =
          scan.quantityMilli ?? quantityFromLabelPrice(scan.totalCents!, product.priceCents);
        return add(product, quantity);
      }
      if (scan.kind === 'barcode') {
        const product = await pdv.findByCode(scan.code, cartRef.current.customerTaxId);
        if (!product) {
          // Quem pode cadastrar e está com internet cadastra na hora, com o catálogo ajudando.
          if (!selfMode && can('catalog.write') && backend.createProduct && navigator.onLine) {
            const catalog = backend.catalogLookup
              ? await backend.catalogLookup(scan.code).catch(() => null)
              : null;
            return setDialog({ kind: 'quick-product', code: scan.code, catalog });
          }
          return fail(
            new Error(`Código ${scan.code} não encontrado. Confira ou busque pelo nome.`),
          );
        }
        if (product.isWeighable && !explicitQuantity) return setDialog({ kind: 'weigh', product });
        return add(product, scan.quantityMilli);
      }
      const found = await pdv.search(scan.text, 20, cartRef.current.customerTaxId);
      if (found.length === 0) return fail(new Error(`Nada encontrado para "${scan.text}".`));
      if (found.length === 1) {
        if (found[0]!.isWeighable && !explicitQuantity)
          return setDialog({ kind: 'weigh', product: found[0]! });
        return add(found[0]!, scan.quantityMilli);
      }
      setResults(found);
    } catch (error) {
      fail(error);
    }
  };

  const applyDiscount = async (cents: number, line: number | null) => {
    try {
      const next =
        line === null
          ? setSaleDiscount(cartRef.current, cents)
          : setLineDiscount(cartRef.current, line, cents);
      let by: string | null = null;
      if (discountNeedsAuthorization(next, DISCOUNT_LIMIT_PERCENT)) {
        by = can('pos.discount.above_limit')
          ? operator.id
          : await requestAuthorization('pos.discount.above_limit');
        if (!by) return fail(new Error('Desconto não autorizado.'));
      }
      setCart(next);
      setDiscountAuthorizedBy(by);
      setDialog({ kind: 'none' });
    } catch (error) {
      fail(error);
    }
  };

  /**
   * Reimpressão (F3-14.c): com a NFC-e autorizada, sai o cupom fiscal (DANFE da NFC-e) lido do
   * XML autorizado; sem internet ou sem nota autorizada, sai o comprovante e o aviso da situação.
   */
  const reprint = async (sale: StoredSale) => {
    const fiscal = backend.fiscalDocument
      ? await Promise.race([
          backend.fiscalDocument(sale.id).catch(() => null),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
        ])
      : null;
    // Nota de contingência ainda não transmitida: sai o DANFE de contingência guardado no caixa.
    if (!fiscal?.xml && sale.nfce) {
      return printDanfe(sale.nfce.xml, false).catch(fail);
    }
    if (!fiscal?.xml) {
      if (fiscal)
        setMessage({
          tone: 'warning',
          text: FISCAL_NOTICE[fiscal.status] ?? 'Saiu o comprovante simples.',
        });
      return print(sale);
    }
    if (!platform.printer) return fail(new Error('Nenhuma impressora disponível neste aparelho.'));
    const caps = await platform.capabilities();
    const columns = 48;
    try {
      const blocks = buildDanfeNfce(danfeNfceFromXml(fiscal.xml), { columns });
      if (caps.printer.available && caps.printer.via === 'browser') {
        await platform.printer.print({ kind: 'html', data: receiptToHtml(blocks, columns) });
      } else {
        await platform.printer.print({ kind: 'escpos', data: encodeReceipt(blocks) });
      }
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
      {
        businessName: context.businessName,
        taxId: context.taxId,
        terminalName: context.terminal.name,
        operatorName: operator.name,
      },
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

  /**
   * Sem internet e com o certificado no aparelho (F3-15), o caixa assina a NFC-e em contingência.
   * Com internet, quem emite é o servidor; sem certificado, a nota sai quando a venda subir.
   */
  const contingencySigner = async () => {
    const offline = !navigator.onLine || Boolean(syncStatus?.lastError);
    const cert = platform.certificate;
    if (!offline || !cert) return undefined;
    const [info, certificate] = await Promise.all([
      cert.info().catch(() => null),
      cert.certificate().catch(() => null),
    ]);
    if (!info || !certificate) return undefined;
    return { certificate, sign: (data: Uint8Array) => cert.sign(data, 'RSA-SHA1') };
  };

  /** DANFE da NFC-e a partir do XML; em contingência, com a via do estabelecimento. */
  const printDanfe = async (xml: string, establishmentCopy: boolean) => {
    if (!platform.printer) throw new Error('Nenhuma impressora disponível neste aparelho.');
    const capabilities = await platform.capabilities();
    const columns = 48;
    const data = danfeNfceFromXml(xml);
    const copies = [buildDanfeNfce(data, { columns })];
    if (establishmentCopy) copies.push(buildDanfeNfce(data, { columns, establishmentCopy: true }));
    for (const blocks of copies) {
      if (capabilities.printer.available && capabilities.printer.via === 'browser') {
        await platform.printer.print({ kind: 'html', data: receiptToHtml(blocks, columns) });
      } else {
        await platform.printer.print({ kind: 'escpos', data: encodeReceipt(blocks) });
      }
    }
  };

  const pay = async (tenders: Parameters<typeof pdv.completeSale>[1]) => {
    if (
      selfMode &&
      !(await askPin(
        'Confirmar o pagamento',
        'Atendente: confira o pagamento na maquininha ou no Pix e digite o PIN.',
      ))
    ) {
      throw new Error('Pagamento não confirmado. Chame o atendente.');
    }
    const signer = await contingencySigner();
    const sale = await pdv.completeSale(cart, tenders, {
      discountLimitPercent: DISCOUNT_LIMIT_PERCENT,
      discountAuthorizedBy,
      ...(signer && { contingencySigner: signer }),
    });
    // Som da venda concluída (F8-15), se ligado; senão, o bipe de sempre das preferências.
    if (soundOn) playSuccessSound();
    else playBeep(beep);
    setLastSale(sale);
    setCart(EMPTY_CART);
    setSelected(null);
    setDiscountAuthorizedBy(null);
    setDialog({ kind: 'none' });
    setCelebrate(true);
    // A primeira venda completa encerra as dicas.
    if (tipsPref.value !== 'seen') tipsPref.set('seen');
    const change = sale.payments.reduce((a, p) => a + p.changeCents, 0);
    setMessage({
      tone: 'success',
      text: `Bipaê! Venda nº ${sale.terminalSeq} concluída.${change > 0 ? ` Troco: ${brl(change)}.` : ''}${
        sale.nfce
          ? ' NFC-e emitida em contingência: será transmitida quando a internet voltar (prazo de 24 horas).'
          : ''
      }`,
    });
    // Contingência: o DANFE é obrigatório, com a via do estabelecimento (Manual de Contingência).
    if (sale.nfce && caps?.printer.available) {
      void printDanfe(sale.nfce.xml, true).catch(fail);
    }
    if (
      platform.cashDrawer &&
      caps?.cashDrawer.available &&
      sale.payments.some((p) => p.method === 'cash')
    ) {
      void platform.cashDrawer.open().catch(() => undefined);
    }
    void onSyncNow();
    focusInput();
  };

  const onKeyDown = (e: globalThis.KeyboardEvent) => {
    const cart = cartRef.current;
    if (dialog.kind !== 'none' || auth || pinRequest || sheetOpen) return;
    const actions: Record<string, () => void> = {
      F2: () => inputRef.current?.focus(),
      F3: () => {
        const line = cart.lines.find((l) => l.line === selected);
        if (line)
          setDialog({
            kind: 'quantity',
            line: line.line,
            title: line.name,
            unit: line.unit,
            weighable: line.isWeighable,
          });
      },
      F4: () => cart.lines.length > 0 && setDialog({ kind: 'discount', line: selected }),
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
      F8: () => void removeSelected(),
      F9: () => setDialog({ kind: 'cash' }),
      F10: () => cart.lines.length > 0 && setDialog({ kind: 'payment' }),
      F11: () => setDialog({ kind: 'history' }),
      F12: () => {
        if (cart.lines.length > 0 && confirm('Limpar todos os itens desta venda?'))
          setCart(EMPTY_CART);
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
    // Venda concluída na tela: Esc (ou Enter fora de um botão) segue para a próxima venda.
    if (celebrate) {
      const active = document.activeElement;
      const idle =
        !active ||
        active === document.body ||
        (active === inputRef.current && inputRef.current.value.trim() === '');
      actions.Escape = nextSale;
      if (idle) actions.Enter = nextSale;
    }
    const allowedInSelf = ['F2', 'F6', 'F8', 'F10', 'ArrowUp', 'ArrowDown', 'Escape', 'Enter'];
    const action = selfMode && !allowedInSelf.includes(e.key) ? undefined : actions[e.key];
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
      if (pending && /^F\d+$/.test(e.key)) {
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

  // Ações do caixa: no celular, na folha que sobe de baixo; no computador, no "Mais…".
  const selectedLine = cart.lines.find((l) => l.line === selected) ?? null;
  const canFullscreen = typeof document !== 'undefined' && Boolean(document.fullscreenEnabled);
  const openQuantity = () => {
    if (!selectedLine) return;
    setDialog({
      kind: 'quantity',
      line: selectedLine.line,
      title: selectedLine.name,
      unit: selectedLine.unit,
      weighable: selectedLine.isWeighable,
    });
  };
  const saveQuote = () =>
    void pdv
      .saveQuote(cartRef.current)
      .then(() => {
        setCart(EMPTY_CART);
        setSelected(null);
        setMessage({ tone: 'success', text: 'Orçamento salvo. Abra em Orçamentos (F7).' });
      })
      .catch(fail);
  const clearSale = () => {
    if (cartRef.current.lines.length > 0 && confirm('Limpar todos os itens desta venda?')) {
      setCart(EMPTY_CART);
      setSelected(null);
    }
  };
  const changeMode = (next: RegisterMode) => {
    modePref.set(next);
    focusInput();
  };
  const sheetActions = selfMode ? (
    <SheetSection title="Compra">
      <SheetAction shortcut="F6" onClick={() => setDialog({ kind: 'customer' })}>
        CPF na nota
      </SheetAction>
      <SheetAction
        shortcut="F8"
        onClick={() => void removeSelected()}
        disabled={selectedLine === null}
      >
        Tirar item
      </SheetAction>
      {canFullscreen && (
        <SheetAction onClick={() => void (fullscreen ? exitFullscreen() : enterFullscreen())}>
          {fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
        </SheetAction>
      )}
      <SheetAction onClick={() => void stopSelfCheckout()}>Desligar autoatendimento</SheetAction>
    </SheetSection>
  ) : (
    <>
      {selectedLine && (
        <SheetSection title={`Item ${selectedLine.line}: ${selectedLine.name}`}>
          <SheetAction shortcut="F3" onClick={openQuantity}>
            Quantidade
          </SheetAction>
          <SheetAction
            shortcut="F4"
            onClick={() => setDialog({ kind: 'discount', line: selectedLine.line })}
          >
            Desconto no item
          </SheetAction>
          <SheetAction shortcut="F8" tone="danger" onClick={() => void removeSelected()}>
            Tirar item
          </SheetAction>
        </SheetSection>
      )}
      <SheetSection title="Venda">
        <SheetAction
          onClick={() => setDialog({ kind: 'discount', line: null })}
          disabled={cart.lines.length === 0}
        >
          Desconto na venda
        </SheetAction>
        <SheetAction shortcut="F6" onClick={() => setDialog({ kind: 'customer' })}>
          CPF na nota
        </SheetAction>
        {sellers.length > 0 && (
          <SheetAction onClick={() => setDialog({ kind: 'seller' })}>Vendedor</SheetAction>
        )}
        <SheetAction onClick={() => setDialog({ kind: 'delivery' })}>Entrega</SheetAction>
        <SheetAction onClick={() => setDialog({ kind: 'tabs' })}>Comandas</SheetAction>
        <SheetAction shortcut="F5" disabled={cart.lines.length === 0} onClick={saveQuote}>
          Salvar orçamento
        </SheetAction>
        <SheetAction shortcut="F7" onClick={() => setDialog({ kind: 'quotes' })}>
          Orçamentos
        </SheetAction>
        <SheetAction
          shortcut="F12"
          tone="danger"
          disabled={cart.lines.length === 0}
          onClick={clearSale}
        >
          Limpar venda
        </SheetAction>
      </SheetSection>
      <SheetSection title="Caixa">
        <SheetAction shortcut="F9" onClick={() => setDialog({ kind: 'cash' })}>
          Sangria e fechamento
        </SheetAction>
        <SheetAction shortcut="F11" onClick={() => setDialog({ kind: 'history' })}>
          Vendas do caixa
        </SheetAction>
        {lastSale && (
          <SheetAction onClick={() => void print(lastSale)}>
            Comprovante nº {lastSale.terminalSeq}
          </SheetAction>
        )}
        <SheetAction onClick={() => setDialog({ kind: 'operator' })}>Trocar operador</SheetAction>
        <SheetAction onClick={startSelfCheckout}>Autoatendimento</SheetAction>
        <SheetAction onClick={() => changeMode(mode === 'grid' ? 'spotlight' : 'grid')}>
          Mudar para {REGISTER_MODES[mode === 'grid' ? 'spotlight' : 'grid'].toLowerCase()}
        </SheetAction>
        <SheetAction onClick={() => soundPref.set(soundOn ? 'off' : 'on')}>
          {soundOn ? 'Desligar o som de venda concluída' : 'Ligar o som de venda concluída'}
        </SheetAction>
        {tipsPref.loaded && tipsPref.value === 'seen' && (
          <SheetAction onClick={() => tipsPref.set('new')}>Ver as dicas de novo</SheetAction>
        )}
        {canFullscreen && (
          <SheetAction onClick={() => void (fullscreen ? exitFullscreen() : enterFullscreen())}>
            {fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
          </SheetAction>
        )}
        <SheetAction onClick={onExit}>Sair do caixa</SheetAction>
      </SheetSection>
    </>
  );

  const hasNotices = Boolean((update && cart.lines.length === 0) || selfMode || !handle.persistent);
  // Avisos do caixa (versão nova, autoatendimento, navegador sem armazenamento).
  const notices = (
    <>
      {update && cart.lines.length === 0 && (
        <Alert tone="success" title="Nova versão do Bipaê pronta">
          <div className="flex flex-wrap items-center gap-3">
            <span>
              Atualize agora, entre uma venda e outra. Leva poucos segundos; nada se perde.
            </span>
            <Button
              loading={updating}
              onClick={() => {
                setUpdating(true);
                void platform
                  .updater!.install({ saleInProgress: cartRef.current.lines.length > 0 })
                  .catch((error: unknown) => {
                    setUpdating(false);
                    fail(error);
                  });
              }}
            >
              Atualizar agora
            </Button>
          </div>
        </Alert>
      )}
      {selfMode && (
        <Alert tone="success" title="Autoatendimento">
          Bipe seus produtos e toque em Pagar. Pague na maquininha ou no Pix; o atendente confirma o
          pagamento. Pagamento sem atendente e conferência por peso chegam em breve.
        </Alert>
      )}
      {!handle.persistent && (
        <Alert tone="warning">
          Este navegador não guarda dados no aparelho. Sem internet, as vendas podem ser perdidas se
          a página fechar. Use o Chrome ou o Edge atualizados, ou o Bipaê Desktop.
        </Alert>
      )}
    </>
  );

  // Detalhes da venda (promoções, entrega, comanda, cliente, pontos): ao lado no computador,
  // na folha de ações no celular.
  const saleDetails = (
    <>
      {(priced.appliedPromotions?.length ?? 0) > 0 && (
        <ul className="rounded-2xl border border-success p-3 text-sm" aria-label="Promoções">
          {priced.appliedPromotions!.map((p) => (
            <li key={p.promotionId} className="flex justify-between gap-2">
              <span className="font-semibold">{p.name}</span>
              <span className="tabular-nums" data-testid="promotion-discount">
                -{brl(p.discountCents)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {cart.delivery && (
        <div
          className="flex flex-col gap-1 rounded-2xl border border-primary p-3 text-sm"
          aria-label="Entrega"
        >
          <p className="font-semibold">Entrega: {cart.delivery.zoneName}</p>
          <p>
            {cart.delivery.address.street}, {cart.delivery.address.number}
            {cart.delivery.address.complement
              ? ` - ${cart.delivery.address.complement}`
              : ''} · {cart.delivery.name}
          </p>
          <Button variant="ghost" onClick={() => setDialog({ kind: 'delivery' })}>
            Mudar entrega
          </Button>
        </div>
      )}
      {cart.tabId && (
        <div
          className="flex flex-col gap-2 rounded-2xl border border-primary p-3"
          aria-label="Comanda"
        >
          <p className="font-semibold" data-testid="tab-label">
            Comanda {cart.tabLabel}
          </p>
          <Button variant="secondary" onClick={() => void saveTabNow()}>
            Guardar na comanda
          </Button>
          {t.totalCents > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>Dividir por</span>
              <Button
                variant="ghost"
                aria-label="Menos uma pessoa"
                onClick={() => setPeople((n) => Math.max(1, n - 1))}
              >
                −
              </Button>
              <span className="font-semibold tabular-nums" data-testid="tab-people">
                {people}
              </span>
              <Button
                variant="ghost"
                aria-label="Mais uma pessoa"
                onClick={() => setPeople((n) => Math.min(50, n + 1))}
              >
                +
              </Button>
              <span data-testid="tab-split">
                {people === 1 ? 'pessoa' : 'pessoas'}: {brl(splitBill(t.totalCents, people)[0]!)}
                {splitBill(t.totalCents, people).some((v, _, all) => v !== all[0])
                  ? ' (alguns centavos a mais na primeira)'
                  : ' cada'}
              </span>
            </div>
          )}
        </div>
      )}
      {cart.customerTaxId && (
        <p className="text-sm">CPF/CNPJ na nota: {formatTaxId(cart.customerTaxId)}</p>
      )}
      {cart.seller && (
        <p className="text-sm" data-testid="cart-seller">
          Vendedor: {cart.seller.name} ({cart.seller.code})
        </p>
      )}
      {cart.loyalty ? (
        <div className="flex items-center justify-between gap-2 text-sm">
          <span data-testid="loyalty-used">
            Usando {cart.loyalty.points} pontos: −{brl(t.loyaltyDiscountCents)}
          </span>
          <Button variant="ghost" onClick={() => setCart((c) => ({ ...c, loyalty: null }))}>
            Não usar pontos
          </Button>
        </div>
      ) : (
        loyalty?.program?.active &&
        loyalty.points > 0 && (
          <div className="flex items-center justify-between gap-2 text-sm">
            <span data-testid="loyalty-points">
              {loyalty.points} pontos (valem {brl(loyalty.points * loyalty.program.pointValueCents)}
              )
            </span>
            <Button variant="secondary" onClick={applyLoyalty} disabled={cart.lines.length === 0}>
              Usar pontos
            </Button>
          </div>
        )
      )}
      {priceTable && (
        <p className="text-sm font-semibold text-primary" data-testid="price-table">
          Preços da tabela {priceTable}
        </p>
      )}
    </>
  );

  // Linhas da venda já formatadas, para a lista, o item em destaque e o celular.
  const lineViews: SaleLineView[] = t.items.map((item) => {
    const own = cart.lines.find((l) => l.line === item.line)?.discountCents ?? 0;
    const promo = priced.promotionDiscounts?.[item.line] ?? 0;
    // Item lançado pelo celular (F8-03): mostra quem vendeu.
    const sellerName = item.sellerId
      ? (sellers.find((v) => v.id === item.sellerId)?.name ?? null)
      : null;
    return {
      line: item.line,
      name: item.name,
      quantity: qty(item.quantityMilli, item.unit),
      unitPrice: brl(item.unitPriceCents),
      total: brl(item.totalCents),
      notes: [
        sellerName ? `Vendedor: ${sellerName}` : null,
        own > 0 ? `Desconto no item: ${brl(own)}` : null,
      ].filter((n): n is string => n !== null),
      promotion: promo > 0 ? `Promoção: -${brl(promo)}` : null,
      productId: item.productId,
      imageHash: lineImages.get(item.productId) ?? null,
    };
  });
  const spotlightLine = lineViews.find((l) => l.line === selected) ?? lineViews.at(-1) ?? null;

  // Guia da primeira venda (F8-15): duas dicas curtas, uma de cada vez, até a primeira venda.
  const showTips = tipsPref.loaded && tipsPref.value !== 'seen' && !selfMode;
  const skipTips = () => {
    tipsPref.set('seen');
    focusInput();
  };
  const tipScan =
    showTips && cart.lines.length === 0 && !celebrate ? (
      <GuideTip onSkip={skipTips}>
        Bipe ou digite aqui: código de barras ou o nome do produto.
      </GuideTip>
    ) : null;
  const tipPay =
    showTips && cart.lines.length > 0 ? (
      <GuideTip onSkip={skipTips} arrow="down">
        Toque para receber quando o cliente terminar.
      </GuideTip>
    ) : null;

  // Venda concluída (F8-15): o troco gigante até a próxima venda.
  const successChange = lastSale ? lastSale.payments.reduce((a, p) => a + p.changeCents, 0) : 0;
  const successMessage = message?.tone === 'success' ? message.text : null;
  const success =
    celebrate && lastSale && cart.lines.length === 0 ? (
      <SaleSuccess
        seq={lastSale.terminalSeq}
        changeCents={successChange}
        paidCents={lastSale.totalCents}
        message={successMessage}
        motion={!prefersReducedMotion()}
        soundOn={soundOn}
        onToggleSound={() => soundPref.set(soundOn ? 'off' : 'on')}
        onNext={nextSale}
        onPrint={platform.printer ? () => void print(lastSale) : null}
        compact={compact}
      />
    ) : null;
  const alertMessage = success && successMessage ? null : message;

  const payLabel = selfMode ? 'Pagar' : 'Receber';
  const openPayment = () => setDialog({ kind: 'payment' });

  /** Ações frequentes em cartões coloridos, com o nome e a tecla. */
  type Tile = {
    label: string;
    shortcut?: string;
    icon: LucideIcon;
    tone: TileTone;
    /** O que o cartão faz (ver `runTile`). */
    action: TileAction;
    disabled?: boolean;
  };
  type TileAction =
    | 'quantity'
    | 'discount'
    | 'customer'
    | 'remove'
    | 'tabs'
    | 'delivery'
    | 'seller'
    | 'cash'
    | 'history';
  const runTile = (action: TileAction) => {
    if (action === 'quantity') return openQuantity();
    if (action === 'discount') return setDialog({ kind: 'discount', line: selected });
    if (action === 'remove') return void removeSelected();
    setDialog({ kind: action });
  };
  const customerTile: Tile = {
    label: selfMode ? 'CPF na nota' : 'Cliente/CPF',
    shortcut: 'F6',
    icon: UserRound,
    tone: 'purple',
    action: 'customer',
  };
  const removeTile: Tile = {
    label: 'Tirar item',
    shortcut: 'F8',
    icon: Trash2,
    tone: 'danger',
    action: 'remove',
    disabled: selected === null,
  };
  const discountTile: Tile = {
    label: 'Desconto',
    shortcut: 'F4',
    icon: Percent,
    tone: 'orange',
    action: 'discount',
    disabled: cart.lines.length === 0,
  };
  const desktopTiles: Tile[] = selfMode
    ? [customerTile, removeTile]
    : [
        {
          label: 'Quantidade',
          shortcut: 'F3',
          icon: Hash,
          tone: 'blue',
          action: 'quantity',
          disabled: selectedLine === null,
        },
        discountTile,
        customerTile,
        removeTile,
        {
          label: 'Comandas',
          icon: UtensilsCrossed,
          tone: 'yellow',
          action: 'tabs',
        },
        { label: 'Entrega', icon: Truck, tone: 'blue', action: 'delivery' },
        ...(sellers.length > 0
          ? [
              {
                label: 'Vendedor',
                icon: Users,
                tone: 'green',
                action: 'seller',
              } satisfies Tile,
            ]
          : []),
        {
          label: 'Caixa',
          shortcut: 'F9',
          icon: Wallet,
          tone: 'green',
          action: 'cash',
        },
        {
          label: 'Vendas',
          shortcut: 'F11',
          icon: History,
          tone: 'purple',
          action: 'history',
        },
      ];

  const compactTiles: Tile[] = selfMode
    ? [customerTile, removeTile]
    : [discountTile, customerTile, removeTile];

  const scanField = (big: boolean) => (
    <form
      className="relative min-w-0 flex-1"
      onSubmit={(e) => {
        e.preventDefault();
        void scanNow();
      }}
    >
      <label htmlFor="pdv-input" className="sr-only">
        Bipe o código ou digite o nome do produto
      </label>
      <ScanBarcode
        aria-hidden
        className={cx(
          'pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted',
          big ? 'left-4 size-7' : 'left-3 size-5',
        )}
      />
      <input
        id="pdv-input"
        ref={inputRef}
        autoFocus
        autoComplete="off"
        enterKeyHint="go"
        aria-keyshortcuts="F2"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={big ? 'Bipe ou digite o produto (ex.: 3*arroz)' : 'Bipe ou digite o produto'}
        className={cx(
          'w-full rounded-2xl border-2 border-primary bg-surface shadow-sm',
          big ? 'min-h-16 pl-14 pr-16 text-2xl' : 'min-h-12 pl-10 pr-3 text-lg',
        )}
      />
      {big && (
        <kbd
          aria-hidden
          className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 rounded-md border border-border bg-surface-2 px-1.5 font-mono text-sm text-muted"
        >
          F2
        </kbd>
      )}
    </form>
  );

  const overlays = (
    <>
      {dialog.kind === 'quick-product' && (
        <QuickProductDialog
          code={dialog.code}
          catalog={dialog.catalog}
          onSave={async (input) => {
            await backend.createProduct!(input);
            // Traz o produto novo para o banco do caixa e já põe na venda.
            await onSyncNow();
            const product = await pdv.findByCode(dialog.code, cartRef.current.customerTaxId);
            closeDialog();
            if (product) add(product, 1000);
          }}
          onClose={closeDialog}
        />
      )}
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
          item={(() => {
            const it = t.items.find((i) => i.line === dialog.line);
            return it ? { name: it.name, grossCents: it.grossCents } : null;
          })()}
          limitPercent={DISCOUNT_LIMIT_PERCENT}
          canExceed={can('pos.discount.above_limit')}
          onConfirm={(c, scope) => void applyDiscount(c, scope === 'item' ? dialog.line : null)}
          onClose={closeDialog}
        />
      )}
      {dialog.kind === 'customer' && (
        <CustomerDialog
          current={cart.customerTaxId}
          onConfirm={(taxId) => {
            void setCustomer(taxId);
            closeDialog();
          }}
          onClose={closeDialog}
        />
      )}
      {dialog.kind === 'seller' && (
        <SellerDialog
          sellers={sellers}
          current={cart.seller ?? null}
          onConfirm={(seller) => {
            setCart((c) => ({ ...c, seller }));
            closeDialog();
          }}
          onClose={closeDialog}
        />
      )}
      {dialog.kind === 'delivery' && (
        <DeliveryDialog
          pdv={pdv}
          current={cart.delivery ?? null}
          taxId={cart.customerTaxId}
          onSave={(delivery, taxId) => {
            void setCustomer(taxId).then(() => {
              setCart((c) => ({ ...c, delivery }));
              setMessage({
                tone: 'success',
                text: `Entrega para ${delivery.zoneName}: taxa de ${brl(delivery.feeCents)} somada ao total.`,
              });
            });
            closeDialog();
          }}
          onRemove={() => {
            setCart((c) => ({ ...c, delivery: null }));
            closeDialog();
          }}
          onClose={closeDialog}
        />
      )}
      {dialog.kind === 'tabs' && (
        <TabsDialog pdv={pdv} onOpen={openTab} onCancel={cancelTab} onClose={closeDialog} />
      )}
      {dialog.kind === 'payment' && (
        <PaymentDialog
          totalCents={t.totalCents}
          credit={cart.customerTaxId ? creditInfo : undefined}
          {...(selfMode && { methods: ['pix', 'debit', 'credit'] as const })}
          {...(tefDriver && {
            tef: {
              driver: tefDriver,
              onReceipts: (text: string[]) => {
                // Os recibos do TEF saem na impressora térmica, se houver; senão ficam só no pinpad.
                void platform.printer
                  ?.print({
                    kind: 'escpos',
                    data: encodeReceipt(text.map((t) => ({ kind: 'text' as const, text: t }))),
                  })
                  .catch(() => undefined);
              },
            },
          })}
          {...(payments && { payments })}
          {...(payments?.card === 'mp_point' &&
            backend.cardCharge && {
              cardApi: {
                create: (cents: number, m: 'credit' | 'debit') =>
                  backend.cardCharge!.create(context.terminal.storeId, cents, m),
                get: (id: string) => backend.cardCharge!.get(id),
                cancel: (id: string) => backend.cardCharge!.cancel(id),
              },
            })}
          {...((payments?.pix === 'api' || payments?.pix === 'psp') &&
            backend.pixCharge && {
              pixApi: {
                create: (cents: number) =>
                  backend.pixCharge!.create(context.terminal.storeId, cents),
                get: (txid: string) => backend.pixCharge!.get(txid),
                ...(backend.pixCharge.cancel && {
                  cancel: (txid: string) => backend.pixCharge!.cancel!(txid),
                }),
              },
            })}
          onPaid={pay}
          onClose={closeDialog}
        />
      )}
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
          onReprint={(s) => void reprint(s)}
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
      {dialog.kind === 'operator' && (
        <OperatorDialog
          backend={backend}
          onChanged={async (next) => {
            await pdv.changeOperator(next.userId);
            setOperator({ id: next.userId, name: next.name, permissions: next.permissions });
            setMessage({ tone: 'success', text: `${next.name} está operando o caixa.` });
            closeDialog();
          }}
          onClose={closeDialog}
        />
      )}
      {pinRequest && (
        <PinDialog
          mode={pinRequest.mode}
          title={pinRequest.title}
          description={pinRequest.description}
          state={selfCheckout}
          onDone={(pin) => {
            const request = pinRequest;
            setPinRequest(null);
            if (request.mode === 'create') {
              void newSelfCheckout(pin).then(async (state) => {
                await platform.preferences.set(SELF_CHECKOUT_PREF, JSON.stringify(state));
                setSelfCheckout(state);
                setDialog({ kind: 'none' });
              });
            }
            request.resolve(true);
            focusInput();
          }}
          onClose={() => {
            pinRequest.resolve(false);
            setPinRequest(null);
            focusInput();
          }}
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
    </>
  );

  const productGrid = (gridCompact: boolean) => (
    <>
      <CategoryTabs categories={categories} current={category} onChange={setCategory} />
      <ProductGrid
        products={gridProducts}
        inCart={inCart}
        onPick={pick}
        compact={gridCompact}
        hint={
          gridProducts.length >= GRID_LIMIT
            ? `Mostrando os primeiros ${GRID_LIMIT}. Para achar outro, digite o nome no campo de cima.`
            : categories.length === 0
              ? 'Para separar em abas, dê uma categoria aos produtos na retaguarda (Produtos).'
              : null
        }
      />
    </>
  );

  if (compact) {
    return (
      <CompactRegister
        terminalName={context.terminal.name}
        operatorName={operator.name}
        syncStatus={syncStatus}
        onSyncNow={() => void onSyncNow()}
        onExit={onExit}
        selfMode={selfMode}
        mode={selfMode ? 'spotlight' : mode}
        onModeChange={changeMode}
        notices={hasNotices ? notices : null}
        scanInput={scanField(false)}
        camera={
          <CameraScanButton platform={platform} onCode={(code) => void scanNow(code)} iconOnly />
        }
        tipScan={tipScan}
        tipPay={tipPay}
        message={alertMessage}
        results={results}
        onPick={pick}
        spotlight={spotlightLine ? <LastItem item={spotlightLine} compact /> : null}
        grid={productGrid(true)}
        success={success}
        lines={lineViews}
        selected={selected}
        onSelect={setSelected}
        totalCents={t.totalCents}
        itemCount={cart.lines.length}
        tags={[
          cart.customerTaxId ? `CPF/CNPJ ${formatTaxId(cart.customerTaxId)}` : null,
          cart.tabId ? `Comanda ${cart.tabLabel}` : null,
          cart.delivery ? `Entrega: ${cart.delivery.zoneName}` : null,
          cart.seller ? `Vendedor: ${cart.seller.name}` : null,
          (priced.appliedPromotions?.length ?? 0) > 0
            ? priced.appliedPromotions!.length === 1
              ? '1 promoção'
              : `${priced.appliedPromotions!.length} promoções`
            : null,
          cart.loyalty ? `${cart.loyalty.points} pontos` : null,
          priceTable ? `Tabela ${priceTable}` : null,
        ].filter((tag): tag is string => tag !== null)}
        onPay={openPayment}
        quickTiles={compactTiles}
        onTile={runTile}
        sheetOpen={sheetOpen}
        onSheetOpenChange={setSheetOpen}
        details={saleDetails}
        actions={sheetActions}
        overlays={overlays}
      />
    );
  }

  const viewMode: RegisterMode = selfMode ? 'spotlight' : mode;
  const totalCard = (big: boolean) => (
    <div className="shrink-0 rounded-3xl bg-primary p-5 text-primary-contrast shadow-md">
      <p className="text-sm font-bold uppercase tracking-widest opacity-90">Total</p>
      <p
        className={cx(
          'font-black leading-tight tabular-nums',
          big ? 'text-6xl xl:text-7xl' : 'text-5xl',
        )}
        aria-live="polite"
        data-testid="pdv-total"
      >
        {brl(t.totalCents)}
      </p>
      <p className="mt-1 text-base font-semibold opacity-90">
        {cart.lines.length === 1 ? '1 item' : `${cart.lines.length} itens`}
      </p>
      {t.discountCents > 0 && <p className="mt-1">Descontos: {brl(t.discountCents)}</p>}
      {t.deliveryFeeCents > 0 && (
        <p className="mt-1" data-testid="delivery-fee">
          Taxa de entrega: {brl(t.deliveryFeeCents)}
        </p>
      )}
    </div>
  );

  return (
    // Do notebook para cima (lg), tudo cabe numa tela só. Abaixo disso, o layout compacto (F8-14).
    <div className="flex h-screen flex-col bg-bg" data-layout="desktop" data-mode={viewMode}>
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-border bg-surface px-4 py-2 [&_button]:whitespace-nowrap">
        <Logo className="text-2xl" />
        <span aria-hidden className="h-8 w-px bg-border" />
        <div className="leading-tight">
          <p className="font-bold">{context.terminal.name}</p>
          <p className="text-sm text-muted" data-testid="pdv-operator">
            {operator.name}
          </p>
        </div>
        {!selfMode && (
          <Button variant="ghost" onClick={() => setDialog({ kind: 'operator' })}>
            Trocar operador
          </Button>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1">
          {!selfMode && <ModeSwitch mode={mode} onChange={changeMode} />}
          <SyncBadge status={syncStatus} onSync={() => void onSyncNow()} />
          {selfMode ? (
            <Button variant="ghost" onClick={() => void stopSelfCheckout()}>
              Desligar autoatendimento
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={startSelfCheckout}>
                Autoatendimento
              </Button>
              <Button variant="ghost" onClick={onExit}>
                Sair do caixa
              </Button>
            </>
          )}
        </div>
      </header>
      {hasNotices && <div className="flex shrink-0 flex-col gap-2 px-4 pt-3">{notices}</div>}

      <div className="flex shrink-0 flex-col gap-2 px-4 pt-3">
        <div className="flex items-center gap-3">
          {scanField(true)}
          {/* No celular, a câmera faz de leitor (F8-05); cada leitura vira uma bipada. */}
          <CameraScanButton platform={platform} onCode={(code) => void scanNow(code)} />
        </div>
        {tipScan}
        {alertMessage && <Alert tone={alertMessage.tone}>{alertMessage.text}</Alert>}
        <SearchResults results={results} onPick={pick} />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)] gap-4 p-4">
        {success ? (
          <div className="col-span-2 min-h-0 rounded-3xl border border-border bg-surface shadow-sm">
            {success}
          </div>
        ) : (
          <>
            {viewMode === 'spotlight' ? (
              <section className="flex min-h-0 flex-col gap-3" aria-label="Itens da venda">
                {cart.lines.length === 0 ? (
                  <div className="min-h-0 flex-1 rounded-3xl border border-border bg-surface">
                    <EmptySale />
                  </div>
                ) : (
                  <>
                    {spotlightLine && (
                      <LastItem
                        key={`${spotlightLine.line}-${spotlightLine.quantity}`}
                        item={spotlightLine}
                      />
                    )}
                    <SaleTable lines={lineViews} selected={selected} onSelect={setSelected} />
                  </>
                )}
              </section>
            ) : (
              <section className="flex min-h-0 flex-col gap-3" aria-label="Produtos">
                {productGrid(false)}
              </section>
            )}

            <aside className="flex min-h-0 flex-col gap-3" aria-label="Resumo">
              {totalCard(viewMode === 'spotlight')}
              {viewMode === 'grid' && (
                <SaleList
                  lines={lineViews}
                  selected={selected}
                  onSelect={setSelected}
                  className="min-h-24 flex-1 rounded-2xl border border-border"
                />
              )}
              <div
                className={cx(
                  'flex min-h-0 flex-col gap-3 overflow-y-auto',
                  viewMode === 'spotlight' ? 'flex-1' : 'max-h-48 shrink-0',
                )}
              >
                {saleDetails}
              </div>
              {tipPay}
              <PayButton
                big
                label={payLabel}
                shortcut="F10"
                onClick={openPayment}
                disabled={cart.lines.length === 0}
              />
            </aside>
          </>
        )}
      </div>

      <nav
        aria-label="Ações do caixa"
        className="shrink-0 border-t border-border bg-surface px-4 py-3"
      >
        <ul className="grid auto-cols-fr grid-flow-col gap-2">
          {desktopTiles.map((tile) => (
            <li key={tile.label} className="grid">
              <ActionTile
                label={tile.label}
                shortcut={tile.shortcut}
                icon={tile.icon}
                tone={tile.tone}
                disabled={tile.disabled}
                onClick={() => runTile(tile.action)}
              />
            </li>
          ))}
          {!selfMode && (
            <li className="grid">
              <ActionTile
                label="Mais…"
                ariaLabel="Mais ações"
                haspopup
                icon={Ellipsis}
                tone="neutral"
                onClick={() => setSheetOpen(true)}
              />
            </li>
          )}
        </ul>
      </nav>

      <ActionSheet open={sheetOpen} onOpenChange={setSheetOpen} title="Ações do caixa">
        {sheetActions}
      </ActionSheet>
      {overlays}
    </div>
  );
}

/** Lista da venda no computador: uma tabela, com a foto, para conferir item por item. */
function SaleTable({
  lines,
  selected,
  onSelect,
}: {
  lines: SaleLineView[];
  selected: number | null;
  onSelect: (line: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // O item recém-bipado (selecionado) fica sempre à vista.
  useEffect(() => {
    if (selected === null) return;
    ref.current
      ?.querySelector<HTMLElement>(`[data-line="${selected}"]`)
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [selected, lines.length]);
  return (
    <div
      ref={ref}
      className="min-h-0 flex-1 overflow-y-auto rounded-3xl border border-border bg-surface"
      data-testid="pdv-items"
    >
      <table className="w-full text-left">
        <caption className="sr-only">Itens da venda</caption>
        <thead className="sticky top-0 z-10 bg-surface-2 text-sm text-muted">
          <tr>
            <th scope="col" className="w-12 px-3 py-2">
              #
            </th>
            <th scope="col" className="px-3 py-2">
              Produto
            </th>
            <th scope="col" className="px-3 py-2 text-right">
              Qtd.
            </th>
            <th scope="col" className="px-3 py-2 text-right">
              Preço
            </th>
            <th scope="col" className="px-3 py-2 text-right">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((item) => (
            <tr
              key={item.line}
              data-line={item.line}
              aria-selected={selected === item.line}
              onClick={() => onSelect(item.line)}
              className={cx(
                'cursor-pointer border-t border-border hover:bg-surface-2',
                selected === item.line && 'bg-warning-soft hover:bg-warning-soft',
              )}
            >
              <td className="px-3 py-2 text-muted tabular-nums">{item.line}</td>
              <td className="px-3 py-2">
                <span className="flex items-center gap-3">
                  <ProductThumb
                    name={item.name}
                    productId={item.productId}
                    imageHash={item.imageHash}
                    size="sm"
                  />
                  <span className="min-w-0 font-medium">
                    {item.name}
                    {item.notes.map((note) => (
                      <span key={note} className="block text-sm font-normal text-muted">
                        {note}
                      </span>
                    ))}
                    {item.promotion && (
                      <span className="block text-sm font-semibold text-success">
                        {item.promotion}
                      </span>
                    )}
                  </span>
                </span>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{item.quantity}</td>
              <td className="px-3 py-2 text-right tabular-nums">{item.unitPrice}</td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums">{item.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
        'flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-semibold',
        offline ? 'bg-warning-soft text-text' : 'bg-success-soft text-success',
      )}
      title={status.lastError ?? 'Sincronizar agora'}
      data-testid="sync-status"
    >
      {offline ? (
        <CloudOff className="size-4" aria-hidden />
      ) : (
        <RefreshCw className={cx('size-4', status.syncing && 'animate-spin')} aria-hidden />
      )}
      {offline ? 'Sem conexão' : describeLastSync(status.lastSyncAt)}
      {status.pending > 0 && ` · ${status.pending} para enviar`}
    </button>
  );
}
