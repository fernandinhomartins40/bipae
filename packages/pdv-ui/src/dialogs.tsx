import {
  formatBRL,
  formatTaxId,
  parseBRL,
  parseTaxId,
  PAYMENT_LABELS,
  staticPixPayload,
  type Cents,
  type PaymentMethod,
  type CardChargeView,
  type PixChargeView,
  type TerminalPaymentSettings,
} from '@bipae/domain';
import {
  cashSuggestions,
  PdvError,
  qrMatrix,
  summarizePayments,
  type ByMethod,
  type CloseResult,
  type PdvService,
  type StoredSale,
  type TenderInput,
} from '@bipae/pdv-core';
import { DriverTefPort, type TefDriver } from '@bipae/platform';
import { SimulatedTef } from '@bipae/platform/simulators';
import { Alert, Badge, Button, cx, Modal, TextField } from '@bipae/ui';
import {
  Banknote,
  Check,
  CreditCard,
  NotebookPen,
  QrCode,
  Ticket,
  WalletCards,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { AuthorizablePermission, PosBackend } from './backend';
import { useTefScreen } from './tef-screen';

export const brl = (c: number) => formatBRL(c as Cents);

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Algo deu errado. Tente de novo.';
}

/** Money text input → cents, with pt-BR parsing. */
function useMoney(initial = '') {
  const [text, setText] = useState(initial);
  const cents = parseBRL(text);
  return { text, setText, cents: cents !== null && cents >= 0 ? cents : null };
}

// ---------------------------------------------------------------- authorization

const PERMISSION_TEXT: Record<AuthorizablePermission, string> = {
  'pos.discount.above_limit': 'dar este desconto',
  'pos.sale.cancel': 'cancelar a venda',
  'pos.cash.withdrawal': 'fazer a sangria',
};

