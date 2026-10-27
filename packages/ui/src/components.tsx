import * as DialogPrimitive from '@radix-ui/react-dialog';
import { formatBRL, formatTaxId, parseBRL, type Cents } from '@bipae/domain';
import { Search, X } from 'lucide-react';
import { BRAND_SYMBOL, BRAND_WORDMARK } from './brand-paths';
import {
  forwardRef,
  useEffect,
  useId,
  useState,
  useSyncExternalStore,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------- Button

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-primary text-primary-contrast hover:bg-primary-hover',
  secondary: 'bg-surface text-text border border-border hover:bg-surface-2',
  ghost: 'bg-transparent text-text hover:bg-surface-2',
  danger: 'bg-danger text-white hover:opacity-90',
};

/** Button look for links (`<a className={buttonClass('primary', 'lg')}>`). */
export function buttonClass(variant: Variant = 'primary', size: 'md' | 'lg' = 'md') {
  return cx(
    'inline-flex items-center justify-center gap-2 rounded-ui font-semibold transition-colors',
    'disabled:cursor-not-allowed disabled:opacity-60',
    size === 'lg' ? 'min-h-14 px-6 text-lg' : 'min-h-11 px-4 text-base',
    VARIANTS[variant],
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'md' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, children, className, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={cx(buttonClass(variant, size), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
});

export function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}

// ---------------------------------------------------------------- Fields

interface FieldProps {
  label: string;
  error?: string | null | undefined;
  hint?: string;
  children: (props: {
    id: string;
    'aria-invalid'?: true;
    'aria-describedby'?: string;
  }) => ReactNode;
}

export function Field({ label, error, hint, children }: FieldProps) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      {children({
        id,
        ...(error && { 'aria-invalid': true as const }),
        ...(describedBy && { 'aria-describedby': describedBy }),
      })}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const inputClass =
  'min-h-11 w-full rounded-ui border border-border bg-surface px-3 text-base text-text placeholder:text-muted aria-[invalid=true]:border-danger';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  error?: string | null | undefined;
  hint?: string;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, error, hint, className, ...props },
  ref,
) {
  return (
    <Field label={label} error={error} {...(hint && { hint })}>
      {(a11y) => <input ref={ref} className={cx(inputClass, className)} {...a11y} {...props} />}
    </Field>
  );
});

export interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  label: string;
  error?: string | null | undefined;
  hint?: string;
  options: { value: string; label: string }[];
}

