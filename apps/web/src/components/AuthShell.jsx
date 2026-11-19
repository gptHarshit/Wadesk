'use client';

import { LuCheckCheck } from 'react-icons/lu';

function Logo() {
  return (
    <span className="flex items-center gap-2 font-display text-xl font-semibold tracking-tight text-mist-900">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon.svg" alt="" className="h-8 w-8" />
      WaDesk
    </span>
  );
}

function Bubble({ side, children, time }) {
  const mine = side === 'out';
  return (
    <div className={mine ? 'flex justify-end' : 'flex justify-start'}>
      <div
        className={
          mine
            ? 'max-w-[80%] rounded-2xl rounded-br-sm bg-leaf-100 px-3.5 py-2 text-mist-900'
            : 'max-w-[80%] rounded-2xl rounded-bl-sm bg-surface px-3.5 py-2 text-mist-900'
        }
      >
        <p className="leading-snug">{children}</p>
        <p className="mt-0.5 flex items-center justify-end gap-1 text-xs text-mist-500">
          {time}
          {mine ? <LuCheckCheck className="h-3.5 w-3.5 text-sky-700" aria-hidden /> : null}
        </p>
      </div>
    </div>
  );
}

/** Shared frame for sign-in pages: the form on the left, a sample chat on the right. */
export function AuthShell({ title, subtitle, children, footer }) {
  return (
    <div className="grid min-h-dvh bg-surface lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <Logo />
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <h1 className="font-display text-3xl font-semibold tracking-tight text-mist-900">{title}</h1>
          {subtitle ? <p className="mt-2 text-mist-600">{subtitle}</p> : null}
          <div className="mt-7">{children}</div>
          {footer ? <div className="mt-6 text-mist-600">{footer}</div> : null}
        </div>
      </div>

      <aside className="relative hidden overflow-hidden bg-rail-900 lg:flex lg:flex-col lg:justify-center" aria-hidden>
        <div className="mx-auto w-full max-w-md px-8">
          <p className="font-display text-[2.1rem] font-semibold leading-tight tracking-tight text-white">
            Every WhatsApp chat your business gets, answered by the whole team.
          </p>
          <div className="thread-surface mt-9 space-y-2.5 rounded-xl p-4">
            <Bubble side="in" time="11:02 AM">
              Namaste, is the blue cotton kurta available in size M?
            </Bubble>
            <Bubble side="out" time="11:03 AM">
              Yes, it is. ₹1,299 with delivery in 2 days. Shall I keep one for you?
            </Bubble>
            <Bubble side="in" time="11:03 AM">
              Yes please 🙏
            </Bubble>
          </div>
          <p className="mt-6 leading-snug text-white/70">
            One number, many agents. Assign chats, send approved templates in bulk, and see what was delivered and read.
          </p>
        </div>
      </aside>
    </div>
  );
}

export function FormError({ error }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-md border border-brick-100 bg-brick-50 px-3 py-2 text-sm text-brick-700">
      {error.message || String(error)}
    </p>
  );
}
