'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { LoadingBlock } from '@/components/ui';
import { useAuth } from '@/lib/auth';

export default function HomePage() {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'authed') router.replace('/dashboard');
    if (status === 'guest') router.replace('/login');
  }, [status, router]);

  return (
    <div className="flex min-h-dvh items-center justify-center">
      <LoadingBlock />
    </div>
  );
}
