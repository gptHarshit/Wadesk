'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AuthShell, FormError } from '@/components/AuthShell';
import { Button, Input, LoadingBlock, Notice } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function AcceptInvitePage() {
  const { applySession } = useAuth();
  const [token, setToken] = useState(null);
  const [invite, setInvite] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get('token') || '';
    setToken(value);
    if (!value) {
      setLoadError(new Error('This invite link is incomplete. Ask for a new one.'));
      return;
    }
    api('/auth/invite', { method: 'POST', body: { token: value } })
      .then((data) => {
        setInvite(data);
        setName(data.name || '');
      })
      .catch(setLoadError);
  }, []);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      applySession(await api('/auth/accept-invite', { method: 'POST', body: { token, name, password } }));
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title={invite ? `Join ${invite.workspaceName}` : 'Join your team'}
      subtitle={invite ? `You’re joining as ${invite.email}. Set your name and a password.` : undefined}
      footer={
        <Link href="/login" className="font-medium text-leaf-700 underline-offset-2 hover:underline">
          Already joined? Sign in
        </Link>
      }
    >
      {loadError ? (
        <Notice tone="red" title="This invite can’t be used">
          {loadError.message}
        </Notice>
      ) : !invite ? (
        <LoadingBlock label="Checking your invite" />
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <FormError error={error} />
          <Input label="Your name" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />
          <Input
            label="Password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            hint="At least 8 characters."
          />
          <Button type="submit" loading={busy} className="w-full">
            Join workspace
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
