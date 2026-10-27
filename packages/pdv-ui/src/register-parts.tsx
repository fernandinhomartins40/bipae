import type { CatalogProduct } from '@bipae/pdv-core';
import { Button, cx } from '@bipae/ui';
import {
  Lightbulb,
  LayoutGrid,
  Printer,
  Rows3,
  ScanBarcode,
  Volume2,
  VolumeX,
  type LucideIcon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { brl } from './dialogs';
import { useProductImage } from './product-image';
import { REGISTER_MODES, type RegisterMode } from './register-prefs';

/**
 * Peças de tela do caixa redesenhado (F8-15), usadas no computador e no celular. Só
 * apresentação: a regra da venda continua no Register e no PdvService.
 */

/** Uma linha da venda já formatada para a tela. */
export interface SaleLineView {
  line: number;
  name: string;
  quantity: string;
  unitPrice: string;
  total: string;
  notes: string[];
  promotion: string | null;
  /** Produto da linha e o hash da foto dele (F2-14), para mostrar a foto. */
  productId?: string;
  imageHash?: string | null;
}

// ---------------------------------------------------------------- foto do produto

const THUMB_TONES = [
  'bg-tile-green-strong',
  'bg-tile-blue-strong',
  'bg-tile-orange-strong',
  'bg-tile-purple-strong',
  'bg-tile-yellow-strong',
];

/** Iniciais do produto: as duas primeiras palavras que começam com letra ("Água Mineral" → "ÁM"). */
export function productInitials(name: string): string {
  const words = name.split(/\s+/).filter((w) => /^\p{L}/u.test(w));
  const chars =
    words.length >= 2
      ? [Array.from(words[0]!)[0], Array.from(words[1]!)[0]]
      : Array.from(words[0] ?? name.trim()).slice(0, 2);
  return chars.join('').toLocaleUpperCase('pt-BR') || '?';
}

/** Cor fixa por nome: o mesmo produto tem sempre a mesma cor, em qualquer caixa. */
function toneFor(name: string): string {
  // FNV-1a: espalha bem nomes parecidos entre as cores.
  let hash = 0x811c9dc5;
  for (const ch of name) hash = Math.imul(hash ^ ch.codePointAt(0)!, 16777619) >>> 0;
  return THUMB_TONES[hash % THUMB_TONES.length]!;
}

const THUMB_SIZES = {
  sm: 'size-10 rounded-xl text-sm',
  md: 'size-14 rounded-2xl text-lg',
  lg: 'size-20 rounded-2xl text-2xl',
  fill: 'aspect-[4/3] w-full rounded-xl text-3xl',
  fillCompact: 'aspect-[16/10] w-full rounded-xl text-2xl',
  /** Ocupa todo o quadro de quem chama (a prévia do cadastro, F2-14). */
  cover: 'size-full text-2xl',
};

/**
 * Foto do produto (F2-14). Com `productId` e `imageHash`, busca a foto pela API (ver
 * `product-image.tsx`); enquanto carrega, sem rede ou se a foto falhar, mostra as iniciais numa
 * cor fixa por nome.
 */
export function ProductThumb({
  name,
  productId,
  imageHash,
  imageUrl,
  size = 'md',
}: {
  name: string;
  productId?: string | null;
  imageHash?: string | null;
  /** Endereço pronto da foto (quando quem chama já tem). */
  imageUrl?: string | null;
  size?: keyof typeof THUMB_SIZES;
}) {
  const loaded = useProductImage(productId, imageHash);
  const src = imageUrl ?? loaded;
  const [broken, setBroken] = useState<string | null>(null);
  if (src && broken !== src) {
    return (
      <img
        src={src}
        alt=""
        draggable={false}
        onError={() => setBroken(src)}
        data-testid="product-photo"
        className={cx('shrink-0 bg-surface-2 object-cover', THUMB_SIZES[size])}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cx(
        'flex shrink-0 select-none items-center justify-center font-extrabold text-tile-icon',
        THUMB_SIZES[size],
        toneFor(name),
      )}
    >
      {productInitials(name)}
    </span>
  );
}

// ---------------------------------------------------------------- produtos para tocar

const price = (p: CatalogProduct) => `${brl(p.priceCents)}${p.isWeighable ? '/kg' : ''}`;

/** Resultado da busca por nome: foto, nome e preço, num cartão para tocar. */
export function SearchResults({
  results,
  onPick,
  compact = false,
}: {
  results: CatalogProduct[];
  onPick: (product: CatalogProduct) => void;
  compact?: boolean;
}) {
  if (results.length === 0) return null;
  return (
    <ul
      className={cx(
        'grid shrink-0 gap-2 overflow-y-auto overscroll-contain rounded-2xl border border-border bg-surface p-2 shadow-lg',
        compact ? 'max-h-[45%] grid-cols-1' : 'max-h-72 grid-cols-2 xl:grid-cols-3',
      )}
      aria-label="Resultados da busca"
    >
      {results.map((p) => (
        <li key={p.id}>
          <button
            type="button"
            className="flex min-h-14 w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-surface-2"
            onClick={() => onPick(p)}
          >
            <ProductThumb name={p.name} productId={p.id} imageHash={p.imageHash} size="sm" />
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate font-semibold">{p.name}</span>
              <span className="block text-sm tabular-nums text-muted">{price(p)}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Abas de categorias da grade de produtos. "Todos" vem primeiro. */
export function CategoryTabs({
  categories,
  current,
  onChange,
}: {
  categories: string[];
  current: string | null;
  onChange: (category: string | null) => void;
}) {
  const all: (string | null)[] = [null, ...categories];
  return (
    <nav aria-label="Categorias" className="shrink-0">
      <ul className="flex gap-2 overflow-x-auto overscroll-contain pb-1">
        {all.map((c) => (
          <li key={c ?? ''} className="shrink-0">
            <button
              type="button"
              aria-pressed={current === c}
              onClick={() => onChange(c)}
              className={cx(
                'min-h-11 rounded-full border px-4 font-semibold whitespace-nowrap',
                current === c
                  ? 'border-primary bg-primary text-primary-contrast'
                  : 'border-border bg-surface hover:bg-surface-2',
              )}
            >
              {c ?? 'Todos'}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Grade de produtos com foto para tocar (lanchonete, padaria). */
export function ProductGrid({
  products,
  inCart,
  onPick,
  hint,
  compact = false,
}: {
  products: CatalogProduct[];
  /** Quantas unidades de cada produto já estão na venda (pelo id). */
  inCart: Map<string, number>;
  onPick: (product: CatalogProduct) => void;
  hint: string | null;
  compact?: boolean;
}) {
  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      data-testid="pdv-product-grid"
    >
      {products.length === 0 ? (
        <p className="p-6 text-center text-muted">Nenhum produto nesta categoria.</p>
      ) : (
        <ul
          aria-label="Produtos"
          className={cx(
            'grid gap-2',
            compact
              ? 'grid-cols-3 sm:grid-cols-4'
              : 'grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3',
          )}
        >
          {products.map((p) => {
            const count = inCart.get(p.id) ?? 0;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onPick(p)}
                  aria-label={`${p.name}, ${price(p)}${count > 0 ? `, ${count} na venda` : ''}`}
                  className={cx(
                    'relative flex h-full w-full flex-col gap-1.5 rounded-2xl border bg-surface p-2 text-left shadow-sm hover:border-primary hover:shadow-md',
                    count > 0 ? 'border-primary' : 'border-border',
                  )}
                >
                  <ProductThumb
                    name={p.name}
                    productId={p.id}
                    imageHash={p.imageHash}
                    size={compact ? 'fillCompact' : 'fill'}
                  />
                  <span
                    className={cx(
                      'line-clamp-2 font-semibold leading-tight',
                      compact ? 'text-sm' : 'text-base',
                    )}
                  >
                    {p.name}
                  </span>
                  <span className="mt-auto font-bold tabular-nums text-primary">{price(p)}</span>
                  {count > 0 && (
                    <span
                      aria-hidden
                      className="absolute right-1 top-1 flex min-w-8 items-center justify-center rounded-full bg-accent px-2 py-0.5 text-sm font-extrabold text-accent-contrast shadow"
                    >
                      {count.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {hint && <p className="p-3 text-center text-sm text-muted">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- modo de tela

/** Troca entre "Venda em destaque" e "Grade de produtos". A escolha fica salva no caixa. */
export function ModeSwitch({
  mode,
  onChange,
  compact = false,
}: {
  mode: RegisterMode;
  onChange: (mode: RegisterMode) => void;
  compact?: boolean;
}) {
  if (compact) {
    const next: RegisterMode = mode === 'spotlight' ? 'grid' : 'spotlight';
    const Icon = next === 'grid' ? LayoutGrid : Rows3;
    return (
      <Button
        variant="ghost"
        className="shrink-0 px-2"
        aria-label={`Mudar para ${REGISTER_MODES[next].toLowerCase()}`}
        icon={<Icon className="size-5" aria-hidden />}
        onClick={() => onChange(next)}
      />
    );
  }
  return (
    <div
      role="group"
      aria-label="Modo da tela"
      className="flex rounded-full border border-border bg-surface-2 p-1"
    >
      {(['spotlight', 'grid'] as const).map((m) => {
        const Icon = m === 'grid' ? LayoutGrid : Rows3;
        return (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => onChange(m)}
            className={cx(
              'flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-semibold whitespace-nowrap',
              mode === m ? 'bg-surface text-text shadow-sm' : 'text-muted hover:text-text',
            )}
          >
            <Icon className="size-4" aria-hidden />
            {/* Nome inteiro só em tela larga; o leitor de tela sempre ouve o nome inteiro. */}
            <span className="max-2xl:sr-only">{REGISTER_MODES[m]}</span>
            <span aria-hidden className="2xl:hidden">
              {m === 'grid' ? 'Grade' : 'Destaque'}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- ações em cartões

export type TileTone = 'green' | 'orange' | 'blue' | 'purple' | 'yellow' | 'danger' | 'neutral';

const TILE_TONES: Record<TileTone, { tile: string; circle: string }> = {
  green: { tile: 'bg-tile-green', circle: 'bg-tile-green-strong' },
  orange: { tile: 'bg-tile-orange', circle: 'bg-tile-orange-strong' },
  blue: { tile: 'bg-tile-blue', circle: 'bg-tile-blue-strong' },
  purple: { tile: 'bg-tile-purple', circle: 'bg-tile-purple-strong' },
  yellow: { tile: 'bg-tile-yellow', circle: 'bg-tile-yellow-strong' },
  danger: { tile: 'bg-danger-soft', circle: 'bg-danger' },
  neutral: { tile: 'bg-surface-2', circle: 'bg-muted' },
};

/** Ação do caixa num cartão colorido, com o nome e a tecla de atalho à vista. */
export function ActionTile({
  label,
  shortcut,
  icon: Icon,
  tone,
  onClick,
  disabled,
  compact = false,
  ariaLabel,
  haspopup,
}: {
  label: string;
  shortcut?: string;
  icon: LucideIcon;
  tone: TileTone;
  onClick: () => void;
  disabled?: boolean;
  compact?: boolean;
  /** Nome para o leitor de tela; sem ele, o rótulo com a tecla: "Desconto (F4)". */
  ariaLabel?: string;
  haspopup?: boolean;
}) {
  const colors = TILE_TONES[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel ?? (shortcut ? `${label} (${shortcut})` : label)}
      aria-keyshortcuts={shortcut}
      aria-haspopup={haspopup ? 'dialog' : undefined}
      className={cx(
        'relative flex min-w-0 items-center rounded-2xl border border-transparent font-semibold transition hover:border-border hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:shadow-none [[data-contrast=high]_&]:border-border',
        compact
          ? 'min-h-14 flex-col justify-center gap-0.5 px-1 py-1 text-center text-xs leading-tight'
          : 'min-h-[4.5rem] flex-col items-start justify-between gap-1 px-3 py-2 text-left text-sm leading-tight baixa:min-h-14 baixa:gap-0.5 baixa:py-1.5',
        colors.tile,
      )}
    >
      <span
        aria-hidden
        className={cx(
          'flex shrink-0 items-center justify-center rounded-full text-tile-icon',
          compact ? 'size-7' : 'size-8 baixa:size-6',
          colors.circle,
        )}
      >
        <Icon className={compact ? 'size-4' : 'size-4.5'} />
      </span>
      <span className="w-full min-w-0 truncate">{label}</span>
      {shortcut && !compact && (
        <kbd
          aria-hidden
          className="absolute right-2 top-2 rounded-md border border-border bg-surface px-1.5 font-mono text-xs text-text"
        >
          {shortcut}
        </kbd>
      )}
    </button>
  );
}

/** O botão de receber: grande, amarelo da marca, sempre no mesmo lugar. */
export function PayButton({
  label,
  shortcut,
  onClick,
  disabled,
  big = false,
}: {
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled: boolean;
  big?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={shortcut ? `${label} (${shortcut})` : undefined}
      aria-keyshortcuts={shortcut}
      data-testid="pdv-pay"
      className={cx(
        'flex shrink-0 items-center justify-center gap-3 rounded-2xl bg-accent font-extrabold text-accent-contrast shadow-md transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none',
        big
          ? 'min-h-20 w-full px-6 text-3xl baixa:min-h-14 baixa:text-2xl'
          : 'min-h-14 min-w-32 px-6 text-xl',
      )}
    >
      {label}
      {shortcut && (
        <kbd
          aria-hidden
          className="rounded-lg bg-black/10 px-2 py-0.5 font-mono text-base font-bold"
        >
          {shortcut}
        </kbd>
      )}
    </button>
  );
}

// ---------------------------------------------------------------- guia da primeira venda

/** Dica curta da primeira venda, no fluxo da tela (nunca cobre um botão). */
export function GuideTip({
  children,
  onSkip,
  arrow = 'up',
}: {
  children: ReactNode;
  onSkip: () => void;
  arrow?: 'up' | 'down';
}) {
  return (
    <div
      role="note"
      aria-label="Dica"
      data-testid="pdv-tip"
      className="bipae-rise relative flex shrink-0 items-center gap-2 rounded-2xl bg-text py-1 pl-3 pr-1 text-bg shadow-lg"
    >
      <span
        aria-hidden
        className={cx(
          'absolute left-8 size-3 rotate-45 bg-text',
          arrow === 'up' ? '-top-1.5' : '-bottom-1.5',
        )}
      />
      <Lightbulb className="size-5 shrink-0 text-accent" aria-hidden />
      <p className="min-w-0 flex-1 font-semibold leading-tight">{children}</p>
      <button
        type="button"
        onClick={onSkip}
        className="min-h-11 shrink-0 rounded-xl px-3 text-sm font-semibold underline underline-offset-2 hover:bg-white/15"
      >
        Pular dicas
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- item em destaque

/** O último item bipado (ou o escolhido na lista), grande, para o cliente e o operador verem. */
export function LastItem({ item, compact = false }: { item: SaleLineView; compact?: boolean }) {
  return (
    <section
      aria-label="Último item"
      data-testid="pdv-last-item"
      className={cx(
        'flex shrink-0 items-center rounded-2xl border border-border bg-surface shadow-sm',
        compact ? 'gap-3 p-2' : 'gap-4 p-4',
      )}
    >
      <ProductThumb
        name={item.name}
        productId={item.productId}
        imageHash={item.imageHash}
        size={compact ? 'md' : 'lg'}
      />
      <div className="min-w-0 flex-1 leading-tight">
        <p className={cx('truncate font-bold', compact ? 'text-lg' : 'text-2xl')}>{item.name}</p>
        <p className={cx('tabular-nums text-muted', compact ? 'text-sm' : 'mt-1 text-lg')}>
          {item.quantity} × {item.unitPrice}
        </p>
        {item.promotion && <p className="text-sm font-semibold text-success">{item.promotion}</p>}
      </div>
      <p className={cx('shrink-0 font-extrabold tabular-nums', compact ? 'text-xl' : 'text-4xl')}>
        {item.total}
      </p>
    </section>
  );
}

/** Caixa vazio: convite para bipar o primeiro produto. */
export function EmptySale({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted">
      <span
        aria-hidden
        className={cx(
          'flex items-center justify-center rounded-full bg-tile-green text-primary',
          compact ? 'size-14' : 'size-20',
        )}
      >
        <ScanBarcode className={compact ? 'size-7' : 'size-10'} />
      </span>
      <p className={cx('font-bold text-text', compact ? 'text-lg' : 'text-2xl')}>Caixa livre</p>
      <p>Bipe o primeiro produto. Bipou? Bipaê!</p>
    </div>
  );
}

// ---------------------------------------------------------------- venda concluída

/**
 * Venda concluída (F8-15): o troco gigante, o "Próxima venda" (Enter também) e o comprovante.
 * Não trava o caixa: bipar o próximo produto já começa a venda seguinte.
 */
export function SaleSuccess({
  seq,
  changeCents,
  paidCents,
  message,
  motion,
  soundOn,
  onToggleSound,
  onNext,
  onPrint,
  compact = false,
}: {
  seq: number;
  changeCents: number;
  paidCents: number;
  message: string | null;
  /** Falso com "reduzir movimento": nada se mexe. */
  motion: boolean;
  soundOn: boolean;
  onToggleSound: () => void;
  onNext: () => void;
  onPrint: (() => void) | null;
  compact?: boolean;
}) {
  return (
    <section
      aria-label="Venda concluída"
      data-testid="sale-success"
      data-motion={motion ? 'on' : 'off'}
      className={cx(
        'flex h-full min-h-0 flex-col items-center justify-center overflow-y-auto text-center',
        compact ? 'gap-2 p-3' : 'gap-4 p-6',
      )}
    >
      <span
        aria-hidden
        className={cx(
          'flex shrink-0 items-center justify-center rounded-full bg-primary text-primary-contrast shadow-lg',
          compact ? 'size-14' : 'size-24',
          motion && 'bipae-pop',
        )}
      >
        <svg
          viewBox="0 0 24 24"
          className={compact ? 'size-8' : 'size-14'}
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path className={motion ? 'bipae-draw' : undefined} d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </span>
      <h2
        className={cx('font-extrabold', compact ? 'text-xl' : 'text-3xl', motion && 'bipae-rise')}
      >
        Venda nº {seq} concluída!
      </h2>
      {changeCents > 0 ? (
        <div
          className={cx(
            'shrink-0 rounded-3xl bg-accent text-accent-contrast shadow-md',
            compact ? 'px-6 py-2' : 'px-12 py-5',
            motion && 'bipae-pop',
          )}
        >
          <p className={cx('font-bold uppercase tracking-widest', compact ? 'text-sm' : 'text-lg')}>
            Troco
          </p>
          <p
            className={cx('font-black tabular-nums', compact ? 'text-5xl' : 'text-7xl')}
            data-testid="sale-change"
          >
            {brl(changeCents)}
          </p>
        </div>
      ) : (
        <p className={cx('font-bold tabular-nums', compact ? 'text-xl' : 'text-3xl')}>
          Recebido {brl(paidCents)}
        </p>
      )}
      {message && (
        <p role="status" className={cx('max-w-xl text-muted', compact && 'text-sm')}>
          {message}
        </p>
      )}
      <div
        className={cx(
          'flex flex-wrap items-center justify-center gap-2',
          compact && 'w-full max-w-sm [&>button:first-child]:w-full',
        )}
      >
        <Button size="lg" onClick={onNext} aria-keyshortcuts="Enter">
          Próxima venda
          <kbd
            aria-hidden
            className="rounded-md bg-black/15 px-1.5 font-mono text-xs max-lg:hidden"
          >
            Enter
          </kbd>
        </Button>
        {onPrint && (
          <Button
            variant="secondary"
            size="lg"
            icon={<Printer className="size-5" aria-hidden />}
            aria-label={`Imprimir comprovante da venda nº ${seq}`}
            onClick={onPrint}
          >
            Imprimir comprovante
          </Button>
        )}
        <Button
          variant="ghost"
          size="lg"
          className="px-3"
          aria-pressed={soundOn}
          aria-label="Som de venda concluída"
          title={soundOn ? 'Som ligado' : 'Som desligado'}
          icon={
            soundOn ? (
              <Volume2 className="size-5" aria-hidden />
            ) : (
              <VolumeX className="size-5" aria-hidden />
            )
          }
          onClick={onToggleSound}
        />
      </div>
    </section>
  );
}
