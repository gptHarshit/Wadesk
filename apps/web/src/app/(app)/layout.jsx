'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { AppShell } from '@/components/AppShell';
import { LoadingBlock } from '@/components/ui';
import { useAuth } from '@/lib/auth';

/** Everything under here needs a signed-in user. */
export default function AppLayout({ children }) {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'guest') router.replace('/login');
  }, [status, router]);

  if (status !== 'authed') {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <LoadingBlock />
      </div>
    );
  }
  return <AppShell>{children}</AppShell>;
}
