'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AuthShell, FormError } from '@/components/AuthShell';
import { Button, Input, Notice } from '@/components/ui';
import { api } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/forgot-password', { method: 'POST', body: { email } });
      setSent(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter your email and we’ll send you a link to choose a new one."
      footer={
        <Link href="/login" className="font-medium text-brand-500 underline-offset-2 hover:underline">
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <Notice tone="green" title="Check your email">
          If an account exists for {email}, a reset link is on its way. The link works for 60 minutes.
        </Notice>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <FormError error={error} />
          <Input label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button type="submit" loading={busy} className="w-full">
            Send reset link
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
