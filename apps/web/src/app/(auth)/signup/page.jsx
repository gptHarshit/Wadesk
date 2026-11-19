'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AuthShell, FormError } from '@/components/AuthShell';
import { Button, Input } from '@/components/ui';
import { useAuth } from '@/lib/auth';

export default function SignupPage() {
  const { signup } = useAuth();
  const [form, setForm] = useState({ name: '', workspaceName: '', email: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));
  const fieldError = (key) => error?.details?.fields?.[key];

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signup(form);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Create your workspace"
      subtitle="You’ll be the owner. Invite your team once you’re in."
      footer={
        <>
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-brand-500 underline-offset-2 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && !error.details?.fields ? <FormError error={error} /> : null}
        <Input label="Your name" autoComplete="name" required value={form.name} onChange={set('name')} error={fieldError('name')} />
        <Input label="Business name" autoComplete="organization" required value={form.workspaceName} onChange={set('workspaceName')} error={fieldError('workspaceName')} />
        <Input label="Work email" type="email" autoComplete="email" required value={form.email} onChange={set('email')} error={fieldError('email')} />
        <Input
          label="Password"
          type="password"
          autoComplete="new-password"
          required
          value={form.password}
          onChange={set('password')}
          error={fieldError('password')}
          hint="At least 8 characters."
        />
        <Button type="submit" loading={busy} className="w-full">
          Create workspace
        </Button>
      </form>
    </AuthShell>
  );
}
