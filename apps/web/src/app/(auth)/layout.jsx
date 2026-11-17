'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth';

/** Sign-in pages. Someone who is already signed in goes straight to the app. */
export default function AuthLayout({ children }) {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'authed') router.replace('/dashboard');
  }, [status, router]);

  return children;
}
