import type { CatalogProduct } from '@bipae/pdv-core';
import { describeLastSync, type SyncStatus } from '@bipae/sync';
import { Alert, Button, cx, Sheet } from '@bipae/ui';
import { CloudOff, LogOut, Menu, RefreshCw } from 'lucide-react';
import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';

/** Fecha a folha de ações antes de a ação rodar (a ação costuma abrir um diálogo). */
const CloseSheet = createContext<() => void>(() => undefined);
import { brl } from './dialogs';

/** Uma linha da venda já formatada para a lista do celular. */
export interface CompactLine {
  line: number;
  name: string;
  quantity: string;
  unitPrice: string;
  total: string;
  notes: string[];
  promotion: string | null;
}

/**
 * O caixa no celular e no tablet em pé (F8-14), com cara de app: ocupa a altura visível
 * (`--app-vh`, que encolhe com o teclado), respeita as áreas seguras e a página nunca rola.
 * De cima para baixo: topo compacto, campo de bipar, lista de itens (a única parte que rola),
 * rodapé com o total e o Pagar. O resto fica na folha de ações, que sobe de baixo.
 * Só apresentação: toda a regra do caixa continua no Register.
 */
export function CompactRegister({
  terminalName,
  operatorName,
  syncStatus,
  onSyncNow,
  onExit,
  selfMode,
  notices,
  scanInput,
  camera,
  message,
  results,
  onPick,
  lines,
  selected,
  onSelect,
  totalCents,
  itemCount,
  tags,
  onPay,
  sheetOpen,
  onSheetOpenChange,
  details,
  actions,
  overlays,
}: {
  terminalName: string;
  operatorName: string;
  syncStatus: SyncStatus | null;
  onSyncNow: () => void;
  onExit: () => void;
  selfMode: boolean;
  notices: ReactNode;
  scanInput: ReactNode;
  camera: ReactNode;
  message: { tone: 'danger' | 'success' | 'warning'; text: string } | null;
  results: CatalogProduct[];
  onPick: (product: CatalogProduct) => void;
  lines: CompactLine[];
  selected: number | null;
  onSelect: (line: number | null) => void;
  totalCents: number;
  itemCount: number;
  tags: string[];
  onPay: () => void;
  sheetOpen: boolean;
  onSheetOpenChange: (open: boolean) => void;
  details: ReactNode;
  actions: ReactNode;
  overlays: ReactNode;
}) {
  const items = itemCount === 1 ? '1 item' : `${itemCount} itens`;
  // O item recém-bipado (selecionado) fica sempre à vista na lista.
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected === null) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-line="${selected}"]`);
    row?.scrollIntoView?.({ block: 'nearest' });
  }, [selected, lines.length]);
  return (
    <div
      className="fixed inset-x-0 top-[var(--app-vtop,0px)] flex h-[var(--app-vh,100dvh)] flex-col overflow-hidden bg-bg pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]"
      data-layout="compact"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-border bg-surface pb-1 pl-3 pr-1 pt-[max(0.25rem,env(safe-area-inset-top))]">
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate font-semibold">{terminalName}</p>
          <p className="truncate text-sm text-muted" data-testid="pdv-operator">
            {operatorName}
          </p>
        </div>
        <SyncPill status={syncStatus} onSync={onSyncNow} />
        {!selfMode && (
          <Button
            variant="ghost"
            aria-label="Sair do caixa"
            icon={<LogOut className="size-5" aria-hidden />}
            onClick={onExit}
          />
        )}
      </header>

      {notices && (
        <div className="flex max-h-[30%] shrink-0 flex-col gap-2 overflow-y-auto px-3 pt-2 text-sm [&_[role=alert]]:p-3 [&_[role=status]]:p-3">
          {notices}
        </div>
      )}

      <section className="flex min-h-0 flex-1 flex-col gap-2 px-3 py-2" aria-label="Itens da venda">
        <div className="flex shrink-0 gap-2">
          {scanInput}
          {camera}
        </div>
        {message && (
          <div className="shrink-0 text-sm [&_[role=alert]]:px-3 [&_[role=alert]]:py-2 [&_[role=status]]:px-3 [&_[role=status]]:py-2">
            <Alert tone={message.tone}>{message.text}</Alert>
          </div>
        )}
        {results.length > 0 && (
          <ul
            className="max-h-[45%] shrink-0 overflow-y-auto overscroll-contain rounded-ui border border-border bg-surface"
            aria-label="Resultados da busca"
          >
            {results.map((p) => (
              <li key={p.id} className="border-t border-border first:border-t-0">
                <button
                  type="button"
                  className="flex min-h-12 w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-surface-2"
                  onClick={() => onPick(p)}
                >
                  <span className="min-w-0 flex-1">{p.name}</span>
                  <span className="tabular-nums">
                    {brl(p.priceCents)}
                    {p.isWeighable ? '/kg' : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-ui border border-border bg-surface"
          data-testid="pdv-items"
          ref={listRef}
        >
          {lines.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center text-muted">
              <p className="text-lg font-semibold text-text">Caixa livre</p>
              <p>Bipe o primeiro produto. Bipou? Bipaê!</p>
            </div>
          ) : (
            <ul>
              {lines.map((item) => (
                <li
                  key={item.line}
                  data-line={item.line}
                  className="border-t border-border first:border-t-0"
                >
                  <button
                    type="button"
                    aria-pressed={selected === item.line}
                    onClick={() => onSelect(selected === item.line ? null : item.line)}
                    className={cx(
                      'flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left',
                      selected === item.line && 'bg-warning-soft',
                    )}
                  >
                    <span className="w-6 shrink-0 text-sm text-muted tabular-nums">
                      {item.line}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{item.name}</span>
                      <span className="block text-sm text-muted tabular-nums">
                        {item.quantity} × {item.unitPrice}
                      </span>
                      {item.notes.map((note) => (
                        <span key={note} className="block text-sm text-muted">
                          {note}
                        </span>
                      ))}
                      {item.promotion && (
                        <span className="block text-sm font-semibold text-success">
                          {item.promotion}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">{item.total}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <div
        className="shrink-0 border-t border-border bg-surface px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-lg"
        aria-label="Total e pagamento"
        role="region"
      >
        {tags.length > 0 && (
          <button
            type="button"
            className="mb-2 flex min-h-8 w-full items-center gap-1 overflow-hidden text-left text-sm"
            onClick={() => onSheetOpenChange(true)}
            aria-label={`Detalhes da venda: ${tags.join(', ')}`}
          >
            {tags.map((tag) => (
              <span
                key={tag}
                className="shrink-0 truncate rounded-full bg-surface-2 px-2 py-0.5 font-medium"
              >
                {tag}
              </span>
            ))}
          </button>
        )}
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="lg"
            className="min-w-14 flex-col gap-0! px-2 text-xs"
            aria-label="Mais ações"
            aria-haspopup="dialog"
            onClick={() => onSheetOpenChange(true)}
          >
            <Menu className="size-5" aria-hidden />
            <span aria-hidden>Mais</span>
          </Button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold uppercase tracking-wide text-muted">
              Total · {items}
            </p>
            <p
              className="truncate text-2xl font-extrabold tabular-nums"
              aria-live="polite"
              data-testid="pdv-total-mobile"
            >
              {brl(totalCents)}
            </p>
          </div>
          <Button size="lg" className="px-5" onClick={onPay} disabled={itemCount === 0}>
            Pagar
          </Button>
        </div>
      </div>

      <Sheet
        open={sheetOpen}
        onOpenChange={onSheetOpenChange}
        title={selfMode ? 'Ajuda do atendente' : 'Ações do caixa'}
      >
        <div className="flex flex-col gap-4">
          {!selfMode && details && <div className="flex flex-col gap-3">{details}</div>}
          <CloseSheet.Provider value={() => onSheetOpenChange(false)}>
            {actions}
          </CloseSheet.Provider>
        </div>
      </Sheet>
      {overlays}
    </div>
  );
}

/** Um grupo de ações da folha, com título. */
export function SheetSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <h3 className="truncate text-sm font-semibold uppercase tracking-wide text-muted">{title}</h3>
      <div className="grid grid-cols-2 gap-2">{children}</div>
    </section>
  );
}

/** Botão da folha de ações: alvo grande (48px), texto que quebra em vez de vazar. */
export function SheetAction({
  children,
  onClick,
  disabled,
  tone,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'danger';
}) {
  const close = useContext(CloseSheet);
  return (
    <Button
      variant="secondary"
      className={cx(
        'min-h-12 whitespace-normal px-3 text-left leading-tight',
        tone === 'danger' && 'text-danger',
      )}
      onClick={() => {
        close();
        onClick();
      }}
      disabled={disabled}
    >
      {children}
    </Button>
  );
}

/** Situação da sincronização em pílula curta, para caber no topo do celular. */
function SyncPill({ status, onSync }: { status: SyncStatus | null; onSync: () => void }) {
  if (!status) return null;
  const offline = status.lastError !== null;
  const label = offline ? 'Sem conexão' : describeLastSync(status.lastSyncAt);
  return (
    <button
      type="button"
      onClick={onSync}
      className={cx(
        'flex min-h-11 max-w-[55%] shrink items-center gap-1.5 rounded-full px-3 text-sm font-semibold',
        offline ? 'bg-warning-soft text-text' : 'bg-success-soft text-success',
      )}
      title={status.lastError ?? 'Sincronizar agora'}
      aria-label={`${label}${status.pending > 0 ? `, ${status.pending} para enviar` : ''}. Sincronizar agora`}
      data-testid="sync-status"
    >
      {offline ? (
        <CloudOff className="size-4 shrink-0" aria-hidden />
      ) : (
        <RefreshCw
          className={cx('size-4 shrink-0', status.syncing && 'animate-spin')}
          aria-hidden
        />
      )}
      <span className="truncate">{label}</span>
      {status.pending > 0 && (
        <span className="shrink-0 rounded-full bg-surface px-1.5 tabular-nums">
          {status.pending}
        </span>
      )}
    </button>
  );
}
