import type { CatalogProduct } from '@bipae/pdv-core';
import { describeLastSync, type SyncStatus } from '@bipae/sync';
import { Alert, Button, cx, Logo, Sheet } from '@bipae/ui';
import { ChevronRight, CloudOff, Ellipsis, LogOut, RefreshCw, type LucideIcon } from 'lucide-react';
import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { brl } from './dialogs';
import {
  ActionTile,
  EmptySale,
  ModeSwitch,
  PayButton,
  ProductThumb,
  SearchResults,
  type SaleLineView,
  type TileTone,
} from './register-parts';
import type { RegisterMode } from './register-prefs';

/** Fecha a folha de ações antes de a ação rodar (a ação costuma abrir um diálogo). */
const CloseSheet = createContext<() => void>(() => undefined);

/** Uma linha da venda já formatada para a lista do celular. */
export type CompactLine = SaleLineView;

/** Ação frequente do rodapé do celular, em cartão colorido. */
export interface QuickTile<A extends string> {
  label: string;
  icon: LucideIcon;
  tone: TileTone;
  action: A;
  disabled?: boolean;
}

/**
 * O caixa no celular e no tablet em pé (F8-14, redesenhado na F8-15), com cara de app: ocupa a
 * altura visível (`--app-vh`, que encolhe com o teclado), respeita as áreas seguras e a página
 * nunca rola. De cima para baixo: topo com a logo, campo de bipar, o miolo (item em destaque e a
 * lista, ou a grade de produtos; a única parte que rola) e o rodapé com as ações em cartões, o
 * total e o Receber. O resto fica na folha de ações, que sobe de baixo.
 * Só apresentação: toda a regra do caixa continua no Register.
 */
