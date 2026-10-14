import {
  formatBRL,
  formatTaxId,
  parseBRL,
  parseTaxId,
  PAYMENT_LABELS,
  type Cents,
  type PaymentMethod,
} from '@bipae/domain';
import {
  cashSuggestions,
  PdvError,
  summarizePayments,
  type ByMethod,
  type CloseResult,
  type PdvService,
  type StoredSale,
  type TenderInput,
} from '@bipae/pdv-core';
import { SimulatedTef } from '@bipae/platform/simulators';
import { Alert, Badge, Button, cx, Modal, TextField } from '@bipae/ui';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { AuthorizablePermission, PosBackend } from './backend';

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
  onAuthorized: (userId: string) => void;
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
      const { userId } = await backend.authorize(email, password, permission);
      onAuthorized(userId);
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
    <Modal open onOpenChange={(o) => !o && onClose()} title="Autorização do gerente">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-muted">Peça a um gerente para entrar com os dados dele e {PERMISSION_TEXT[permission]}.</p>
        {error && <Alert>{error}</Alert>}
        <TextField label="E-mail do gerente" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        <TextField label="Senha do gerente" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <Button type="submit" loading={busy}>
          Autorizar
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
    if (!Number.isFinite(value) || milli <= 0) return setError('Informe uma quantidade maior que zero.');
    if (!weighable && milli % 1000 !== 0) return setError('Este produto é vendido por unidade inteira.');
    onConfirm(milli);
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={title}>
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
      cents = Number.isFinite(pct) && pct >= 0 && pct <= 100 ? Math.floor((base * Math.round(pct * 100) + 5000) / 10000) : null;
    } else cents = parseBRL(text);
    if (cents === null || cents < 0 || cents > base) {
      return setError(scope === 'item' ? 'O desconto não pode ser maior que o valor do item.' : 'Desconto inválido.');
    }
    onConfirm(cents, scope);
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={scope === 'item' ? 'Desconto no item' : 'Desconto na venda'}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        {item && (
          <div className="flex gap-2" role="radiogroup" aria-label="Onde aplicar o desconto">
            {(['item', 'sale'] as const).map((s) => (
              <Button key={s} variant={scope === s ? 'primary' : 'secondary'} role="radio" aria-checked={scope === s} onClick={() => setScope(s)}>
                {s === 'item' ? `Neste item: ${item.name}` : 'Na venda toda'}
              </Button>
            ))}
          </div>
        )}
        <div className="flex gap-2" role="radiogroup" aria-label="Tipo de desconto">
          {(['percent', 'value'] as const).map((m) => (
            <Button key={m} variant={mode === m ? 'primary' : 'secondary'} role="radio" aria-checked={mode === m} onClick={() => setMode(m)}>
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
        {!canExceed && <p className="text-sm text-muted">Acima de {limitPercent}% precisa da autorização de um gerente.</p>}
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
    <Modal open onOpenChange={(o) => !o && onClose()} title="CPF/CNPJ na nota">
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

const METHOD_KEYS: { method: PaymentMethod; key: string }[] = [
  { method: 'cash', key: 'D' },
  { method: 'pix', key: 'P' },
  { method: 'debit', key: 'B' },
  { method: 'credit', key: 'C' },
  { method: 'voucher', key: 'V' },
  { method: 'store_credit', key: 'R' },
];

/**
 * Crediário no pagamento (F2-02): sem cliente (undefined), cliente sem crediário (null) ou o
 * valor disponível no limite.
 */
export type CreditInfo = { availableCents: number } | null | undefined;

function creditHint(credit: CreditInfo): string {
  if (credit === undefined) return 'Para vender no crediário, informe o CPF ou CNPJ do cliente (F6).';
  if (credit === null) return 'Este cliente não tem crediário. O limite é liberado no cadastro do cliente.';
  return `Disponível no crediário: ${brl(credit.availableCents)}.`;
}

/**
 * Several payments on one sale. Pix and cards use simulators until the real PSP/TEF
 * integrations (Phase 6); the screen says so.
 */
export function PaymentDialog({
  totalCents,
  credit,
  onPaid,
  onClose,
}: {
  totalCents: number;
  credit?: CreditInfo;
  onPaid: (tenders: TenderInput[]) => Promise<void>;
  onClose: () => void;
}) {
  const [tenders, setTenders] = useState<TenderInput[]>([]);
  const [method, setMethod] = useState<PaymentMethod>('cash');
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
  const tef = useMemo(() => new SimulatedTef(), []);

  useEffect(() => {
    amount.setText(brl(remaining).replace('R$ ', ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining]);

  const add = async (received: number | null) => {
    setError(null);
    if (received === null || received <= 0) return setError('Informe um valor válido.');
    if (method !== 'cash' && received > remaining) return setError('Só pagamento em dinheiro pode passar do valor (para dar troco).');
    if (method === 'pix') return setPixPending(received);
    if (method === 'store_credit') {
      const used = tenders.filter((t) => t.method === 'store_credit').reduce((a, t) => a + t.receivedCents, 0);
      if (!credit) return setError(creditHint(credit));
      if (used + received > credit.availableCents) return setError(creditHint(credit));
    }
    if (method === 'credit' || method === 'debit' || method === 'voucher') {
      setBusy(true);
      const result = await tef.pay({ amountCents: received, method, saleId: 'pending' });
      setBusy(false);
      if (!result.approved) return setError(result.message);
      return setTenders((t) => [...t, { method, receivedCents: received, nsu: result.nsu ?? null, authorizationCode: result.authorizationCode ?? null, provider: 'Simulador' }]);
    }
    setTenders((t) => [...t, { method, receivedCents: received }]);
  };

  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      await onPaid(tenders);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const done = remaining === 0 && tenders.length > 0;
  return (
    <Modal open onOpenChange={(o) => !o && !busy && onClose()} title="Pagamento" wide>
      <div className="grid gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-4">
          <div role="radiogroup" aria-label="Forma de pagamento" className="grid grid-cols-2 gap-2">
            {METHOD_KEYS.map(({ method: m, key }) => (
              <Button
                key={m}
                role="radio"
                aria-checked={method === m}
                aria-keyshortcuts={key}
                variant={method === m ? 'primary' : 'secondary'}
                onClick={() => setMethod(m)}
                disabled={done}
              >
                {PAYMENT_LABELS[m]}
              </Button>
            ))}
          </div>
          {!done && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void add(amount.cents);
              }}
              className="flex flex-col gap-3"
            >
              <TextField label={method === 'cash' ? 'Valor recebido (R$)' : 'Valor (R$)'} inputMode="decimal" value={amount.text} onChange={(e) => amount.setText(e.target.value)} autoFocus />
              {method === 'cash' && (
                <div className="flex flex-wrap gap-2">
                  {cashSuggestions(remaining).map((c) => (
                    <Button key={c} variant="secondary" onClick={() => void add(c)}>
                      {brl(c)}
                    </Button>
                  ))}
                </div>
              )}
              {method === 'store_credit' && <p className="text-sm text-muted">{creditHint(credit)}</p>}
              {method !== 'cash' && method !== 'store_credit' && <p className="text-sm text-muted">Simulador: a integração real com Pix e maquininhas chega na Fase 6.</p>}
              <Button type="submit" loading={busy}>
                Adicionar {PAYMENT_LABELS[method].toLowerCase()}
              </Button>
            </form>
          )}
          {pixPending !== null && (
            <Alert tone="warning" title="Pix (simulador)">
              <p>QR Code de {brl(pixPending)} gerado. Peça para o cliente pagar.</p>
              <div className="mt-3 flex gap-2">
                <Button
                  onClick={() => {
                    setTenders((t) => [...t, { method: 'pix', receivedCents: pixPending, provider: 'Simulador', nsu: `PIX${Date.now()}` }]);
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
        </div>
        <div className="flex flex-col gap-3 rounded-ui bg-surface-2 p-4">
          <Row label="Total da venda" value={brl(totalCents)} strong />
          {summary?.payments.map((p, i) => (
            <Row key={i} label={PAYMENT_LABELS[p.method]} value={brl(p.amountCents + p.changeCents)} />
          ))}
          <Row label="Falta pagar" value={brl(remaining)} strong={remaining > 0} />
          {(summary?.changeCents ?? 0) > 0 && (
            <div className="rounded-ui bg-accent p-3 text-accent-contrast">
              <Row label="Troco" value={brl(summary!.changeCents)} strong />
            </div>
          )}
          {tenders.length > 0 && (
            <Button variant="ghost" onClick={() => setTenders([])} disabled={busy}>
              Refazer pagamentos
            </Button>
          )}
          <Button size="lg" onClick={() => void finish()} disabled={!done} loading={busy} aria-keyshortcuts="F10">
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
    if (amount.cents === null || amount.cents <= 0) return setError('Informe um valor maior que zero.');
    try {
      let authorizedBy: string | null = null;
      if (view === 'withdrawal' && !canWithdraw) {
        authorizedBy = await requestAuthorization('pos.cash.withdrawal');
        if (!authorizedBy) return;
      }
      await pdv.addMovement(view as 'withdrawal' | 'supply', amount.cents, reason || null, authorizedBy);
      setMessage(`${view === 'withdrawal' ? 'Sangria' : 'Suprimento'} de ${brl(amount.cents)} registrado.`);
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
      if (cents === null || cents < 0) return setError(`Valor inválido em ${PAYMENT_LABELS[m as PaymentMethod]}.`);
      values[m as PaymentMethod] = cents;
    }
    try {
      onClosed(await pdv.closeSession(values));
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Caixa">
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
          <TextField label="Valor (R$)" inputMode="decimal" value={amount.text} onChange={(e) => amount.setText(e.target.value)} autoFocus />
          <TextField label="Motivo (opcional)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex gap-2">
            <Button type="submit">Registrar {view === 'withdrawal' ? 'sangria' : 'suprimento'}</Button>
            <Button variant="secondary" onClick={() => setView('menu')}>
              Voltar
            </Button>
          </div>
        </form>
      )}
      {view === 'close' && (
        <form onSubmit={close} className="mt-4 flex flex-col gap-4">
          <p className="text-muted">
            Conte o que está no caixa e informe abaixo. O sistema só mostra se sobrou ou faltou depois que você confirmar (fechamento cego).
          </p>
          {(['cash', 'pix', 'debit', 'credit', 'voucher'] as PaymentMethod[]).map((m) => (
            <TextField
              key={m}
              label={`${PAYMENT_LABELS[m]} (R$)`}
              inputMode="decimal"
              value={declared[m] ?? ''}
              onChange={(e) => setDeclared((d) => ({ ...d, [m]: e.target.value }))}
            />
          ))}
          <Button type="submit" variant="danger">
            Confirmar fechamento
          </Button>
        </form>
      )}
    </Modal>
  );
}

export function CloseResultDialog({ result, onClose }: { result: CloseResult; onClose: () => void }) {
  const methods = (Object.keys(result.expected) as PaymentMethod[]).filter((m) => result.expected[m] !== 0 || result.declared[m] !== 0);
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Caixa fechado">
      <table className="w-full text-left">
        <thead className="text-sm text-muted">
          <tr>
            <th scope="col">Forma</th>
            <th scope="col" className="text-right">Esperado</th>
            <th scope="col" className="text-right">Contado</th>
            <th scope="col" className="text-right">Diferença</th>
          </tr>
        </thead>
        <tbody>
          {methods.map((m) => (
            <tr key={m} className="border-t border-border">
              <td className="py-2">{PAYMENT_LABELS[m]}</td>
              <td className="text-right tabular-nums">{brl(result.expected[m])}</td>
              <td className="text-right tabular-nums">{brl(result.declared[m])}</td>
              <td className={cx('text-right tabular-nums font-semibold', result.differences[m] < 0 && 'text-danger')}>{brl(result.differences[m])}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-4">
        {result.differenceCents === 0 ? (
          <Alert tone="success">Bateu certinho. Bipaê!</Alert>
        ) : (
          <Alert tone="warning">
            {result.differenceCents > 0 ? 'Sobrou' : 'Faltou'} {brl(Math.abs(result.differenceCents))}. A diferença fica registrada para o gerente.
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
    <Modal open onOpenChange={(o) => !o && onClose()} title="Vendas deste caixa" wide>
      {message && <Alert tone="success">{message}</Alert>}
      {error && <Alert>{error}</Alert>}
      {!selected ? (
        <ul className="mt-2 divide-y divide-border">
          {sales.length === 0 && <li className="py-4 text-muted">Nenhuma venda neste caixa ainda.</li>}
          {sales.map((s) => (
            <li key={s.id}>
              <button type="button" className="flex w-full items-center justify-between gap-3 py-3 text-left hover:bg-surface-2" onClick={() => s.kind === 'sale' && setSelected(s)}>
                <span>
                  <span className="font-semibold">{s.kind === 'sale' ? `Venda nº ${s.terminalSeq}` : `Devolução nº ${s.terminalSeq}`}</span>{' '}
                  <span className="text-sm text-muted">{new Date(s.createdAt).toLocaleTimeString('pt-BR', { timeStyle: 'short' })}</span>
                </span>
                <span className="flex items-center gap-2">
                  {s.status === 'cancelled' && <Badge tone="danger">Cancelada</Badge>}
                  <span className="tabular-nums">{s.kind === 'return' ? '−' : ''}{brl(s.totalCents)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="font-semibold">Venda nº {selected.terminalSeq} · {brl(selected.totalCents)}</p>
          <table className="w-full text-left">
            <thead className="text-sm text-muted">
              <tr>
                <th scope="col">Item</th>
                <th scope="col" className="text-right">Qtd.</th>
                <th scope="col" className="text-right">Devolver</th>
              </tr>
            </thead>
            <tbody>
              {selected.items.map((i) => (
                <tr key={i.line} className="border-t border-border">
                  <td className="py-2">{i.name}</td>
                  <td className="text-right tabular-nums">{(i.quantityMilli / 1000).toLocaleString('pt-BR')}</td>
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
            <select className="min-h-11 rounded-ui border border-border bg-surface px-3" value={refundMethod} onChange={(e) => setRefundMethod(e.target.value as PaymentMethod)}>
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
                    .map(([line, v]) => ({ line: Number(line), quantityMilli: Math.round(Number(v.replace(',', '.')) * 1000) }));
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
    <Modal open onOpenChange={(o) => !o && onClose()} title="Orçamentos">
      {quotes.length === 0 ? (
        <p className="text-muted">Nenhum orçamento aberto. Para criar, monte a venda e use F5.</p>
      ) : (
        <ul className="divide-y divide-border">
          {quotes.map((q) => (
            <li key={q.id} className="flex items-center justify-between gap-3 py-3">
              <span>
                {new Date(q.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} · {q.items} itens
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