export function AuthorizeDialog({
  permission,
  backend,
  onAuthorized,
  onClose,
}: {
  permission: AuthorizablePermission;
  backend: PosBackend;
  /** `proof`: assinatura do servidor que vai junto no evento (PIE ACH-03). */
  onAuthorized: (userId: string, proof?: string) => void;
  onClose: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { userId, proof } = await backend.authorize(email, password, permission);
      onAuthorized(userId, proof);
    } catch (err) {
      setError(
        (err as { code?: string }).code === 'offline'
          ? 'Sem internet, só quem já tem essa permissão pode fazer isso neste caixa.'
          : errorMessage(err),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      mobileFullscreen
      open
      onOpenChange={(o) => !o && onClose()}
      title="Autorização do gerente"
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-muted">
          Peça a um gerente para entrar com os dados dele e {PERMISSION_TEXT[permission]}.
        </p>
        {error && <Alert>{error}</Alert>}
        <TextField
          label="E-mail do gerente"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus
        />
        <TextField
          label="Senha do gerente"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button type="submit" loading={busy}>
          Autorizar
        </Button>
      </form>
    </Modal>
  );
}

/** Troca de operador (F2-03): quem entra confirma com o e-mail e a senha dele. */
export function OperatorDialog({
  backend,
  onChanged,
  onClose,
}: {
  backend: PosBackend;
  onChanged: (operator: { userId: string; name: string; permissions: string[] }) => Promise<void>;
  onClose: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!backend.operator) return setError('Este caixa ainda não permite trocar o operador.');
    setBusy(true);
    setError(null);
    try {
      await onChanged(await backend.operator(email, password));
    } catch (err) {
      setError(
        (err as { code?: string }).code === 'offline'
          ? 'A troca de operador precisa de internet para conferir a senha.'
          : errorMessage(err),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal mobileFullscreen open onOpenChange={(o) => !o && onClose()} title="Trocar operador">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-muted">
          O caixa continua aberto. As próximas vendas saem no nome de quem entrar.
        </p>
        {error && <Alert>{error}</Alert>}
        <TextField
          label="E-mail de quem vai operar"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus
        />
        <TextField
          label="Senha"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button type="submit" loading={busy}>
          Entrar no caixa
        </Button>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- quantity / weight

export function QuantityDialog({
  title,
  unit,
  weighable,
  onReadScale,
  onConfirm,
  onClose,
}: {
  title: string;
  unit: string;
  weighable: boolean;
  onReadScale?: () => Promise<number>;
  onConfirm: (quantityMilli: number) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = Number(text.replace(',', '.'));
    const milli = Math.round(value * 1000);
    if (!Number.isFinite(value) || milli <= 0)
      return setError('Informe uma quantidade maior que zero.');
    if (!weighable && milli % 1000 !== 0)
      return setError('Este produto é vendido por unidade inteira.');
    onConfirm(milli);
  };
  return (
    <Modal mobileFullscreen open onOpenChange={(o) => !o && onClose()} title={title}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label={weighable ? `Peso (${unit})` : 'Quantidade'}
          inputMode="decimal"
          placeholder={weighable ? '0,000' : '1'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          error={error}
          autoFocus
        />
        <div className="flex gap-2">
          <Button type="submit">Confirmar</Button>
          {onReadScale && (
            <Button
              variant="secondary"
              onClick={async () => {
                try {
                  const grams = await onReadScale();
                  setText((grams / 1000).toFixed(3).replace('.', ','));
                  setError(null);
                } catch (err) {
                  setError(errorMessage(err));
                }
              }}
            >
              Ler balança
            </Button>
          )}
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- discount

export function DiscountDialog({
  subtotalCents,
  item,
  limitPercent,
  canExceed,
  onConfirm,
  onClose,
}: {
  subtotalCents: number;
  /** Item selecionado: o desconto pode ir só nele (F2-01). */
  item?: { name: string; grossCents: number } | null;
  limitPercent: number;
  canExceed: boolean;
  onConfirm: (discountCents: number, scope: 'item' | 'sale') => void;
  onClose: () => void;
}) {
  const [scope, setScope] = useState<'item' | 'sale'>(item ? 'item' : 'sale');
  const [mode, setMode] = useState<'percent' | 'value'>('percent');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const base = scope === 'item' && item ? item.grossCents : subtotalCents;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    let cents: number | null;
    if (mode === 'percent') {
      const pct = Number(text.replace(',', '.'));
      cents =
        Number.isFinite(pct) && pct >= 0 && pct <= 100
          ? Math.floor((base * Math.round(pct * 100) + 5000) / 10000)
          : null;
    } else cents = parseBRL(text);
    if (cents === null || cents < 0 || cents > base) {
      return setError(
        scope === 'item'
          ? 'O desconto não pode ser maior que o valor do item.'
          : 'Desconto inválido.',
      );
    }
    onConfirm(cents, scope);
  };
  return (
    <Modal
      mobileFullscreen
      open
      onOpenChange={(o) => !o && onClose()}
      title={scope === 'item' ? 'Desconto no item' : 'Desconto na venda'}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        {item && (
          <div className="flex gap-2" role="radiogroup" aria-label="Onde aplicar o desconto">
            {(['item', 'sale'] as const).map((s) => (
              <Button
                key={s}
                variant={scope === s ? 'primary' : 'secondary'}
                role="radio"
                aria-checked={scope === s}
                onClick={() => setScope(s)}
              >
                {s === 'item' ? `Neste item: ${item.name}` : 'Na venda toda'}
              </Button>
            ))}
          </div>
        )}
        <div className="flex gap-2" role="radiogroup" aria-label="Tipo de desconto">
          {(['percent', 'value'] as const).map((m) => (
            <Button
              key={m}
              variant={mode === m ? 'primary' : 'secondary'}
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
            >
              {m === 'percent' ? 'Porcentagem (%)' : 'Valor (R$)'}
            </Button>
          ))}
        </div>
        <TextField
          label={mode === 'percent' ? 'Desconto (%)' : 'Desconto (R$)'}
          inputMode="decimal"
          value={text}
          onChange={(e) => setText(e.target.value)}
          error={error}
          autoFocus
        />
        {!canExceed && (
          <p className="text-sm text-muted">
            Acima de {limitPercent}% precisa da autorização de um gerente.
          </p>
        )}
        <Button type="submit">Aplicar desconto</Button>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- customer

export function CustomerDialog({
  current,
  onConfirm,
  onClose,
}: {
  current: string | null;
  onConfirm: (taxId: string | null) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(current ? formatTaxId(current) : '');
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return onConfirm(null);
    const parsed = parseTaxId(text);
    if (!parsed) return setError('CPF ou CNPJ inválido. Confira os números.');
    onConfirm(parsed.value);
  };
  return (
    <Modal mobileFullscreen open onOpenChange={(o) => !o && onClose()} title="CPF/CNPJ na nota">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label="CPF ou CNPJ do cliente"
          inputMode="numeric"
          value={text}
          onChange={(e) => setText(formatTaxId(e.target.value))}
          error={error}
          autoFocus
        />
        <div className="flex gap-2">
          <Button type="submit">Confirmar</Button>
          {current && (
            <Button variant="secondary" onClick={() => onConfirm(null)}>
              Remover
            </Button>
          )}
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- payment

/**
 * Formas de pagamento em cartões coloridos (F8-15), cada uma com a sua tecla: com o foco no
 * valor, apertar a letra escolhe a forma.
 */
const METHOD_KEYS: {
  method: PaymentMethod;
  key: string;
  icon: LucideIcon;
  tone: { tile: string; circle: string };
  /** Apelido que o cliente fala, ao lado do nome oficial. */
  nickname?: string;
}[] = [
  {
    method: 'cash',
    key: 'D',
    icon: Banknote,
    tone: { tile: 'bg-tile-green', circle: 'bg-tile-green-strong' },
  },
  {
    method: 'pix',
    key: 'P',
    icon: QrCode,
    tone: { tile: 'bg-tile-blue', circle: 'bg-tile-blue-strong' },
  },
  {
    method: 'debit',
    key: 'B',
    icon: CreditCard,
    tone: { tile: 'bg-tile-purple', circle: 'bg-tile-purple-strong' },
  },
  {
    method: 'credit',
    key: 'C',
    icon: WalletCards,
    tone: { tile: 'bg-tile-orange', circle: 'bg-tile-orange-strong' },
  },
  {
    method: 'voucher',
    key: 'V',
    icon: Ticket,
    tone: { tile: 'bg-tile-yellow', circle: 'bg-tile-yellow-strong' },
  },
  {
    method: 'store_credit',
    key: 'R',
    icon: NotebookPen,
    tone: { tile: 'bg-surface-2', circle: 'bg-muted' },
    nickname: 'fiado',
  },
];

/** Notas rápidas: o valor certo, os arredondamentos sugeridos e as notas de R$ 50 e R$ 100. */
export function quickCash(dueCents: number): number[] {
  return [...new Set([...cashSuggestions(dueCents), 5000, 10000])]
    .filter((c) => c > 0)
    .sort((a, b) => a - b)
    .slice(0, 6);
}

const PIX_HINT: Record<TerminalPaymentSettings['pix'], string> = {
  manual: 'Receba pela chave Pix da loja e confirme quando cair.',
  api: 'O QR sai do seu banco e o pagamento entra sozinho quando o banco confirma.',
  psp: 'O QR sai da sua conta no parceiro e o pagamento entra sozinho quando ele confirma.',
  static_qr: 'O caixa mostra o QR com o valor; confirme quando o dinheiro cair.',
  simulator: 'Simulador: aprova sozinho, para treinar. Ninguém é cobrado.',
};

/** QR do Pix desenhado em SVG, com o "copia e cola" embaixo. */
function PixQr({ payload, cents }: { payload: string; cents: number }) {
  const matrix = qrMatrix(payload);
  const quiet = 4;
  const side = matrix.length + quiet * 2;
  let path = '';
  matrix.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) path += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    }),
  );
  return (
    <div className="mt-3 flex flex-col items-center gap-2">
      <svg
        viewBox={`0 0 ${side} ${side}`}
        className="size-56 bg-white"
        role="img"
        aria-label={`QR Code do Pix de ${brl(cents)}`}
        shapeRendering="crispEdges"
      >
        <path d={path} fill="#000" />
      </svg>
      <details className="w-full text-sm">
        <summary className="cursor-pointer font-semibold">Pix copia e cola</summary>
        <p className="mt-1 break-all font-mono text-xs" data-testid="pix-copia-e-cola">
          {payload}
        </p>
      </details>
    </div>
  );
}

/**
 * Crediário no pagamento (F2-02): sem cliente (undefined), cliente sem crediário (null) ou o
 * valor disponível no limite.
 */
export type CreditInfo = { availableCents: number } | null | undefined;

function creditHint(credit: CreditInfo): string {
  if (credit === undefined)
    return 'Para vender no crediário, informe o CPF ou CNPJ do cliente (F6).';
  if (credit === null)
    return 'Este cliente não tem crediário. O limite é liberado no cadastro do cliente.';
  return `Disponível no crediário: ${brl(credit.availableCents)}.`;
}

/**
 * Several payments on one sale. Pix and cards use simulators until the real PSP/TEF
 * integrations (Phase 6); the screen says so.
 */
export function PaymentDialog({
  totalCents,
  credit,
  methods,
  payments = { card: 'manual', pix: 'manual' },
  pixApi,
  cardApi,
  tef,
  onPaid,
  onClose,
}: {
  totalCents: number;
  credit?: CreditInfo;
  /** Formas aceitas (autoatendimento, F5-06); sem a lista, todas. */
  methods?: PaymentMethod[];
  /** Meios de pagamento da loja (F8-08): maquininha à parte, QR do Pix ou simulador. */
  payments?: TerminalPaymentSettings;
  /** Cartão na maquininha comandada pela internet (F8-10): manda o valor e acompanha. */
  cardApi?: {
    create(amountCents: number, method: 'credit' | 'debit'): Promise<CardChargeView>;
    get(id: string): Promise<CardChargeView>;
    cancel(id: string): Promise<CardChargeView>;
  };
  /** Pix com QR dinâmico do banco ou do parceiro (F8-09): cria e acompanha até confirmar. */
  pixApi?: {
    create(amountCents: number): Promise<PixChargeView>;
    get(txid: string): Promise<PixChargeView>;
    cancel?(txid: string): Promise<PixChargeView>;
  };
  /**
   * TEF com pinpad (F8-11): o cartão passa pelo driver, com os passos na tela do caixa. A transação
   * aprovada fica pendente até a venda ser gravada; se o caixa desistir, ela é desfeita.
   */
  tef?: { driver: TefDriver; onReceipts?: (lines: string[]) => void };
  onPaid: (tenders: TenderInput[]) => Promise<void>;
  onClose: () => void;
}) {
  const [tenders, setTenders] = useState<TenderInput[]>([]);
  const tefScreen = useTefScreen();
  const tefPort = useMemo(
    () => (tef ? new DriverTefPort(tef.driver, tefScreen.ui) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tef?.driver, tefScreen.ui],
  );
  const tefPending = useRef<string[]>([]);
  const paidRef = useRef(false);
  const undoTef = () => {
    const ids = tefPending.current;
    tefPending.current = [];
    for (const id of ids) void tefPort?.finish?.(id, false).catch(() => undefined);
  };
  // Fechou sem pagar: o que o pinpad aprovou e a venda não gravou é desfeito.
  useEffect(
    () => () => {
      if (!paidRef.current) undoTef();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const allowed = METHOD_KEYS.filter((m) => !methods || methods.includes(m.method));
  const [method, setMethod] = useState<PaymentMethod>(allowed[0]?.method ?? 'cash');
  const summary = useMemo(() => {
    try {
      return summarizePayments(totalCents, tenders);
    } catch {
      return null;
    }
  }, [tenders, totalCents]);
  const remaining = summary?.remainingCents ?? totalCents;
  const amount = useMoney(brl(remaining).replace('R$ ', ''));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pixPending, setPixPending] = useState<number | null>(null);
  const [cardPending, setCardPending] = useState<{ method: PaymentMethod; cents: number } | null>(
    null,
  );
  const [nsu, setNsu] = useState('');
  const [charge, setCharge] = useState<PixChargeView | null>(null);
  const [pixNotice, setPixNotice] = useState<string | null>(null);
  const [cardCharge, setCardCharge] = useState<CardChargeView | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  // Acompanha a maquininha: aprovou, o cartão entra sozinho (F8-10).
  useEffect(() => {
    if (!cardCharge || cardCharge.status !== 'pending' || !cardApi) return;
    const timer = setInterval(() => {
      void cardApi
        .get(cardCharge.id)
        .then((next) => {
          if (next.status === 'paid') {
            setTenders((t) => [
              ...t,
              {
                method: next.method,
                receivedCents: next.amountCents,
                provider: 'Mercado Pago Point',
                nsu: next.paymentId,
              },
            ]);
            setCardCharge(null);
          } else {
            setCardCharge(next);
          }
        })
        .catch(() => undefined);
    }, 3000);
    return () => clearInterval(timer);
  }, [cardCharge, cardApi]);

  // Acompanha a cobrança: quando o banco confirma, o Pix entra sozinho (F8-09).
  useEffect(() => {
    if (!charge || charge.status !== 'pending' || !pixApi) return;
    const timer = setInterval(() => {
      void pixApi
        .get(charge.txid)
        .then((next) => {
          if (next.status === 'paid') {
            setTenders((t) => [
              ...t,
              {
                method: 'pix',
                receivedCents: next.amountCents,
                provider: next.providerName,
                nsu: next.endToEndId,
              },
            ]);
            setCharge(null);
          } else {
            setCharge(next);
          }
        })
        .catch(() => undefined);
    }, 3000);
    return () => clearInterval(timer);
  }, [charge, pixApi]);
  const simulatedTef = useMemo(() => new SimulatedTef(), []);
  // O QR do Pix com a chave da loja e o valor (F8-08); sem chave configurada, Pix manual.
  const pixPayload = useMemo(() => {
    // QR da loja: no modo QR estático e como reserva da API Pix ou do parceiro quando não respondem.
    if (pixPending === null || payments.pix === 'simulator' || !payments.pixStatic) return null;
    try {
      return staticPixPayload({ ...payments.pixStatic, amountCents: pixPending });
    } catch {
      return null;
    }
  }, [pixPending, payments]);

  useEffect(() => {
    amount.setText(brl(remaining).replace('R$ ', ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining]);

  const add = async (received: number | null) => {
    setError(null);
    if (received === null || received <= 0) return setError('Informe um valor válido.');
    if (method !== 'cash' && received > remaining)
      return setError('Só pagamento em dinheiro pode passar do valor (para dar troco).');
    if (method === 'pix') {
      setPixNotice(null);
      if ((payments.pix === 'api' || payments.pix === 'psp') && pixApi) {
        setBusy(true);
        try {
          setCharge(await pixApi.create(received));
          return;
        } catch (err) {
          // Sem internet ou banco fora: segue com o QR da loja ou o Pix manual.
          setPixNotice(`${errorMessage(err)} Use o QR da loja e confirme quando cair.`);
        } finally {
          setBusy(false);
        }
      }
      return setPixPending(received);
    }
    if (method === 'store_credit') {
      const used = tenders
        .filter((t) => t.method === 'store_credit')
        .reduce((a, t) => a + t.receivedCents, 0);
      if (!credit) return setError(creditHint(credit));
      if (used + received > credit.availableCents) return setError(creditHint(credit));
    }
    if (tefPort && (method === 'credit' || method === 'debit' || method === 'voucher')) {
      setBusy(true);
      try {
        const result = await tefPort.pay({ amountCents: received, method, saleId: 'pending' });
        if (!result.approved) return setError(result.message);
        if (result.transactionId) tefPending.current.push(result.transactionId);
        if (result.receipts && tef?.onReceipts) {
          tef.onReceipts([...result.receipts.merchant, '', ...result.receipts.customer]);
        }
        return setTenders((t) => [
          ...t,
          {
            method,
            receivedCents: received,
            nsu: result.nsu ?? null,
            authorizationCode: result.authorizationCode ?? null,
            provider: result.acquirer ?? 'TEF',
          },
        ]);
      } catch (err) {
        return setError(errorMessage(err));
      } finally {
        tefScreen.close();
        setBusy(false);
      }
    }
    if ((method === 'credit' || method === 'debit') && payments.card === 'mp_point' && cardApi) {
      setBusy(true);
      try {
        setCardCharge(await cardApi.create(received, method));
        return;
      } catch (err) {
        // Sem internet ou maquininha fora: cobra na maquininha à parte.
        setError(`${errorMessage(err)}`);
        setNsu('');
        return setCardPending({ method, cents: received });
      } finally {
        setBusy(false);
      }
    }
    if (
      (method === 'credit' || method === 'debit' || method === 'voucher') &&
      payments.card !== 'simulator'
    ) {
      // Maquininha à parte: o operador cobra nela e confirma aqui (F8-08).
      setNsu('');
      return setCardPending({ method, cents: received });
    }
    if (method === 'credit' || method === 'debit' || method === 'voucher') {
      setBusy(true);
      const result = await simulatedTef.pay({ amountCents: received, method, saleId: 'pending' });
      setBusy(false);
      if (!result.approved) return setError(result.message);
      return setTenders((t) => [
        ...t,
        {
          method,
          receivedCents: received,
          nsu: result.nsu ?? null,
          authorizationCode: result.authorizationCode ?? null,
          provider: 'Simulador',
        },
      ]);
    }
    setTenders((t) => [...t, { method, receivedCents: received }]);
  };

  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      await onPaid(tenders);
      // Venda gravada: confirma no pinpad (segunda fase do TEF).
      paidRef.current = true;
      const ids = tefPending.current;
      tefPending.current = [];
      for (const id of ids) void tefPort?.finish?.(id, true).catch(() => undefined);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const done = remaining === 0 && tenders.length > 0;
  // Troco antes de confirmar (F8-15): conforme o operador digita o valor recebido.
  const changePreview =
    !done && method === 'cash' && amount.cents !== null && amount.cents > remaining
      ? amount.cents - remaining
      : 0;
  /** A letra de cada forma (D, P, B, C, V, R) escolhe a forma, com o foco no valor ou fora dos campos. */
  const onShortcut = (e: KeyboardEvent) => {
    if (done || e.ctrlKey || e.altKey || e.metaKey || e.key.length !== 1) return;
    const target = e.target as HTMLElement;
    if (target instanceof HTMLInputElement && target !== amountRef.current) return;
    const hit = allowed.find((m) => m.key === e.key.toUpperCase());
    if (!hit) return;
    e.preventDefault();
    setMethod(hit.method);
  };
  // Sair com Pix ou maquininha aguardando: cancela a cobrança antes, para o cliente não pagar uma
  // venda que não existe (PIE R2-03). Se ela já tinha sido paga, o pagamento entra e a janela fica.
  const [leaving, setLeaving] = useState(false);
  const leave = async () => {
    setLeaving(true);
    try {
      if (charge?.status === 'pending' && pixApi?.cancel) {
        const next = await pixApi.cancel(charge.txid);
        if (next.status === 'paid') {
          setTenders((t) => [
            ...t,
            {
              method: 'pix',
              receivedCents: next.amountCents,
              provider: next.providerName,
              nsu: next.endToEndId,
            },
          ]);
          setCharge(null);
          setError('O Pix já tinha sido pago e entrou na venda. Finalize a venda.');
          return;
        }
      }
      if (cardCharge?.status === 'pending' && cardApi) {
        const next = await cardApi.cancel(cardCharge.id);
        if (next.status === 'paid') {
          setTenders((t) => [
            ...t,
            {
              method: next.method,
              receivedCents: next.amountCents,
              provider: 'Mercado Pago Point',
              nsu: next.paymentId,
            },
          ]);
          setCardCharge(null);
          setError('O cartão já tinha sido aprovado e entrou na venda. Finalize a venda.');
          return;
        }
      }
      onClose();
    } catch (err) {
      setError(
        `Não deu para cancelar a cobrança que está aguardando: ${errorMessage(err)} Tente de novo antes de sair.`,
      );
    } finally {
      setLeaving(false);
    }
  };
  return (
    <Modal
      mobileFullscreen
      open
      onOpenChange={(o) => !o && !busy && !leaving && void leave()}
      title="Pagamento"
      wide
    >
      <div className="grid gap-6 max-sm:gap-2 md:grid-cols-[3fr_2fr]" onKeyDown={onShortcut}>
        <div className="flex flex-col gap-4 max-sm:gap-2">
          <div role="radiogroup" aria-label="Forma de pagamento" className="grid grid-cols-3 gap-2">
            {allowed.map(({ method: m, key, icon: Icon, tone, nickname }) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={method === m}
                aria-keyshortcuts={key}
                aria-label={PAYMENT_LABELS[m]}
                onClick={() => {
                  setMethod(m);
                  amountRef.current?.focus();
                }}
                disabled={done}
                className={cx(
                  'relative flex min-h-20 flex-col items-start justify-between gap-1 rounded-2xl border-2 p-2 text-left text-sm font-bold leading-tight transition disabled:cursor-not-allowed disabled:opacity-50 max-sm:min-h-14 max-sm:gap-0.5 max-sm:p-1.5 max-sm:text-xs',
                  tone.tile,
                  method === m
                    ? 'border-primary shadow-md ring-2 ring-primary'
                    : 'border-transparent hover:border-border [[data-contrast=high]_&]:border-border',
                )}
              >
                <span
                  aria-hidden
                  className={cx(
                    'flex size-9 shrink-0 items-center justify-center rounded-full text-tile-icon max-sm:size-6',
                    tone.circle,
                  )}
                >
                  {method === m ? (
                    <Check className="size-5 max-sm:size-3.5" />
                  ) : (
                    <Icon className="size-5 max-sm:size-3.5" />
                  )}
                </span>
                <span className="min-w-0">
                  {/* Quebra depois da barra: "Vale-refeição/" e "alimentação" em linhas inteiras. */}
                  {PAYMENT_LABELS[m].replace('/', `/${String.fromCharCode(0x200b)}`)}
                  {nickname && <span className="font-normal"> ({nickname})</span>}
                </span>
                <kbd
                  aria-hidden
                  className="absolute right-2 top-2 rounded-md border border-border bg-surface px-1.5 font-mono text-xs font-semibold text-text max-sm:hidden"
                >
                  {key}
                </kbd>
              </button>
            ))}
          </div>
          {!done && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void add(amount.cents);
              }}
              className="flex flex-col gap-3 max-sm:gap-2"
            >
              <TextField
                ref={amountRef}
                label={method === 'cash' ? 'Valor recebido (R$)' : 'Valor (R$)'}
                inputMode="decimal"
                value={amount.text}
                onChange={(e) => amount.setText(e.target.value)}
                className="text-2xl font-bold tabular-nums max-sm:text-xl"
                autoFocus
              />
              {method === 'cash' && (
                <div
                  className="grid grid-cols-3 gap-2 [&>button]:whitespace-nowrap [&>button]:px-1 max-sm:[&>button]:min-h-10 max-sm:[&>button]:text-sm"
                  role="group"
                  aria-label="Notas rápidas"
                >
                  {quickCash(remaining).map((c) => (
                    <Button key={c} variant="secondary" onClick={() => void add(c)}>
                      {brl(c)}
                    </Button>
                  ))}
                </div>
              )}
              {method === 'store_credit' && (
                <p className="text-sm text-muted">{creditHint(credit)}</p>
              )}
              {method !== 'cash' && method !== 'store_credit' && (
                <p className="text-sm text-muted">
                  {method === 'pix'
                    ? PIX_HINT[payments.pix]
                    : tefPort
                      ? 'O valor vai para o pinpad: siga os passos que aparecem na tela.'
                      : payments.card === 'simulator'
                        ? 'Simulador: aprova sozinho, para treinar. Ninguém é cobrado.'
                        : payments.card === 'mp_point' && method !== 'voucher' && cardApi
                          ? 'O valor vai sozinho para a maquininha Point.'
                          : 'Cobre na maquininha e confirme aqui.'}
                </p>
              )}
              <Button type="submit" loading={busy}>
                Adicionar {PAYMENT_LABELS[method].toLowerCase()}
              </Button>
            </form>
          )}
          {charge && (
            <Alert tone="warning" title={charge.providerName}>
              {charge.status === 'pending' ? (
                <>
                  <p>Mostre o QR ao cliente. O pagamento entra sozinho quando for confirmado.</p>
                  <PixQr payload={charge.copyPaste} cents={charge.amountCents} />
                  <p className="mt-2 text-sm" role="status">
                    Esperando a confirmação do pagamento…
                  </p>
                </>
              ) : (
                <p>{charge.message ?? 'O QR não vale mais. Gere outro.'}</p>
              )}
              <div className="mt-3 flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    const current = charge;
                    if (current.status !== 'pending' || !pixApi?.cancel) return setCharge(null);
                    // Cancela no parceiro; se já tinha sido pago, o Pix entra em vez de sumir.
                    void pixApi
                      .cancel(current.txid)
                      .then((next) => {
                        if (next.status === 'paid') {
                          setTenders((t) => [
                            ...t,
                            {
                              method: 'pix',
                              receivedCents: next.amountCents,
                              provider: next.providerName,
                              nsu: next.endToEndId,
                            },
                          ]);
                          setCharge(null);
                        } else {
                          setCharge(null);
                          if (next.message && next.message !== 'Pix cancelado.') {
                            setPixNotice(next.message);
                          }
                        }
                      })
                      .catch((err: unknown) => setError(errorMessage(err)));
                  }}
                >
                  {charge.status === 'pending' ? 'Cancelar Pix' : 'Fechar'}
                </Button>
              </div>
            </Alert>
          )}
          {pixNotice && <Alert tone="warning">{pixNotice}</Alert>}
          {cardCharge && (
            <Alert tone="warning" title={`${PAYMENT_LABELS[cardCharge.method]} na Point`}>
              {cardCharge.status === 'pending' ? (
                <p role="status">
                  {brl(cardCharge.amountCents)} enviado para a maquininha. Peça para o cliente
                  aproximar ou inserir o cartão; a aprovação entra sozinha.
                </p>
              ) : (
                <p>{cardCharge.message}</p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {cardCharge.status === 'pending' ? (
                  <Button
                    variant="secondary"
                    onClick={() =>
                      void cardApi
                        ?.cancel(cardCharge.id)
                        .then(setCardCharge)
                        .catch((err: unknown) => setError(errorMessage(err)))
                    }
                  >
                    Cancelar na maquininha
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setNsu('');
                        setCardPending({
                          method: cardCharge.method,
                          cents: cardCharge.amountCents,
                        });
                        setCardCharge(null);
                      }}
                    >
                      Cobrar na maquininha à parte
                    </Button>
                    <Button variant="ghost" onClick={() => setCardCharge(null)}>
                      Fechar
                    </Button>
                  </>
                )}
              </div>
            </Alert>
          )}
          {cardPending !== null && (
            <Alert tone="warning" title={`${PAYMENT_LABELS[cardPending.method]} na maquininha`}>
              <p>
                Cobre <strong>{brl(cardPending.cents)}</strong> na maquininha. Quando aprovar,
                confirme aqui.
              </p>
              <div className="mt-3">
                <TextField
                  label="Código da transação (NSU), opcional"
                  inputMode="numeric"
                  value={nsu}
                  onChange={(e) => setNsu(e.target.value.replace(/[^0-9A-Za-z]/g, '').slice(0, 40))}
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  onClick={() => {
                    setTenders((t) => [
                      ...t,
                      {
                        method: cardPending.method,
                        receivedCents: cardPending.cents,
                        provider: 'Maquininha à parte',
                        nsu: nsu || null,
                      },
                    ]);
                    setCardPending(null);
                  }}
                >
                  Aprovado na maquininha
                </Button>
                <Button variant="secondary" onClick={() => setCardPending(null)}>
                  Não aprovou
                </Button>
              </div>
            </Alert>
          )}
          {pixPending !== null && (
            <Alert tone="warning" title={payments.pix === 'simulator' ? 'Pix (simulador)' : 'Pix'}>
              {pixPayload ? (
                <>
                  <p>Mostre o QR ao cliente. Quando o dinheiro cair na conta, confirme aqui.</p>
                  <PixQr payload={pixPayload} cents={pixPending} />
                </>
              ) : (
                <p>
                  {payments.pix === 'simulator'
                    ? `QR Code de ${brl(pixPending)} gerado. Peça para o cliente pagar.`
                    : `Receba ${brl(pixPending)} pela chave Pix da loja e confirme quando cair.`}
                </p>
              )}
              <div className="mt-3 flex gap-2">
                <Button
                  onClick={() => {
                    setTenders((t) => [
                      ...t,
                      {
                        method: 'pix',
                        receivedCents: pixPending,
                        provider:
                          payments.pix === 'simulator'
                            ? 'Simulador'
                            : pixPayload
                              ? 'Pix (QR da loja)'
                              : 'Pix (chave da loja)',
                        nsu: `PIX${Date.now()}`,
                      },
                    ]);
                    setPixPending(null);
                  }}
                >
                  Pagamento recebido
                </Button>
                <Button variant="secondary" onClick={() => setPixPending(null)}>
                  Cancelar Pix
                </Button>
              </div>
            </Alert>
          )}
          {error && <Alert>{error}</Alert>}
          {tefScreen.dialog}
        </div>
        <div className="flex flex-col gap-3 rounded-2xl bg-surface-2 p-4 max-sm:gap-1.5 max-sm:p-3">
          <Row label="Total da venda" value={brl(totalCents)} strong />
          {summary?.payments.map((p, i) => (
            <Row
              key={i}
              label={PAYMENT_LABELS[p.method]}
              value={brl(p.amountCents + p.changeCents)}
            />
          ))}
          <div
            className={cx(
              'flex items-baseline justify-between gap-2 border-t border-border pt-2 max-sm:pt-1',
              remaining > 0 ? 'text-text' : 'text-success',
            )}
          >
            <span className="font-semibold">Falta pagar</span>
            <span
              className="text-3xl font-black tabular-nums max-sm:text-2xl"
              data-testid="payment-remaining"
            >
              {brl(remaining)}
            </span>
          </div>
          {(summary?.changeCents ?? 0) > 0 || changePreview > 0 ? (
            <div
              className="rounded-2xl bg-accent px-4 py-3 text-center text-accent-contrast shadow-md max-sm:py-1.5"
              data-testid="payment-change"
            >
              <p className="text-sm font-bold uppercase tracking-widest">Troco</p>
              <p className="whitespace-nowrap text-4xl font-black tabular-nums max-sm:text-3xl">
                {brl((summary?.changeCents ?? 0) > 0 ? summary!.changeCents : changePreview)}
              </p>
            </div>
          ) : null}
          {tenders.length > 0 && (
            <Button
              variant="ghost"
              onClick={() => {
                undoTef();
                setTenders([]);
              }}
              disabled={busy}
            >
              Refazer pagamentos
            </Button>
          )}
          <Button
            size="lg"
            onClick={() => void finish()}
            disabled={!done}
            loading={busy}
            aria-keyshortcuts="F10"
          >
            Finalizar venda
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cx('flex items-center justify-between gap-2', strong && 'text-lg font-bold')}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------- cash menu

export function CashDialog({
  pdv,
  canWithdraw,
  requestAuthorization,
  onClosed,
  onClose,
}: {
  pdv: PdvService;
  canWithdraw: boolean;
  requestAuthorization: (permission: AuthorizablePermission) => Promise<string | null>;
  onClosed: (result: CloseResult) => void;
  onClose: () => void;
}) {
  const [view, setView] = useState<'menu' | 'withdrawal' | 'supply' | 'close'>('menu');
  const amount = useMoney();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [declared, setDeclared] = useState<Record<string, string>>({});

  const saveMovement = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (amount.cents === null || amount.cents <= 0)
      return setError('Informe um valor maior que zero.');
    try {
      let authorizedBy: string | null = null;
      if (view === 'withdrawal' && !canWithdraw) {
        authorizedBy = await requestAuthorization('pos.cash.withdrawal');
        if (!authorizedBy) return;
      }
      await pdv.addMovement(
        view as 'withdrawal' | 'supply',
        amount.cents,
        reason || null,
        authorizedBy,
      );
      setMessage(
        `${view === 'withdrawal' ? 'Sangria' : 'Suprimento'} de ${brl(amount.cents)} registrado.`,
      );
      amount.setText('');
      setReason('');
      setView('menu');
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const close = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const values: Partial<ByMethod> = {};
    for (const [m, text] of Object.entries(declared)) {
      if (!text.trim()) continue;
      const cents = parseBRL(text);
      if (cents === null || cents < 0)
        return setError(`Valor inválido em ${PAYMENT_LABELS[m as PaymentMethod]}.`);
      values[m as PaymentMethod] = cents;
    }
    try {
      onClosed(await pdv.closeSession(values));
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Modal mobileFullscreen open onOpenChange={(o) => !o && onClose()} title="Caixa">
      {message && <Alert tone="success">{message}</Alert>}
      {error && <Alert>{error}</Alert>}
      {view === 'menu' && (
        <div className="mt-4 grid gap-3">
          <Button variant="secondary" size="lg" onClick={() => setView('withdrawal')}>
            Sangria (retirar dinheiro)
          </Button>
          <Button variant="secondary" size="lg" onClick={() => setView('supply')}>
            Suprimento (colocar troco)
          </Button>
          <Button variant="danger" size="lg" onClick={() => setView('close')}>
            Fechar o caixa
          </Button>
        </div>
      )}
      {(view === 'withdrawal' || view === 'supply') && (
        <form onSubmit={saveMovement} className="mt-4 flex flex-col gap-4">
          <TextField
            label="Valor (R$)"
            inputMode="decimal"
            value={amount.text}
            onChange={(e) => amount.setText(e.target.value)}
            autoFocus
          />
          <TextField
            label="Motivo (opcional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex gap-2">
            <Button type="submit">
              Registrar {view === 'withdrawal' ? 'sangria' : 'suprimento'}
            </Button>
            <Button variant="secondary" onClick={() => setView('menu')}>
              Voltar
            </Button>
          </div>
        </form>
      )}
      {view === 'close' && (
        <form onSubmit={close} className="mt-4 flex flex-col gap-4">
          <p className="text-muted">
            Conte o que está no caixa e informe abaixo. O sistema só mostra se sobrou ou faltou
            depois que você confirmar (fechamento cego).
          </p>
          {/* No celular, duas colunas para o fechamento caber na tela (F8-14). */}
          <div className="flex flex-col gap-4 max-sm:grid max-sm:grid-cols-2 max-sm:gap-3">
            {(['cash', 'pix', 'debit', 'credit', 'voucher'] as PaymentMethod[]).map((m) => (
              <TextField
                key={m}
                label={`${PAYMENT_LABELS[m]} (R$)`}
                inputMode="decimal"
                value={declared[m] ?? ''}
                onChange={(e) => setDeclared((d) => ({ ...d, [m]: e.target.value }))}
              />
            ))}
          </div>
          <Button type="submit" variant="danger">
            Confirmar fechamento
          </Button>
        </form>
      )}
    </Modal>
  );
}

export function CloseResultDialog({
  result,
  onClose,
}: {
  result: CloseResult;
  onClose: () => void;
}) {
  const methods = (Object.keys(result.expected) as PaymentMethod[]).filter(
    (m) => result.expected[m] !== 0 || result.declared[m] !== 0,
  );
  return (
    <Modal mobileFullscreen open onOpenChange={(o) => !o && onClose()} title="Caixa fechado">
      <table className="w-full text-left">
        <thead className="text-sm text-muted">
          <tr>
            <th scope="col">Forma</th>
            <th scope="col" className="text-right">
              Esperado
            </th>
            <th scope="col" className="text-right">
              Contado
            </th>
            <th scope="col" className="text-right">
              Diferença
            </th>
          </tr>
        </thead>
        <tbody>
          {methods.map((m) => (
            <tr key={m} className="border-t border-border">
              <td className="py-2">{PAYMENT_LABELS[m]}</td>
              <td className="text-right tabular-nums">{brl(result.expected[m])}</td>
              <td className="text-right tabular-nums">{brl(result.declared[m])}</td>
              <td
                className={cx(
                  'text-right tabular-nums font-semibold',
                  result.differences[m] < 0 && 'text-danger',
                )}
              >
                {brl(result.differences[m])}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-4">
        {result.differenceCents === 0 ? (
          <Alert tone="success">Bateu certinho. Bipaê!</Alert>
        ) : (
          <Alert tone="warning">
            {result.differenceCents > 0 ? 'Sobrou' : 'Faltou'}{' '}
            {brl(Math.abs(result.differenceCents))}. A diferença fica registrada para o gerente.
          </Alert>
        )}
      </div>
      <Button className="mt-4" onClick={onClose}>
        Ok
      </Button>
    </Modal>
  );
}

// ---------------------------------------------------------------- sales history

export function HistoryDialog({
  pdv,
  sessionId,
  canCancel,
  requestAuthorization,
  onReprint,
  onClose,
}: {
  pdv: PdvService;
  sessionId: string;
  canCancel: boolean;
  requestAuthorization: (permission: AuthorizablePermission) => Promise<string | null>;
  onReprint: (sale: StoredSale) => void;
  onClose: () => void;
}) {
  const [sales, setSales] = useState<StoredSale[]>([]);
  const [selected, setSelected] = useState<StoredSale | null>(null);
  const [returning, setReturning] = useState<Record<number, string>>({});
  const [refundMethod, setRefundMethod] = useState<PaymentMethod>('cash');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const reload = async () => setSales(await pdv.listSales(sessionId, 50));
  useEffect(() => {
    void pdv.listSales(sessionId, 50).then(setSales);
  }, [pdv, sessionId]);

  const act = async (fn: () => Promise<void>, ok: string) => {
    setError(null);
    try {
      await fn();
      setMessage(ok);
      setSelected(null);
      setReturning({});
      setReason('');
      await reload();
    } catch (err) {
      setError(err instanceof PdvError || err instanceof Error ? err.message : 'Erro');
    }
  };

  return (
    <Modal
      mobileFullscreen
      open
      onOpenChange={(o) => !o && onClose()}
      title="Vendas deste caixa"
      wide
    >
      {message && <Alert tone="success">{message}</Alert>}
      {error && <Alert>{error}</Alert>}
      {!selected ? (
        <ul className="mt-2 divide-y divide-border">
          {sales.length === 0 && (
            <li className="py-4 text-muted">Nenhuma venda neste caixa ainda.</li>
          )}
          {sales.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 py-3 text-left hover:bg-surface-2"
                onClick={() => s.kind === 'sale' && setSelected(s)}
              >
                <span>
                  <span className="font-semibold">
                    {s.kind === 'sale'
                      ? `Venda nº ${s.terminalSeq}`
                      : `Devolução nº ${s.terminalSeq}`}
                  </span>{' '}
                  <span className="text-sm text-muted">
                    {new Date(s.createdAt).toLocaleTimeString('pt-BR', { timeStyle: 'short' })}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  {s.status === 'cancelled' && <Badge tone="danger">Cancelada</Badge>}
                  <span className="tabular-nums">
                    {s.kind === 'return' ? '−' : ''}
                    {brl(s.totalCents)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="font-semibold">
            Venda nº {selected.terminalSeq} · {brl(selected.totalCents)}
          </p>
          <table className="w-full text-left">
            <thead className="text-sm text-muted">
              <tr>
                <th scope="col">Item</th>
                <th scope="col" className="text-right">
                  Qtd.
                </th>
                <th scope="col" className="text-right">
                  Devolver
                </th>
              </tr>
            </thead>
            <tbody>
              {selected.items.map((i) => (
                <tr key={i.line} className="border-t border-border">
                  <td className="py-2">{i.name}</td>
                  <td className="text-right tabular-nums">
                    {(i.quantityMilli / 1000).toLocaleString('pt-BR')}
                  </td>
                  <td className="text-right">
                    <input
                      aria-label={`Quantidade a devolver de ${i.name}`}
                      inputMode="decimal"
                      className="w-24 rounded-ui border border-border bg-surface px-2 py-1 text-right"
                      value={returning[i.line] ?? ''}
                      onChange={(e) => setReturning((r) => ({ ...r, [i.line]: e.target.value }))}
                      disabled={selected.status === 'cancelled'}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <TextField label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} />
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Devolver o dinheiro em
            <select
              className="min-h-11 rounded-ui border border-border bg-surface px-3"
              value={refundMethod}
              onChange={(e) => setRefundMethod(e.target.value as PaymentMethod)}
            >
              {(['cash', 'pix', 'debit', 'credit', 'voucher'] as PaymentMethod[]).map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_LABELS[m]}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={selected.status === 'cancelled'}
              onClick={() =>
                void act(async () => {
                  const lines = Object.entries(returning)
                    .filter(([, v]) => v.trim())
                    .map(([line, v]) => ({
                      line: Number(line),
                      quantityMilli: Math.round(Number(v.replace(',', '.')) * 1000),
                    }));
                  if (lines.length === 0) throw new Error('Informe a quantidade a devolver.');
                  const r = await pdv.returnItems(selected.id, lines, refundMethod, reason);
                  setMessage(`Devolva ${brl(r.totalCents)} ao cliente.`);
                }, 'Devolução registrada.')
              }
            >
              Registrar devolução
            </Button>
            <Button
              variant="danger"
              disabled={selected.status === 'cancelled'}
              onClick={() =>
                void act(async () => {
                  const by = canCancel ? null : await requestAuthorization('pos.sale.cancel');
                  if (!canCancel && !by) throw new Error('Cancelamento não autorizado.');
                  await pdv.cancelSale(selected.id, reason, by);
                }, 'Venda cancelada.')
              }
            >
              Cancelar venda
            </Button>
            <Button variant="secondary" onClick={() => onReprint(selected)}>
              Reimprimir
            </Button>
            <Button variant="ghost" onClick={() => setSelected(null)}>
              Voltar
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- quotes

export function QuotesDialog({
  pdv,
  onLoad,
  onClose,
}: {
  pdv: PdvService;
  onLoad: (quoteId: string) => void;
  onClose: () => void;
}) {
  const [quotes, setQuotes] = useState<Awaited<ReturnType<PdvService['listQuotes']>>>([]);
  useEffect(() => {
    void pdv.listQuotes().then(setQuotes);
  }, [pdv]);
  return (
    <Modal mobileFullscreen open onOpenChange={(o) => !o && onClose()} title="Orçamentos">
      {quotes.length === 0 ? (
        <p className="text-muted">Nenhum orçamento aberto. Para criar, monte a venda e use F5.</p>
      ) : (
        <ul className="divide-y divide-border">
          {quotes.map((q) => (
            <li key={q.id} className="flex items-center justify-between gap-3 py-3">
              <span>
                {new Date(q.createdAt).toLocaleString('pt-BR', {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })}{' '}
                · {q.items} itens
              </span>
              <span className="flex items-center gap-3">
                <span className="tabular-nums">{brl(q.totalCents)}</span>
                <Button variant="secondary" onClick={() => onLoad(q.id)}>
                  Abrir
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
