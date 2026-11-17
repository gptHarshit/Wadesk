import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="font-display text-3xl font-semibold text-mist-900">Page not found</h1>
      <p className="text-mist-600">That address doesn’t match anything in WaDesk.</p>
      <Link href="/dashboard" className="mt-2 rounded-md bg-leaf-600 px-4 py-2 font-medium text-white hover:bg-leaf-700">
        Go to the dashboard
      </Link>
    </div>
  );
}
