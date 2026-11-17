import Link from 'next/link';

/** Public policy pages. No sign-in needed: Meta and customers must be able to read them. */
export default function LegalLayout({ children }) {
  return (
    <div className="min-h-dvh bg-mist-50">
      <header className="border-b border-mist-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2 font-display text-lg font-semibold text-mist-900">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon.svg" alt="" className="h-7 w-7" />
            WaDesk
          </Link>
          <nav className="flex gap-5 text-sm text-mist-600">
            <Link href="/privacy" className="hover:text-mist-900">Privacy</Link>
            <Link href="/terms" className="hover:text-mist-900">Terms</Link>
            <Link href="/data-deletion" className="hover:text-mist-900">Data deletion</Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-10">
        <article className="legal rounded-xl border border-mist-200 bg-white px-6 py-8 sm:px-10">{children}</article>
      </main>
    </div>
  );
}