export function CompactRegister<A extends string>({
  terminalName,
  operatorName,
  syncStatus,
  onSyncNow,
  onExit,
  selfMode,
  mode,
  onModeChange,
  notices,
  scanInput,
  camera,
  tipScan,
  tipPay,
  message,
  results,
  onPick,
  spotlight,
  grid,
  success,
  lines,
  selected,
  onSelect,
  totalCents,
  itemCount,
  tags,
  onPay,
  quickTiles,
  onTile,
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
  mode: RegisterMode;
  onModeChange: (mode: RegisterMode) => void;
  notices: ReactNode;
  scanInput: ReactNode;
  camera: ReactNode;
  tipScan: ReactNode;
  tipPay: ReactNode;
  message: { tone: 'danger' | 'success' | 'warning'; text: string } | null;
  results: CatalogProduct[];
  onPick: (product: CatalogProduct) => void;
  /** Item em destaque (modo "Venda em destaque"). */
  spotlight: ReactNode;
  /** Abas e grade de produtos (modo "Grade de produtos"). */
  grid: ReactNode;
  /** Venda concluída: ocupa o miolo até a próxima venda. */
  success: ReactNode;
  lines: CompactLine[];
  selected: number | null;
  onSelect: (line: number | null) => void;
  totalCents: number;
  itemCount: number;
  tags: string[];
  onPay: () => void;
  /** Ações frequentes em cartões no rodapé (o "Mais" vem junto). */
  quickTiles: QuickTile<A>[];
  onTile: (action: A) => void;
  sheetOpen: boolean;
  onSheetOpenChange: (open: boolean) => void;
  details: ReactNode;
  actions: ReactNode;
  overlays: ReactNode;
}) {
  const items = itemCount === 1 ? '1 item' : `${itemCount} itens`;
  const payLabel = selfMode ? 'Pagar' : 'Receber';
  const lastLine = lines.find((l) => l.line === selected) ?? lines.at(-1) ?? null;
  return (
    <div
      className="fixed inset-x-0 top-[var(--app-vtop,0px)] flex h-[var(--app-vh,100dvh)] flex-col overflow-hidden bg-bg pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]"
      data-layout="compact"
      data-mode={mode}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-border bg-surface pb-1 pl-3 pr-1 pt-[max(0.25rem,env(safe-area-inset-top))]">
        <Logo variant="symbol" className="shrink-0 text-xl" />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate font-semibold">{terminalName}</p>
          <p className="truncate text-sm text-muted" data-testid="pdv-operator">
            {operatorName}
          </p>
        </div>
        <SyncPill status={syncStatus} onSync={onSyncNow} />
        {!selfMode && <ModeSwitch mode={mode} onChange={onModeChange} compact />}
        {!selfMode && (
          <Button
            variant="ghost"
            className="px-2"
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
        {tipScan}
        {message && !success && (
          <div className="shrink-0 text-sm [&_[role=alert]]:px-3 [&_[role=alert]]:py-2 [&_[role=status]]:px-3 [&_[role=status]]:py-2">
            <Alert tone={message.tone}>{message.text}</Alert>
          </div>
        )}
        <SearchResults results={results} onPick={onPick} compact />
        {success ? (
          <div className="min-h-0 flex-1 rounded-2xl border border-border bg-surface">
            {success}
          </div>
        ) : mode === 'grid' ? (
          grid
        ) : (
          <>
            {spotlight}
            <SaleList
              lines={lines}
              selected={selected}
              onSelect={onSelect}
              className="min-h-0 flex-1 rounded-2xl border border-border bg-surface"
            />
          </>
        )}
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
        {mode === 'grid' && !success && lastLine && (
          <button
            type="button"
            className="mb-2 flex min-h-11 w-full items-center gap-2 rounded-xl bg-surface-2 px-2 text-left"
            onClick={() => onSheetOpenChange(true)}
            aria-haspopup="dialog"
            data-testid="pdv-sale-summary"
          >
            <ProductThumb name={lastLine.name} size="sm" />
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-sm font-semibold">{lastLine.name}</span>
              <span className="block text-xs text-muted">{items} na venda · toque para ver</span>
            </span>
            <ChevronRight className="size-5 shrink-0 text-muted" aria-hidden />
          </button>
        )}
        <div className={cx('mb-2 grid gap-2', selfMode ? 'grid-cols-3' : 'grid-cols-4')}>
          {quickTiles.map((tile) => (
            <ActionTile
              key={tile.label}
              compact
              label={tile.label}
              ariaLabel={tile.label}
              icon={tile.icon}
              tone={tile.tone}
              disabled={tile.disabled}
              onClick={() => onTile(tile.action)}
            />
          ))}
          <ActionTile
            compact
            label="Mais"
            ariaLabel="Mais ações"
            haspopup
            icon={Ellipsis}
            tone="neutral"
            onClick={() => onSheetOpenChange(true)}
          />
        </div>
        {tipPay && <div className="mb-2">{tipPay}</div>}
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold uppercase tracking-wide text-muted">
              Total · {items}
            </p>
            <p
              className="truncate text-3xl font-extrabold tabular-nums"
              aria-live="polite"
              data-testid="pdv-total-mobile"
            >
              {brl(totalCents)}
            </p>
          </div>
          <PayButton label={payLabel} onClick={onPay} disabled={itemCount === 0} />
        </div>
      </div>

      <ActionSheet
        open={sheetOpen}
        onOpenChange={onSheetOpenChange}
        title={selfMode ? 'Ajuda do atendente' : 'Ações do caixa'}
      >
        {mode === 'grid' && !selfMode && lines.length > 0 && (
          <section className="flex flex-col gap-2" aria-label="Itens da venda">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
              Itens da venda
            </h3>
            <SaleList
              lines={lines}
              selected={selected}
              onSelect={onSelect}
              className="max-h-64 rounded-2xl border border-border"
            />
          </section>
        )}
        {!selfMode && details && <div className="flex flex-col gap-3">{details}</div>}
        {actions}
      </ActionSheet>
      {overlays}
    </div>
  );
}

/** Lista da venda no celular e na coluna da grade: cada item é um botão que seleciona. */
export function SaleList({
  lines,
  selected,
  onSelect,
  className,
}: {
  lines: CompactLine[];
  selected: number | null;
  onSelect: (line: number | null) => void;
  className?: string;
}) {
  // O item recém-bipado (selecionado) fica sempre à vista na lista.
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected === null) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-line="${selected}"]`);
    row?.scrollIntoView?.({ block: 'nearest' });
  }, [selected, lines.length]);
  return (
    <div
      className={cx('overflow-y-auto overscroll-contain bg-surface', className)}
      data-testid="pdv-items"
      ref={listRef}
    >
      {lines.length === 0 ? (
        <EmptySale compact />
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
                <span className="w-6 shrink-0 text-sm text-muted tabular-nums">{item.line}</span>
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
  );
}

/** Folha de ações que sobe de baixo; no celular e no "Mais" do computador. */
export function ActionSheet({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title}>
      <div className="flex flex-col gap-4">
        <CloseSheet.Provider value={() => onOpenChange(false)}>{children}</CloseSheet.Provider>
      </div>
    </Sheet>
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
  shortcut,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'danger';
  /** Tecla de atalho no computador (aparece só com teclado de verdade, do notebook para cima). */
  shortcut?: string;
}) {
  const close = useContext(CloseSheet);
  return (
    <Button
      variant="secondary"
      className={cx(
        'min-h-12 justify-between whitespace-normal px-3 text-left leading-tight',
        tone === 'danger' && 'text-danger',
      )}
      aria-keyshortcuts={shortcut}
      onClick={() => {
        close();
        onClick();
      }}
      disabled={disabled}
    >
      <span className="flex-1">{children}</span>
      {shortcut && (
        <kbd
          aria-hidden
          className="shrink-0 rounded-md border border-border bg-surface-2 px-1.5 font-mono text-xs max-lg:hidden"
        >
          {shortcut}
        </kbd>
      )}
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
        'flex min-h-11 min-w-11 max-w-[45%] shrink-0 items-center justify-center gap-1.5 rounded-full px-3 text-sm font-semibold',
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
      {/* Sincronizado: só o ícone verde (o texto fica para o leitor de tela); sem conexão, escrito. */}
      <span className={offline ? 'truncate' : 'sr-only'}>{label}</span>
      {status.pending > 0 && (
        <span className="shrink-0 rounded-full bg-surface px-1.5 tabular-nums">
          {status.pending}
        </span>
      )}
    </button>
  );
}
