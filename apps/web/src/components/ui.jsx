'use client';

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { LuChevronLeft, LuChevronRight, LuCircleAlert, LuCircleCheck, LuLoaderCircle, LuX } from 'react-icons/lu';

export const cx = (...parts) => parts.filter(Boolean).join(' ');

/* --------------------------------- Buttons --------------------------------- */

const BUTTON_VARIANTS = {
  primary: 'bg-leaf-600 text-white hover:bg-leaf-700 active:bg-leaf-800',
  secondary: 'bg-white text-mist-800 border border-mist-300 hover:bg-mist-50 active:bg-mist-100',
  ghost: 'text-mist-700 hover:bg-mist-100 active:bg-mist-200',
  danger: 'bg-brick-600 text-white hover:bg-brick-700',
  dangerGhost: 'text-brick-600 hover:bg-brick-50',
};
const BUTTON_SIZES = {
  sm: 'h-8 px-2.5 text-sm gap-1.5',
  md: 'h-10 px-4 text-[0.95rem] gap-2',
  icon: 'h-9 w-9 justify-center',
};

export function Button({ variant = 'primary', size = 'md', loading = false, icon: Icon, className, children, disabled, type = 'button', ...props }) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-md font-medium whitespace-nowrap transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...props}
    >
      {loading ? <LuLoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : Icon ? <Icon className="h-4 w-4" aria-hidden /> : null}
      {children}
    </button>
  );
}

export function IconButton({ label, icon: Icon, className, ...props }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-mist-600 transition-colors hover:bg-mist-100 hover:text-mist-900 disabled:cursor-not-allowed disabled:opacity-40',
        className,
      )}
      {...props}
    >
      <Icon className="h-[1.15rem] w-[1.15rem]" aria-hidden />
    </button>
  );
}

/* ---------------------------------- Forms ---------------------------------- */

const CONTROL =
  'block w-full rounded-md border border-mist-300 bg-white px-3 text-mist-900 placeholder:text-mist-400 transition-colors focus:border-leaf-600 focus:outline-none focus:ring-2 focus:ring-leaf-600/20 disabled:bg-mist-100 disabled:text-mist-500';

export function Field({ label, hint, error, children, className }) {
  const id = useId();
  return (
    <div className={className}>
      {label ? (
        <label htmlFor={id} className="mb-1 block text-sm font-medium text-mist-800">
          {label}
        </label>
      ) : null}
      {typeof children === 'function' ? children(id) : children}
      {error ? (
        <p className="mt-1 text-sm text-brick-600">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-sm text-mist-500">{hint}</p>
      ) : null}
    </div>
  );
}

export function Input({ label, hint, error, className, ...props }) {
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {(id) => <input id={id} className={cx(CONTROL, 'h-10', error && 'border-brick-600')} {...props} />}
    </Field>
  );
}

export function Textarea({ label, hint, error, className, rows = 3, ...props }) {
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {(id) => <textarea id={id} rows={rows} className={cx(CONTROL, 'py-2 leading-snug', error && 'border-brick-600')} {...props} />}
    </Field>
  );
}

export function Select({ label, hint, error, className, children, ...props }) {
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {(id) => (
        <select id={id} className={cx(CONTROL, 'h-10 pr-8')} {...props}>
          {children}
        </select>
      )}
    </Field>
  );
}

export function Toggle({ checked, onChange, label, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-leaf-600' : 'bg-mist-300',
      )}
    >
      <span className={cx('inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform', checked ? 'translate-x-[1.35rem]' : 'translate-x-0.5')} />
    </button>
  );
}

/* ------------------------------ Small elements ------------------------------ */

const BADGE_TONES = {
  neutral: 'bg-mist-100 text-mist-700',
  green: 'bg-leaf-100 text-leaf-800',
  amber: 'bg-marigold-100 text-marigold-800',
  red: 'bg-brick-100 text-brick-700',
  blue: 'bg-sky-100 text-sky-700',
};

export function Badge({ tone = 'neutral', children, className }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', BADGE_TONES[tone], className)}>
      {children}
    </span>
  );
}

const TAG_COLORS = {
  slate: 'bg-mist-100 text-mist-700',
  red: 'bg-brick-100 text-brick-700',
  orange: 'bg-orange-100 text-orange-800',
  amber: 'bg-marigold-100 text-marigold-800',
  green: 'bg-leaf-100 text-leaf-800',
  teal: 'bg-teal-100 text-teal-800',
  blue: 'bg-sky-100 text-sky-700',
  violet: 'bg-violet-100 text-violet-800',
  pink: 'bg-pink-100 text-pink-800',
};
export const TAG_COLOR_NAMES = Object.keys(TAG_COLORS);

