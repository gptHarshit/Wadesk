'use client';

import { useEffect, useState } from 'react';
import { LuCircleCheck, LuCopy } from 'react-icons/lu';
import { Button, ErrorBlock, Input, LoadingBlock, Notice, PageBody, PageHeader, Panel, Tabs, useCopy, useFeedback } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { useApi } from '@/lib/hooks';

function CopyField({ label, value, hint }) {
  const copy = useCopy();
  return (
    <div>
      <p className="mb-1 text-sm font-medium text-mist-800">{label}</p>
      <div className="flex gap-2">
        <input readOnly value={value} aria-label={label} onFocus={(e) => e.target.select()} className="h-10 min-w-0 flex-1 rounded-md border border-mist-300 bg-mist-50 px-3 font-mono text-sm text-mist-800" />
        <Button variant="secondary" icon={LuCopy} onClick={() => copy(value, `${label} copied`)}>
          Copy
        </Button>
      </div>
      {hint ? <p className="mt-1 text-sm text-mist-500">{hint}</p> : null}
    </div>
  );
}

const SETUP_STEPS = [
  'At developers.facebook.com, create a Business app and add the WhatsApp product. Add and verify your phone number there.',
  'From WhatsApp → API Setup, copy the Phone number ID and the WhatsApp Business Account ID.',
  'In Business Settings → System users, create a permanent access token with the whatsapp_business_messaging and whatsapp_business_management permissions.',
  'From App settings → Basic, copy the App secret.',
  'Save all four below. Then in WhatsApp → Configuration, paste the Callback URL and Verify token from this page and subscribe to the “messages” field.',
];

function WhatsAppSettings() {
  const { reload: reloadProfile } = useAuth();
  const { toast, confirm } = useFeedback();
  const { data, error, loading, reload, setData } = useApi('/settings/whatsapp');
  const [form, setForm] = useState({ phoneNumberId: '', wabaId: '', accessToken: '', appSecret: '' });
  const [formError, setFormError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  useEffect(() => {
    if (data) setForm({ phoneNumberId: data.phoneNumberId ?? '', wabaId: data.wabaId ?? '', accessToken: '', appSecret: '' });
  }, [data]);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      const saved = await api('/settings/whatsapp', { method: 'PUT', body: form });
      setData(saved);
      await reloadProfile();
      if (saved.webhookSubscribed === false) {
        toast.error('Saved, but the app could not be subscribed to your business account. Check the token’s permissions.');
      } else {
        toast.success('WhatsApp connected');
      }
    } catch (err) {
      setFormError(err);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    const ok = await confirm({
      title: 'Disconnect WhatsApp?',
      message: 'New messages will stop arriving and nothing can be sent until you connect again. Your chats and contacts stay.',
      confirmLabel: 'Disconnect',
      danger: true,
    });
    if (!ok) return;
    try {
      setData(await api('/settings/whatsapp', { method: 'DELETE' }));
      await reloadProfile();
      toast.success('WhatsApp disconnected');
    } catch (err) {
      toast.error(err);
    }
  }

  if (loading && !data) return <LoadingBlock />;
  if (error && !data) return <ErrorBlock error={error} onRetry={reload} />;
  const localUrl = /^http:\/\/(localhost|127\.)/.test(data.webhookUrl);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_26rem]">
      <div className="space-y-6">
        {data.connected ? (
          <Notice tone="green" icon={LuCircleCheck} title={`Connected to ${data.verifiedName || 'your business'} (${data.displayPhoneNumber || data.phoneNumberId})`}>
            Since {formatDateTime(data.connectedAt)}. Calls use Graph API {data.graphVersion}.
          </Notice>
        ) : (
          <Notice tone="amber" title="No WhatsApp number connected">
            Follow the steps on this page to connect your WhatsApp Cloud API number.
          </Notice>
        )}

        <Panel className="p-5">
          <h2 className="font-display text-lg font-semibold text-mist-900">Cloud API details</h2>
          <form onSubmit={submit} className="mt-4 space-y-4" noValidate>
            {formError ? <Notice tone="red">{formError.message}</Notice> : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Phone number ID" inputMode="numeric" value={form.phoneNumberId} onChange={set('phoneNumberId')} autoComplete="off" />
              <Input label="WhatsApp Business Account ID" inputMode="numeric" value={form.wabaId} onChange={set('wabaId')} autoComplete="off" />
            </div>
            <Input
              label="Access token"
              type="password"
              value={form.accessToken}
              onChange={set('accessToken')}
              autoComplete="off"
              placeholder={data.connected ? `Saved (${data.accessTokenHint}). Leave blank to keep it.` : 'EAAG…'}
              hint="Use a permanent system-user token. Temporary tokens from the API Setup page expire within a day."
            />
            <Input
              label="App secret"
              type="password"
              value={form.appSecret}
              onChange={set('appSecret')}
              autoComplete="off"
              placeholder={data.connected ? 'Saved. Leave blank to keep it.' : ''}
              hint="Used to check that incoming webhooks really come from Meta."
            />
            <div className="flex flex-wrap justify-between gap-2">
              <Button type="submit" loading={busy}>
                {data.connected ? 'Save changes' : 'Connect WhatsApp'}
              </Button>
              {data.connected ? (
                <Button variant="dangerGhost" onClick={disconnect}>
                  Disconnect
                </Button>
              ) : null}
            </div>
            <p className="text-sm text-mist-500">We check these with Meta before saving. The token and secret are stored encrypted and never shown again.</p>
          </form>
        </Panel>

        <Panel className="space-y-4 p-5">
          <h2 className="font-display text-lg font-semibold text-mist-900">Webhook</h2>
          <p className="text-mist-700">Paste these into your Meta app under WhatsApp → Configuration so messages and delivery receipts reach WaDesk.</p>
          {localUrl ? (
            <Notice tone="amber" title="This address only works on your computer">
              Meta needs a public HTTPS address. Set API_PUBLIC_URL on the server to your API’s public address (or a tunnel such as ngrok while testing).
            </Notice>
          ) : null}
          <CopyField label="Callback URL" value={data.webhookUrl} />
          <CopyField label="Verify token" value={data.verifyToken} />
        </Panel>
      </div>

      <Panel className="h-fit p-5">
        <h2 className="font-display text-lg font-semibold text-mist-900">How to connect</h2>
        <ol className="mt-3 space-y-3">
          {SETUP_STEPS.map((step, index) => (
            <li key={step} className="flex gap-3 text-mist-700">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">{index + 1}</span>
              <span className="leading-snug">{step}</span>
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}

function WorkspaceSettings() {
  const { reload: reloadProfile } = useAuth();
  const { toast } = useFeedback();
  const { data, error, loading, reload } = useApi('/settings/workspace');
  const [name, setName] = useState('');
  const [countryCode, setCountryCode] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data) {
      setName(data.name);
      setCountryCode(data.defaultCountryCode ?? '');
    }
  }, [data]);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await api('/settings/workspace', { method: 'PATCH', body: { name, defaultCountryCode: countryCode.trim() || null } });
      await reloadProfile();
      toast.success('Workspace saved');
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) return <LoadingBlock />;
  if (error && !data) return <ErrorBlock error={error} onRetry={reload} />;
  return (
    <Panel className="max-w-xl p-5">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Input label="Business name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        <Input
          label="Default country code"
          value={countryCode}
          onChange={(e) => setCountryCode(e.target.value)}
          placeholder="91"
          inputMode="numeric"
          hint="Added to 10-digit numbers you type or import without a country code. India is 91."
        />
        <Button type="submit" loading={busy} disabled={!name.trim()}>
          Save workspace
        </Button>
      </form>
    </Panel>
  );
}