export function SelectField({
  label,
  error,
  hint,
  options,
  className,
  ...props
}: SelectFieldProps) {
  return (
    <Field label={label} error={error} hint={hint}>
      {(a11y) => (
        <select className={cx(inputClass, className)} {...a11y} {...props}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

/** Money input in BRL notation that reports integer cents (ADR-0008). */
export function MoneyField({
  label,
  value,
  onChange,
  error,
  required,
}: {
  label: string;
  value: number | null;
  onChange: (cents: number | null) => void;
  error?: string | null | undefined;
  required?: boolean;
}) {
  const [text, setText] = useState(
    value === null ? '' : formatBRL(value as Cents).replace('R$ ', ''),
  );
  const [localError, setLocalError] = useState<string | null>(null);
  return (
    <TextField
      label={label}
      inputMode="decimal"
      value={text}
      required={required}
      placeholder="0,00"
      error={localError ?? error}
      onChange={(e) => {
        const next = e.target.value;
        setText(next);
        // Texto que não é valor deixa o campo inválido para o navegador: o formulário não envia
        // um valor pela metade (PIE R2-01, revisão adversarial).
        const parsed = next.trim() === '' ? 0 : parseBRL(next);
        e.currentTarget.setCustomValidity(
          parsed === null || parsed < 0 ? 'Valor inválido. Use o formato 1.234,56' : '',
        );
        // Avisa o valor a cada tecla: com Enter o formulário era enviado antes de sair do campo e
        // gravava o valor antigo (PIE R2-01). Texto inválido só é apontado ao sair do campo.
        if (next.trim() === '') {
          onChange(null);
          return;
        }
        const cents = parseBRL(next);
        if (cents !== null && cents >= 0) {
          setLocalError(null);
          onChange(cents);
        }
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return;
        const cents = text.trim() === '' ? null : parseBRL(text);
        if (text.trim() !== '' && (cents === null || cents < 0)) {
          // Não deixa o Enter enviar o formulário com um valor que não foi entendido.
          e.preventDefault();
          setLocalError('Valor inválido. Use o formato 1.234,56');
        }
      }}
      onBlur={() => {
        if (text.trim() === '') {
          setLocalError(required ? 'Informe um valor' : null);
          onChange(null);
          return;
        }
        const cents = parseBRL(text);
        if (cents === null || cents < 0) {
          setLocalError('Valor inválido. Use o formato 1.234,56');
          return;
        }
        setLocalError(null);
        setText(formatBRL(cents).replace('R$ ', ''));
        onChange(cents);
      }}
    />
  );
}

/** CPF/CNPJ input with live mask. */
export function TaxIdField({
  label = 'CPF ou CNPJ',
  value,
  onChange,
  error,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | null | undefined;
}) {
  return (
    <TextField
      label={label}
      value={value ? formatTaxId(value) : ''}
      onChange={(e) =>
        onChange(
          e.target.value
            .replace(/[^0-9a-zA-Z]/g, '')
            .toUpperCase()
            .slice(0, 14),
        )
      }
      autoComplete="off"
      error={error}
    />
  );
}

export function Checkbox({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        className="mt-1 size-5 accent-[var(--primary)]"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <label htmlFor={id} className="flex flex-col">
        <span className="font-medium">{label}</span>
        {hint && <span className="text-sm text-muted">{hint}</span>}
      </label>
    </div>
  );
}

// ---------------------------------------------------------------- Layout

/**
 * Cores dos cartões (tokens --tile-* do tema, com versões para o escuro e o alto contraste): o
 * fundo suave e a cor forte do círculo do ícone. As mesmas do Início e do caixa.
 */
export type TileTone = 'green' | 'orange' | 'blue' | 'purple' | 'yellow' | 'red';

export const TILE_TONES: Record<TileTone, { tile: string; circle: string }> = {
  green: { tile: 'bg-tile-green', circle: 'bg-tile-green-strong' },
  orange: { tile: 'bg-tile-orange', circle: 'bg-tile-orange-strong' },
  blue: { tile: 'bg-tile-blue', circle: 'bg-tile-blue-strong' },
  purple: { tile: 'bg-tile-purple', circle: 'bg-tile-purple-strong' },
  yellow: { tile: 'bg-tile-yellow', circle: 'bg-tile-yellow-strong' },
  red: { tile: 'bg-tile-red', circle: 'bg-tile-red-strong' },
};

/** No alto contraste os cartões ficam sem cor de fundo: a borda é que separa um do outro. */
const HIGH_CONTRAST_BORDER = 'border border-transparent [[data-contrast=high]_&]:border-border';

/** Celular e tablet pequeno: abaixo do `md` (768px) as listas viram cartões. */
export const NARROW_QUERY = '(max-width: 767.98px)';

const mediaMatches = (query: string) =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query).matches
    : false;

/** Acompanha uma media query. Sem `matchMedia` (testes, SSR), responde falso. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return () => {};
      }
      const list = window.matchMedia(query);
      list.addEventListener?.('change', notify);
      return () => list.removeEventListener?.('change', notify);
    },
    () => mediaMatches(query),
    () => false,
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-2xl border border-border bg-surface p-5 shadow-sm', className)}>
      {children}
    </section>
  );
}

/** Bloco de um formulário longo ("O básico", "Impostos"...), para a pessoa achar cada campo. */
export function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-4"
    >
      <div>
        <h3 id={id} className="text-base font-bold">
          {title}
        </h3>
        {description && <p className="text-sm text-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

/**
 * Cabeçalho da tela: título, uma frase do que se faz ali e a ação principal à direita (no
 * celular, embaixo e na largura toda). O ícone, quando vem, aparece num quadrado colorido.
 */
export function PageHeader({
  title,
  description,
  actions,
  icon,
  tone = 'green',
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  icon?: ReactNode;
  tone?: TileTone;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-4">
        {icon && (
          <span
            aria-hidden
            className={cx(
              'hidden size-14 shrink-0 items-center justify-center rounded-2xl text-tile-icon shadow-sm sm:flex [&>svg]:size-7',
              TILE_TONES[tone].circle,
            )}
          >
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{title}</h1>
          {description && <p className="mt-1 text-muted">{description}</p>}
        </div>
      </div>
      {actions && (
        <div className="flex flex-wrap gap-2 max-sm:w-full max-sm:[&>*]:flex-1">{actions}</div>
      )}
    </header>
  );
}

/** Fileira de resumos no topo da tela: 2 por linha no celular, 3 ou 4 na tela larga. */
export function StatGrid({
  children,
  label,
  columns = 4,
}: {
  children: ReactNode;
  label: string;
  columns?: 3 | 4;
}) {
  return (
    <ul
      aria-label={label}
      className={cx(
        // No celular, um cartão que sobra sozinho na última linha ocupa a largura toda.
        'mb-6 grid grid-cols-2 gap-3 max-sm:[&>li:last-child:nth-child(odd)]:col-span-2',
        columns === 3 ? 'sm:grid-cols-3' : 'lg:grid-cols-4',
      )}
    >
      {children}
    </ul>
  );
}

/**
 * Um resumo em cartão colorido ("A pagar", "Vencido"...). Só mostra número que a API devolveu:
 * quem chama só monta o cartão depois que o dado chega.
 */
export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'green',
  valueTestId,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: TileTone;
  valueTestId?: string;
}) {
  return (
    <li
      className={cx(
        'flex min-w-0 flex-col gap-2 rounded-2xl p-4',
        HIGH_CONTRAST_BORDER,
        TILE_TONES[tone].tile,
      )}
    >
      <span className="flex items-center gap-2">
        {icon && (
          <span
            aria-hidden
            className={cx(
              'flex size-9 shrink-0 items-center justify-center rounded-full text-tile-icon [&>svg]:size-5',
              TILE_TONES[tone].circle,
            )}
          >
            {icon}
          </span>
        )}
        <span className="text-sm leading-tight font-semibold">{label}</span>
      </span>
      <span
        className="truncate text-xl font-extrabold tabular-nums sm:text-2xl"
        data-testid={valueTestId}
      >
        {value}
      </span>
      {hint && <span className="text-sm leading-snug text-muted">{hint}</span>}
    </li>
  );
}

/**
 * Filtro à vista em chips (no lugar de um menu escondido): um toque escolhe. O rótulo fica
 * visível e dá nome ao grupo para o leitor de tela; o chip escolhido fica "pressionado".
 */
export function FilterChips<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; count?: number }[];
}) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="flex flex-col gap-2">
      <span id={id} className="text-sm font-semibold text-muted">
        {label}
      </span>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={selected}
              // O leitor de tela ouve "Abertas (2)", e não "Abertas2".
              aria-label={o.count === undefined ? undefined : `${o.label} (${o.count})`}
              onClick={() => onChange(o.value)}
              className={cx(
                'inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors',
                selected
                  ? 'border-primary bg-primary text-primary-contrast'
                  : 'border-border bg-surface text-text hover:bg-surface-2',
              )}
            >
              {o.label}
              {o.count !== undefined && (
                <span
                  className={cx(
                    'rounded-full px-2 text-xs tabular-nums',
                    selected ? 'bg-primary-contrast text-primary' : 'bg-surface-2 text-text',
                  )}
                >
                  {o.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Busca grande da lista, com a lupa à esquerda: o mesmo campo em Produtos, Clientes e
 * Fornecedores. O rótulo vai para o leitor de tela; o exemplo fica no `placeholder`.
 */
export function SearchBox({
  label,
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="relative mb-5 max-w-2xl">
      <Search
        className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted"
        aria-hidden
      />
      <input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        className="min-h-12 w-full rounded-2xl border border-border bg-surface pl-12 pr-4 text-base shadow-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
      />
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'success' | 'danger' | 'warning';
}) {
  const tones = {
    neutral: 'bg-surface-2 text-text',
    success: 'bg-success-soft text-success',
    danger: 'bg-danger-soft text-danger',
    warning: 'bg-warning-soft text-text',
  };
  return (
    <span
      className={cx('inline-flex rounded-full px-2.5 py-0.5 text-sm font-semibold', tones[tone])}
    >
      {children}
    </span>
  );
}

export function Alert({
  children,
  tone = 'danger',
  title,
}: {
  children: ReactNode;
  tone?: 'danger' | 'success' | 'warning';
  title?: string;
}) {
  const tones = {
    danger: 'border-danger bg-danger-soft',
    success: 'border-success bg-success-soft',
    warning: 'border-accent bg-warning-soft',
  };
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cx('rounded-ui border-l-4 p-4', tones[tone])}
    >
      {title && <p className="font-semibold">{title}</p>}
      <div className={title ? 'mt-1' : ''}>{children}</div>
    </div>
  );
}

/**
 * Lista vazia com o próximo passo: ícone num círculo colorido, o título, uma frase e a ação
 * ("Cadastre seu primeiro produto").
 */
export function EmptyState({
  title,
  children,
  icon,
  tone = 'green',
  action,
}: {
  title: string;
  children?: ReactNode;
  icon?: ReactNode;
  tone?: TileTone;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-surface px-6 py-10 text-center">
      {icon && (
        <span
          aria-hidden
          className={cx(
            'flex size-16 items-center justify-center rounded-full text-tile-icon shadow-sm [&>svg]:size-8',
            TILE_TONES[tone].circle,
          )}
        >
          {icon}
        </span>
      )}
      <p className="text-lg font-bold">{title}</p>
      {children && <div className="max-w-md text-muted">{children}</div>}
      {action && <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  align?: 'left' | 'right';
}

export function DataTable<T extends { id: string }>({
  rows,
  columns,
  onRowClick,
  caption,
  card,
}: {
  rows: T[];
  columns: Column<T>[];
  onRowClick?: (row: T) => void;
  caption: string;
  /**
   * Conteúdo do cartão de cada linha no celular (abaixo de 768px): a lista vira cartões, sem
   * rolagem para o lado. Use só elementos de texto (`span`), porque o cartão pode ser um botão.
   */
  card?: (row: T) => ReactNode;
}) {
  const narrow = useMediaQuery(NARROW_QUERY);
  if (card && narrow) {
    return (
      <ul aria-label={caption} className="flex flex-col gap-2">
        {rows.map((row) => (
          <li key={row.id}>
            {onRowClick ? (
              <button
                type="button"
                onClick={() => onRowClick(row)}
                className="flex min-h-11 w-full items-center gap-3 rounded-2xl border border-border bg-surface p-4 text-left shadow-sm hover:bg-surface-2"
              >
                {card(row)}
              </button>
            ) : (
              <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 shadow-sm">
                {card(row)}
              </div>
            )}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-surface shadow-sm">
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-surface-2 text-xs tracking-wide text-muted uppercase">
          <tr>
            {columns.map((c) => (
              <th
                key={c.header}
                scope="col"
                className={cx('px-4 py-3 font-bold', c.align === 'right' && 'text-right')}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className={cx(
                'border-t border-border',
                onRowClick && 'cursor-pointer hover:bg-surface-2',
              )}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={
                onRowClick
                  ? (e) => {
                      if (e.key === 'Enter') onRowClick(row);
                    }
                  : undefined
              }
              tabIndex={onRowClick ? 0 : undefined}
            >
              {columns.map((c) => (
                <td
                  key={c.header}
                  className={cx('px-4 py-3.5', c.align === 'right' && 'text-right tabular-nums')}
                >
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Foco de volta para quem abriu (WCAG 2.4.3). As gavetas e janelas costumam ser montadas só
 * quando abertas; ao fechar, somem sem o Radix devolver o foco, e quem usa teclado se perdia.
 * Só age se o foco ficou perdido (na página): quem já levou o foco para outro lugar, como o
 * caixa de volta ao campo de bipar, continua mandando.
 */
function useReturnFocus(open: boolean) {
  const [opener] = useState(() =>
    typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null),
  );
  useEffect(() => {
    const restore = () =>
      setTimeout(() => {
        const lost = !document.activeElement || document.activeElement === document.body;
        if (lost && opener?.isConnected) opener.focus();
      }, 0);
    if (!open) restore();
    return () => {
      if (open) restore();
    };
  }, [open, opener]);
}

export function Drawer({
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
  useReturnFocus(open);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        {/* z-40/z-50 como no Modal: no celular, o topo fixo do app não cobre o título. */}
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col bg-surface shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <DialogPrimitive.Title className="text-xl font-bold">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" aria-label="Fechar" icon={<X className="size-5" />} />
            </DialogPrimitive.Close>
          </div>
          <div className="flex-1 overflow-y-auto p-5">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Janela de tela inteira no celular: cobre a altura visível e respeita entalhe e barra de gestos. */
const MOBILE_FULLSCREEN = cx(
  'max-sm:left-0 max-sm:top-[var(--app-vtop,0px)] max-sm:h-[var(--app-vh,100dvh)] max-sm:max-h-none',
  'max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:shadow-none',
  'max-sm:px-[max(1rem,env(safe-area-inset-left))] max-sm:pb-[max(1rem,env(safe-area-inset-bottom))] max-sm:pt-[max(0.75rem,env(safe-area-inset-top))]',
  'max-sm:overscroll-contain',
);

/**
 * Folha que sobe de baixo (como nos apps): ações secundárias ao alcance do polegar. Ocupa no
 * máximo 85% da altura visível e rola por dentro quando precisa.
 */
export function Sheet({
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
  useReturnFocus(open);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-[max(0px,calc(100%-var(--app-vtop,0px)-var(--app-vh,100dvh)))] z-50 mx-auto flex max-h-[calc(var(--app-vh,100dvh)*0.85)] w-full max-w-lg flex-col rounded-t-2xl bg-surface shadow-2xl"
        >
          <div className="mx-auto mt-2 h-1.5 w-12 shrink-0 rounded-full bg-border" aria-hidden />
          <div className="flex shrink-0 items-center justify-between gap-4 px-4 pb-1 pt-1">
            <DialogPrimitive.Title className="text-lg font-bold">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" aria-label="Fechar" icon={<X className="size-5" />} />
            </DialogPrimitive.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {children}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function Modal({
  open,
  onOpenChange,
  title,
  children,
  wide,
  mobileFullscreen,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
  /**
   * No celular (abaixo de 640px), a janela ocupa a tela inteira, com as áreas seguras e a altura
   * visível (`--app-vh`, que encolhe com o teclado). Do tablet para cima, nada muda.
   */
  mobileFullscreen?: boolean;
}) {
  useReturnFocus(open);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cx(
            'fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-ui bg-surface p-6 shadow-2xl',
            wide ? 'max-w-3xl' : 'max-w-lg',
            mobileFullscreen && MOBILE_FULLSCREEN,
          )}
        >
          <div
            className={cx(
              'mb-4 flex items-center justify-between gap-4',
              mobileFullscreen && 'max-sm:mb-2',
            )}
          >
            <DialogPrimitive.Title className="text-xl font-bold">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" aria-label="Fechar" icon={<X className="size-5" />} />
            </DialogPrimitive.Close>
          </div>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/**
 * Logo oficial do Bipaê: o nome inteiro ou só o símbolo "b". O tamanho segue a fonte
 * (`text-xl`, `text-3xl`...). `inverted` pinta o verde com a cor do texto, para fundos escuros.
 */
export function Logo({
  className,
  variant = 'wordmark',
  inverted = false,
}: {
  className?: string;
  variant?: 'wordmark' | 'symbol';
  inverted?: boolean;
}) {
  const art = variant === 'symbol' ? BRAND_SYMBOL : BRAND_WORDMARK;
  const ink = inverted ? 'currentColor' : 'var(--logo-ink)';
  return (
    <span className={cx('inline-flex items-center', className)}>
      <svg
        viewBox={art.viewBox}
        role="img"
        aria-label="Bipaê"
        className={variant === 'symbol' ? 'h-[1.6em] w-auto' : 'h-[1.4em] w-auto'}
      >
        {art.paths.map((p, i) => (
          <path
            key={i}
            transform={p.transform}
            d={p.d}
            fill={p.tone === 'accent' ? 'var(--logo-accent)' : ink}
          />
        ))}
      </svg>
    </span>
  );
}
