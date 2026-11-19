'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AuthShell, FormError } from '@/components/AuthShell';
import { Button, Input } from '@/components/ui';
import { useAuth } from '@/lib/auth';

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Sign in"
      subtitle="Open your team inbox."
      footer={
        <>
          New here?{' '}
          <Link href="/signup" className="font-medium text-brand-500 underline-offset-2 hover:underline">
            Create a workspace
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormError error={error} />
        <Input label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <Button type="submit" loading={busy} className="w-full">
          Sign in
        </Button>
        <p className="text-center text-sm">
          <Link href="/forgot-password" className="text-mist-600 underline-offset-2 hover:text-mist-900 hover:underline">
            Forgot your password?
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