function AccountSettings() {
  const { user, reload: reloadProfile, applySession } = useAuth();
  const { toast } = useFeedback();
  const [name, setName] = useState(user.name);
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '' });
  const [busy, setBusy] = useState(null);
  const [passwordError, setPasswordError] = useState(null);

  async function saveName(event) {
    event.preventDefault();
    setBusy('name');
    try {
      await api('/me', { method: 'PATCH', body: { name } });
      await reloadProfile();
      toast.success('Name saved');
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  }

  async function savePassword(event) {
    event.preventDefault();
    setBusy('password');
    setPasswordError(null);
    try {
      applySession(await api('/me/password', { method: 'POST', body: passwords }));
      setPasswords({ currentPassword: '', newPassword: '' });
      toast.success('Password changed. Other devices were signed out.');
    } catch (err) {
      setPasswordError(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid max-w-3xl gap-6 md:grid-cols-2">
      <Panel className="h-fit p-5">
        <h2 className="font-display text-lg font-semibold text-mist-900">Your profile</h2>
        <form onSubmit={saveName} className="mt-4 space-y-4" noValidate>
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} hint="Shown to your team next to the messages you send." maxLength={120} />
          <Input label="Email" value={user.email} disabled readOnly />
          <Button type="submit" loading={busy === 'name'} disabled={!name.trim() || name === user.name}>
            Save name
          </Button>
        </form>
      </Panel>
      <Panel className="h-fit p-5">
        <h2 className="font-display text-lg font-semibold text-mist-900">Password</h2>
        <form onSubmit={savePassword} className="mt-4 space-y-4" noValidate>
          {passwordError ? <Notice tone="red">{passwordError.message}</Notice> : null}
          <Input label="Current password" type="password" autoComplete="current-password" value={passwords.currentPassword} onChange={(e) => setPasswords((p) => ({ ...p, currentPassword: e.target.value }))} />
          <Input label="New password" type="password" autoComplete="new-password" value={passwords.newPassword} onChange={(e) => setPasswords((p) => ({ ...p, newPassword: e.target.value }))} hint="At least 8 characters." />
          <Button type="submit" loading={busy === 'password'} disabled={!passwords.currentPassword || passwords.newPassword.length < 8}>
            Change password
          </Button>
        </form>
      </Panel>
    </div>
  );
}

export default function SettingsPage() {
  const { isManager } = useAuth();
  const tabs = [
    ...(isManager
      ? [
          { value: 'whatsapp', label: 'WhatsApp' },
          { value: 'workspace', label: 'Workspace' },
        ]
      : []),
    { value: 'account', label: 'My account' },
  ];
  const [tab, setTab] = useState(tabs[0].value);

  return (
    <>
      <PageHeader title="Settings" />
      <PageBody>
        {tabs.length > 1 ? <Tabs tabs={tabs} value={tab} onChange={setTab} className="mb-6 max-w-md" /> : null}
        {tab === 'whatsapp' ? <WhatsAppSettings /> : tab === 'workspace' ? <WorkspaceSettings /> : <AccountSettings />}
      </PageBody>
    </>
  );
}