export function TagPill({ tag, onRemove }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium', TAG_COLORS[tag.color] ?? TAG_COLORS.slate)}>
      {tag.name}
      {onRemove ? (
        <button type="button" onClick={onRemove} aria-label={`Remove tag ${tag.name}`} className="-mr-0.5 rounded hover:bg-black/10">
          <LuX className="h-3 w-3" aria-hidden />
        </button>
      ) : null}
    </span>
  );
}

const AVATAR_TONES = ['bg-rail-700 text-white', 'bg-leaf-600 text-white', 'bg-marigold-400 text-mist-900', 'bg-sky-700 text-white', 'bg-brick-600 text-white', 'bg-mist-600 text-white'];

export function Avatar({ label, seed, size = 'md' }) {
  const text = String(seed || label || '?');
  let hash = 0;
  for (const ch of text) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const words = String(label || '?').replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  const letters = words.length ? (words[0][0] + (words[1]?.[0] ?? '')).toUpperCase() : '#';
  return (
    <span
      aria-hidden
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold',
        size === 'sm' ? 'h-7 w-7 text-xs' : size === 'lg' ? 'h-14 w-14 text-lg' : 'h-10 w-10 text-sm',
        AVATAR_TONES[hash % AVATAR_TONES.length],
      )}
    >
      {letters}
    </span>
  );
}

export function Spinner({ className }) {
  return <LuLoaderCircle className={cx('h-5 w-5 animate-spin text-mist-400', className)} role="status" aria-label="Loading" />;
}

export function LoadingBlock({ label = 'Loading' }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-mist-500">
      <Spinner />
      <span>{label}…</span>
    </div>
  );
}

