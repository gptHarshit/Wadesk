'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AuthShell, FormError } from '@/components/AuthShell';
import { Button, Input, Notice } from '@/components/ui';
import { api } from '@/lib/api';

export default function ResetPasswordPage() {
  const [token, setToken] = useState(null);
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Read the token from the address bar on the client (keeps this page statically buildable).
  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get('token') || '');
  }, []);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/reset-password', { method: 'POST', body: { token, password } });
      setDone(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const signIn = (
    <Link href="/login" className="font-medium text-brand-500 underline-offset-2 hover:underline">
      Go to sign in
    </Link>
  );

  return (
    <AuthShell title="Choose a new password" footer={signIn}>
      {done ? (
        <Notice tone="green" title="Password changed">
          You’ve been signed out everywhere. Sign in with your new password.
        </Notice>
      ) : token === '' ? (
        <Notice tone="red" title="This link is incomplete">
          Open the link from your reset email again, or request a new one.
        </Notice>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <FormError error={error} />
          <Input
            label="New password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            hint="At least 8 characters."
          />
          <Button type="submit" loading={busy} disabled={token === null} className="w-full">
            Save new password
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
