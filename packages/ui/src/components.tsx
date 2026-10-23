import * as DialogPrimitive from '@radix-ui/react-dialog';
import { formatBRL, formatTaxId, parseBRL, type Cents } from '@bipae/domain';
import { X } from 'lucide-react';
import { BRAND_SYMBOL, BRAND_WORDMARK } from './brand-paths';
import {
  forwardRef,
  useEffect,
  useId,
  useState,
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
      onChange={(e) => setText(e.target.value)}
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

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-ui border border-border bg-surface p-5 shadow-sm', className)}>
      {children}
    </section>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-muted">{description}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </header>
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

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-ui border border-dashed border-border p-10 text-center">
      <p className="text-lg font-semibold">{title}</p>
      {children && <div className="text-muted">{children}</div>}
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
}: {
  rows: T[];
  columns: Column<T>[];
  onRowClick?: (row: T) => void;
  caption: string;
}) {
  return (
    <div className="overflow-x-auto rounded-ui border border-border bg-surface">
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-surface-2 text-sm text-muted">
          <tr>
            {columns.map((c) => (
              <th
                key={c.header}
                scope="col"
                className={cx('px-4 py-3 font-semibold', c.align === 'right' && 'text-right')}
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
                  className={cx('px-4 py-3', c.align === 'right' && 'text-right tabular-nums')}
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
        <DialogPrimitive.Overlay className="fixed inset-0 bg-black/40" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 right-0 flex w-full max-w-xl flex-col bg-surface shadow-xl"
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

export function Modal({
  open,
  onOpenChange,
  title,
  children,
  wide,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
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
          )}
        >
          <div className="mb-4 flex items-center justify-between gap-4">
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