export function ErrorBlock({ error, onRetry }) {
  return (
    <div className="mx-auto max-w-md py-14 text-center">
      <LuCircleAlert className="mx-auto h-7 w-7 text-brick-600" aria-hidden />
      <p className="mt-3 font-medium text-mist-900">{error?.message || 'Something went wrong'}</p>
      {onRetry ? (
        <Button variant="secondary" size="sm" className="mt-4" onClick={() => onRetry()}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children, action }) {
  return (
    <div className="mx-auto max-w-md px-4 py-14 text-center">
      {Icon ? (
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-mist-100 text-mist-500">
          <Icon className="h-6 w-6" aria-hidden />
        </span>
      ) : null}
      <h3 className="mt-4 font-display text-lg font-semibold text-mist-900">{title}</h3>
      {children ? <p className="mt-1 text-mist-600">{children}</p> : null}
      {action ? <div className="mt-5 flex justify-center gap-2">{action}</div> : null}
    </div>
  );
}

export function Notice({ tone = 'amber', icon: Icon = LuCircleAlert, title, children, action, className }) {
  const tones = {
    amber: 'border-marigold-400/60 bg-marigold-50 text-marigold-800',
    red: 'border-brick-100 bg-brick-50 text-brick-700',
    green: 'border-leaf-200 bg-leaf-50 text-leaf-800',
    blue: 'border-sky-100 bg-sky-50 text-sky-700',
  };
  return (
    <div className={cx('flex items-start gap-3 rounded-lg border px-4 py-3', tones[tone], className)}>
      <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className="text-sm leading-snug">{children}</div> : null}
      </div>
      {action}
    </div>
  );
}

/* -------------------------------- Page chrome -------------------------------- */

export function PageHeader({ title, description, actions }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 border-b border-mist-200 bg-white px-5 py-4 lg:px-8">
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-mist-900">{title}</h1>
        {description ? <p className="mt-0.5 text-mist-600">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function PageBody({ children, className }) {
  return <div className={cx('px-5 py-6 lg:px-8', className)}>{children}</div>;
}

export function Panel({ children, className }) {
  return <section className={cx('rounded-lg border border-mist-200 bg-white', className)}>{children}</section>;
}

/** Flat data table: hairlines between rows, no zebra, header in muted text. */
export function Table({ columns, rows, rowKey = (row) => row.id, empty }) {
  if (!rows.length) return empty ?? null;
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-left">
        <thead>
          <tr className="border-b border-mist-200 text-sm text-mist-500">
            {columns.map((col) => (
              <th key={col.key} scope="col" className={cx('px-4 py-2.5 font-medium', col.align === 'right' && 'text-right', col.className)}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className="border-b border-mist-100 last:border-b-0 hover:bg-mist-50/70">
              {columns.map((col) => (
                <td key={col.key} className={cx('px-4 py-3 align-middle', col.align === 'right' && 'text-right', col.className)}>
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({ page, limit, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (total <= limit) return null;
  const from = (page - 1) * limit + 1;
  const to = Math.min(total, page * limit);
  return (
    <div className="flex items-center justify-between gap-3 border-t border-mist-200 px-4 py-2.5 text-sm text-mist-600">
      <span>
        {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}
      </span>
      <div className="flex items-center gap-1">
        <IconButton label="Previous page" icon={LuChevronLeft} disabled={page <= 1} onClick={() => onPage(page - 1)} />
        <span className="px-1 tabular-nums">
          {page} / {pages}
        </span>
        <IconButton label="Next page" icon={LuChevronRight} disabled={page >= pages} onClick={() => onPage(page + 1)} />
      </div>
    </div>
  );
}

export function Tabs({ tabs, value, onChange, className }) {
  return (
    <div role="tablist" className={cx('flex gap-1 rounded-lg bg-mist-100 p-1', className)}>
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          onClick={() => onChange(tab.value)}
          className={cx(
            'flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors',
            value === tab.value ? 'bg-white text-mist-900 shadow-sm' : 'text-mist-600 hover:text-mist-900',
          )}
        >
          {tab.label}
          {tab.count ? <span className="rounded-full bg-marigold-400 px-1.5 text-xs font-semibold text-mist-900">{tab.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------- Modal ---------------------------------- */

export function Modal({ open, onClose, title, description, children, footer, size = 'md' }) {
  const panel = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    // Move focus into the dialog: first field if there is one, else the panel.
    const first = panel.current?.querySelector('input, textarea, select');
    (first ?? panel.current)?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      previous?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;
  const widths = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-rail-950/50" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cx(
          'animate-rise relative flex max-h-[92vh] w-full flex-col rounded-t-xl bg-white shadow-xl outline-none sm:rounded-xl',
          widths[size],
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-mist-200 px-5 py-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-mist-900">{title}</h2>
            {description ? <p className="mt-0.5 text-sm text-mist-600">{description}</p> : null}
          </div>
          <IconButton label="Close" icon={LuX} onClick={onClose} className="-mr-2 -mt-1" />
        </div>
        <div className="scroll-thin flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-mist-200 px-5 py-3">{footer}</div> : null}
      </div>
    </div>
  );
}

/* ----------------------------- Toasts and confirm ----------------------------- */

const FeedbackContext = createContext(null);

export function FeedbackProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [confirmState, setConfirmState] = useState(null);
  const nextId = useRef(1);

  const push = useCallback((tone, message) => {
    const id = nextId.current++;
    setToasts((list) => [...list.slice(-3), { id, tone, message }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), tone === 'error' ? 6000 : 3500);
  }, []);

  const value = useMemo(
    () => ({
      toast: {
        success: (message) => push('success', message),
        error: (error) => push('error', typeof error === 'string' ? error : error?.message || 'Something went wrong'),
      },
      /** Ask before a destructive action. Resolves true when confirmed. */
      confirm: (options) => new Promise((resolve) => setConfirmState({ ...options, resolve })),
    }),
    [push],
  );

  const settle = (answer) => {
    confirmState?.resolve(answer);
    setConfirmState(null);
  };

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-4 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={cx(
              'animate-rise pointer-events-auto flex max-w-md items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-white shadow-lg',
              t.tone === 'error' ? 'bg-brick-700' : 'bg-rail-900',
            )}
          >
            {t.tone === 'error' ? <LuCircleAlert className="h-4 w-4 shrink-0" aria-hidden /> : <LuCircleCheck className="h-4 w-4 shrink-0 text-leaf-200" aria-hidden />}
            {t.message}
          </div>
        ))}
      </div>
      <Modal
        open={Boolean(confirmState)}
        onClose={() => settle(false)}
        title={confirmState?.title ?? ''}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => settle(false)}>
              {confirmState?.cancelLabel ?? 'Cancel'}
            </Button>
            <Button variant={confirmState?.danger ? 'danger' : 'primary'} onClick={() => settle(true)}>
              {confirmState?.confirmLabel ?? 'Confirm'}
            </Button>
          </>
        }
      >
        <p className="text-mist-700">{confirmState?.message}</p>
      </Modal>
    </FeedbackContext.Provider>
  );
}

export function useFeedback() {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error('useFeedback must be used inside <FeedbackProvider>');
  return ctx;
}

/** Copy text with a "Copied" toast. */
export function useCopy() {
  const { toast } = useFeedback();
  return useCallback(
    async (text, label = 'Copied') => {
      try {
        await navigator.clipboard.writeText(text);
        toast.success(label);
      } catch {
        toast.error('Could not copy. Select the text and copy it manually.');
      }
    },
    [toast],
  );
}
