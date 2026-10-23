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
import { describeLastSync, type SyncStatus } from '@bipae/sync';
import { Alert, Button, cx, Logo, parseDisplayPreferences, playBeep } from '@bipae/ui';
import { CloudOff, RefreshCw } from 'lucide-react';
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
import { CompactRegister, SheetAction, SheetSection } from './compact-register';
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
  const setCart = useCallback((next: Cart | ((c: Cart) => Cart)) => {
    cartRef.current = typeof next === 'function' ? next(cartRef.current) : next;
    setCartState(cartRef.current);
  }, []);
  const [selected, setSelected] = useState<number | null>(null);
  const [input, setInput] = useState('');
  const [results, setResults] = useState<CatalogProduct[]>([]);
  const [message, setMessage] = useState<{
    tone: 'danger' | 'success' | 'warning';
    text: string;
  } | null>(null);
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

  const handleScan = async (typed?: string) => {
    const text = typed ?? input;
    if (typed === undefined) setInput('');
    const scan = parseScan(text);
    if (!scan) return;
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
    playBeep(beep);
    setLastSale(sale);
    setCart(EMPTY_CART);
    setSelected(null);
    setDiscountAuthorizedBy(null);
    setDialog({ kind: 'none' });
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
    const allowedInSelf = ['F2', 'F6', 'F8', 'F10', 'ArrowUp', 'ArrowDown'];
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

  // Folha de ações do celular (F8-14): o que no computador são botões e atalhos F.
  const selectedLine = cart.lines.find((l) => l.line === selected) ?? null;
  const canFullscreen = typeof document !== 'undefined' && Boolean(document.fullscreenEnabled);
  const sheetActions = selfMode ? (
    <SheetSection title="Compra">
      <SheetAction onClick={() => setDialog({ kind: 'customer' })}>CPF na nota</SheetAction>
      <SheetAction onClick={() => void removeSelected()} disabled={selectedLine === null}>
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
          <SheetAction
            onClick={() =>
              setDialog({
                kind: 'quantity',
                line: selectedLine.line,
                title: selectedLine.name,
                unit: selectedLine.unit,
                weighable: selectedLine.isWeighable,
              })
            }
          >
            Quantidade
          </SheetAction>
          <SheetAction onClick={() => setDialog({ kind: 'discount', line: selectedLine.line })}>
            Desconto no item
          </SheetAction>
          <SheetAction tone="danger" onClick={() => void removeSelected()}>
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
        <SheetAction onClick={() => setDialog({ kind: 'customer' })}>CPF na nota</SheetAction>
        {sellers.length > 0 && (
          <SheetAction onClick={() => setDialog({ kind: 'seller' })}>Vendedor</SheetAction>
        )}
        <SheetAction onClick={() => setDialog({ kind: 'delivery' })}>Entrega</SheetAction>
        <SheetAction onClick={() => setDialog({ kind: 'tabs' })}>Comandas</SheetAction>
        <SheetAction
          disabled={cart.lines.length === 0}
          onClick={() =>
            void pdv
              .saveQuote(cartRef.current)
              .then(() => {
                setCart(EMPTY_CART);
                setSelected(null);
                setMessage({ tone: 'success', text: 'Orçamento salvo. Abra em Orçamentos.' });
              })
              .catch(fail)
          }
        >
          Salvar orçamento
        </SheetAction>
        <SheetAction onClick={() => setDialog({ kind: 'quotes' })}>Orçamentos</SheetAction>
        <SheetAction
          tone="danger"
          disabled={cart.lines.length === 0}
          onClick={() => {
            if (confirm('Limpar todos os itens desta venda?')) {
              setCart(EMPTY_CART);
              setSelected(null);
            }
          }}
        >
          Limpar venda
        </SheetAction>
      </SheetSection>
      <SheetSection title="Caixa">
        <SheetAction onClick={() => setDialog({ kind: 'cash' })}>Sangria e fechamento</SheetAction>
        <SheetAction onClick={() => setDialog({ kind: 'history' })}>Vendas do caixa</SheetAction>
        {lastSale && (
          <SheetAction onClick={() => void print(lastSale)}>
            Comprovante nº {lastSale.terminalSeq}
          </SheetAction>
        )}
        <SheetAction onClick={() => setDialog({ kind: 'operator' })}>Trocar operador</SheetAction>
        <SheetAction onClick={startSelfCheckout}>Autoatendimento</SheetAction>
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
        <ul className="rounded-ui border border-success p-3 text-sm" aria-label="Promoções">
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
          className="flex flex-col gap-1 rounded-ui border border-primary p-3 text-sm"
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
          className="flex flex-col gap-2 rounded-ui border border-primary p-3"
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

  if (compact) {
    return (
      <CompactRegister
        terminalName={context.terminal.name}
        operatorName={operator.name}
        syncStatus={syncStatus}
        onSyncNow={() => void onSyncNow()}
        onExit={onExit}
        selfMode={selfMode}
        notices={hasNotices ? notices : null}
        scanInput={
          <form
            className="min-w-0 flex-1"
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
              enterKeyHint="go"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Bipe ou busque (ex.: 3*arroz)"
              className="min-h-12 w-full rounded-ui border-2 border-primary bg-surface px-3 text-lg"
            />
          </form>
        }
        camera={
          <CameraScanButton platform={platform} onCode={(code) => void scanNow(code)} iconOnly />
        }
        message={message}
        results={results}
        onPick={(p) => (p.isWeighable ? setDialog({ kind: 'weigh', product: p }) : add(p, 1000))}
        lines={t.items.map((item) => ({
          line: item.line,
          name: item.name,
          quantity: `${(item.quantityMilli / 1000).toLocaleString('pt-BR', {
            maximumFractionDigits: 3,
          })} ${item.unit}`,
          unitPrice: brl(item.unitPriceCents),
          total: brl(item.totalCents),
          notes: [
            item.sellerId && sellers.find((v) => v.id === item.sellerId)
              ? `Vendedor: ${sellers.find((v) => v.id === item.sellerId)!.name}`
              : null,
            (cart.lines.find((l) => l.line === item.line)?.discountCents ?? 0) > 0
              ? `Desconto no item: ${brl(cart.lines.find((l) => l.line === item.line)!.discountCents)}`
              : null,
          ].filter((n): n is string => n !== null),
          promotion:
            (priced.promotionDiscounts?.[item.line] ?? 0) > 0
              ? `Promoção: -${brl(priced.promotionDiscounts![item.line]!)}`
              : null,
        }))}
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
        onPay={() => setDialog({ kind: 'payment' })}
        sheetOpen={sheetOpen}
        onSheetOpenChange={setSheetOpen}
        details={saleDetails}
        actions={sheetActions}
        overlays={overlays}
      />
    );
  }

  return (
    // Do notebook para cima (lg), tudo cabe numa tela só, com o total e os atalhos ao lado.
    // Abaixo disso o caixa usa o layout compacto, com cara de app (F8-14).
    <div className="flex min-h-screen flex-col bg-bg lg:h-screen">
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border bg-surface px-3 py-2 sm:px-4 [&_button]:whitespace-nowrap">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Logo className="text-xl" />
          <span className="font-semibold">{context.terminal.name}</span>
          <span className="text-sm text-muted" data-testid="pdv-operator">
            · {operator.name}
          </span>
          {!selfMode && (
            <Button variant="ghost" onClick={() => setDialog({ kind: 'operator' })}>
              Trocar operador
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
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
      {notices}

      <div className="grid flex-1 gap-4 p-3 pb-28 sm:p-4 sm:pb-28 lg:grid-cols-[1fr_380px] lg:overflow-hidden lg:pb-4">
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
          {/* No celular, a câmera faz de leitor (F8-05); cada leitura vira uma bipada. */}
          <CameraScanButton platform={platform} onCode={(code) => void scanNow(code)} />
          {message && <Alert tone={message.tone}>{message.text}</Alert>}
          {results.length > 0 && (
            <ul
              className="max-h-60 overflow-y-auto rounded-ui border border-border bg-surface"
              aria-label="Resultados da busca"
            >
              {results.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="flex w-full justify-between gap-3 px-4 py-3 text-left hover:bg-surface-2"
                    onClick={() =>
                      p.isWeighable ? setDialog({ kind: 'weigh', product: p }) : add(p, 1000)
                    }
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
          <div className="min-h-40 flex-1 overflow-y-auto rounded-ui border border-border bg-surface lg:min-h-0">
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
                    <th scope="col" className="px-3 py-2">
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
                  {t.items.map((item) => (
                    <tr
                      key={item.line}
                      aria-selected={selected === item.line}
                      onClick={() => setSelected(item.line)}
                      className={cx(
                        'cursor-pointer border-t border-border',
                        selected === item.line && 'bg-warning-soft',
                      )}
                    >
                      <td className="px-3 py-2 text-muted">{item.line}</td>
                      <td className="px-3 py-2 font-medium">
                        {item.name}
                        {(() => {
                          const own =
                            cart.lines.find((l) => l.line === item.line)?.discountCents ?? 0;
                          const promo = priced.promotionDiscounts?.[item.line] ?? 0;
                          // Item lançado pelo celular (F8-03): mostra quem vendeu.
                          const sellerName = item.sellerId
                            ? (sellers.find((v) => v.id === item.sellerId)?.name ?? null)
                            : null;
                          return (
                            <>
                              {sellerName && (
                                <span className="block text-sm font-normal text-muted">
                                  Vendedor: {sellerName}
                                </span>
                              )}
                              {own > 0 && (
                                <span className="block text-sm font-normal text-muted">
                                  Desconto no item: {brl(own)}
                                </span>
                              )}
                              {promo > 0 && (
                                <span className="block text-sm font-semibold text-success">
                                  Promoção: -{brl(promo)}
                                </span>
                              )}
                            </>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {(item.quantityMilli / 1000).toLocaleString('pt-BR', {
                          maximumFractionDigits: 3,
                        })}{' '}
                        {item.unit}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {brl(item.unitPriceCents)}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">
                        {brl(item.totalCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <aside className="flex flex-col gap-3" aria-label="Resumo">
          <div className="hidden rounded-ui bg-primary p-5 text-primary-contrast lg:block">
            <p className="text-sm font-semibold uppercase tracking-wide opacity-90">Total</p>
            <p
              className="text-5xl font-extrabold tabular-nums"
              aria-live="polite"
              data-testid="pdv-total"
            >
              {brl(t.totalCents)}
            </p>
            {t.discountCents > 0 && <p className="mt-1">Descontos: {brl(t.discountCents)}</p>}
            {t.deliveryFeeCents > 0 && (
              <p className="mt-1" data-testid="delivery-fee">
                Taxa de entrega: {brl(t.deliveryFeeCents)}
              </p>
            )}
            <p className="mt-1 text-sm opacity-90">
              {cart.lines.length === 1 ? '1 item' : `${cart.lines.length} itens`}
            </p>
          </div>
          {saleDetails}
          <div className="hidden lg:grid">
            <Button
              size="lg"
              onClick={() => setDialog({ kind: 'payment' })}
              disabled={cart.lines.length === 0}
              aria-keyshortcuts="F10"
            >
              Pagar (F10)
            </Button>
          </div>
          {selfMode ? (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => setDialog({ kind: 'customer' })}>
                CPF na nota
              </Button>
              <Button
                variant="secondary"
                onClick={() => void removeSelected()}
                disabled={selected === null}
              >
                Tirar item
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="secondary"
                onClick={() => setDialog({ kind: 'discount', line: selected })}
                disabled={cart.lines.length === 0}
              >
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
              <Button variant="secondary" onClick={() => setDialog({ kind: 'tabs' })}>
                Comandas
              </Button>
              <Button variant="secondary" onClick={() => setDialog({ kind: 'delivery' })}>
                Entrega
              </Button>
              {sellers.length > 0 && (
                <Button variant="secondary" onClick={() => setDialog({ kind: 'seller' })}>
                  Vendedor
                </Button>
              )}
            </div>
          )}
          {lastSale && (
            <Button variant="ghost" onClick={() => void print(lastSale)}>
              Imprimir comprovante da venda nº {lastSale.terminalSeq}
            </Button>
          )}
        </aside>
      </div>

      {/* Celular e tablet: o total e o Pagar sempre à mão, no alcance do polegar. */}
      <div
        className="fixed inset-x-0 bottom-0 z-20 flex items-center gap-3 border-t border-border bg-surface p-3 shadow-lg lg:hidden"
        aria-label="Total e pagamento"
        role="region"
      >
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            Total · {cart.lines.length === 1 ? '1 item' : `${cart.lines.length} itens`}
          </p>
          <p
            className="truncate text-2xl font-extrabold tabular-nums"
            data-testid="pdv-total-mobile"
          >
            {brl(t.totalCents)}
          </p>
        </div>
        <Button
          size="lg"
          onClick={() => setDialog({ kind: 'payment' })}
          disabled={cart.lines.length === 0}
        >
          Pagar
        </Button>
      </div>

      <footer
        className="hidden flex-wrap gap-x-4 gap-y-1 border-t border-border bg-surface px-4 py-2 text-sm text-muted lg:flex"
        aria-label="Atalhos do teclado"
      >
        {SHORTCUTS.map(([key, label]) => (
          <span key={key}>
            <kbd className="rounded border border-border bg-surface-2 px-1.5 font-mono text-text">
              {key}
            </kbd>{' '}
            {label}
          </span>
        ))}
      </footer>

      {overlays}
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
