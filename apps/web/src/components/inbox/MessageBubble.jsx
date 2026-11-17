'use client';

import { useEffect, useState } from 'react';
import { LuCheck, LuCheckCheck, LuCircleAlert, LuClock, LuDownload, LuFile, LuImage, LuPlay } from 'react-icons/lu';
import { api } from '@/lib/api';
import { formatBytes, formatTime } from '@/lib/format';
import { Spinner, cx } from '../ui';

const URL_PATTERN = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g;

/** Message text with links made clickable. React escapes everything else. */
function RichText({ text }) {
  const parts = String(text ?? '').split(URL_PATTERN);
  return (
    <p className="whitespace-pre-wrap break-words leading-snug">
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-sky-700 underline underline-offset-2">
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </p>
  );
}

/** Media is behind the API's auth, so fetch it with our token and show it from a blob URL. */
function useMedia(messageId, enabled) {
  const [state, setState] = useState({ url: null, loading: false, error: null });

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    let objectUrl = null;
    setState({ url: null, loading: true, error: null });
    api(`/media/${messageId}`, { blob: true })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ url: objectUrl, loading: false, error: null });
      })
      .catch((error) => {
        if (!cancelled) setState({ url: null, loading: false, error });
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [messageId, enabled]);

  return state;
}

function MediaUnavailable({ label = 'Media could not be loaded' }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-black/5 px-3 py-2 text-sm text-mist-600">
      <LuImage className="h-4 w-4 shrink-0" aria-hidden />
      {label}
    </div>
  );
}

function ImageMedia({ message }) {
  const { url, loading, error } = useMedia(message.id, message.media.available);
  if (!message.media.available || error) return <MediaUnavailable />;
  if (loading || !url) {
    return (
      <div className="flex h-40 w-56 max-w-full items-center justify-center rounded-lg bg-black/5">
        <Spinner />
      </div>
    );
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="block">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={message.body || 'Photo'}
        className={cx('rounded-lg object-cover', message.type === 'sticker' ? 'h-28 w-28' : 'max-h-72 w-auto max-w-full')}
      />
    </a>
  );
}

function PlayableMedia({ message }) {
  const [wanted, setWanted] = useState(false);
  const { url, loading, error } = useMedia(message.id, wanted && message.media.available);
  const isVideo = message.type === 'video';
  if (!message.media.available || error) return <MediaUnavailable />;
  if (url) {
    return isVideo ? (
      // eslint-disable-next-line jsx-a11y/media-has-caption
      <video src={url} controls autoPlay className="max-h-72 max-w-full rounded-lg" />
    ) : (
      // eslint-disable-next-line jsx-a11y/media-has-caption
      <audio src={url} controls autoPlay className="w-64 max-w-full" />
    );
  }
  return (
    <button
      type="button"
      onClick={() => setWanted(true)}
      disabled={loading}
      className="flex items-center gap-2.5 rounded-lg bg-black/5 px-3 py-2.5 text-left hover:bg-black/10"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-leaf-600 text-white">
        {loading ? <Spinner className="h-4 w-4 text-white" /> : <LuPlay className="h-4 w-4" aria-hidden />}
      </span>
      <span>
        <span className="block font-medium">{isVideo ? 'Play video' : 'Play voice message'}</span>
        {message.media.size ? <span className="block text-sm text-mist-500">{formatBytes(message.media.size)}</span> : null}
      </span>
    </button>
  );
}

function DocumentMedia({ message }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const name = message.media.filename || 'Document';

  async function download() {
    setBusy(true);
    setFailed(false);
    try {
      const blob = await api(`/media/${message.id}`, { blob: true });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2.5 rounded-lg bg-black/5 px-3 py-2.5">
      <LuFile className="h-7 w-7 shrink-0 text-mist-500" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{name}</p>
        <p className="text-sm text-mist-500">{failed ? 'Download failed. Try again.' : formatBytes(message.media.size)}</p>
      </div>
      <button
        type="button"
        onClick={download}
        disabled={busy || !message.media.available}
        aria-label={`Download ${name}`}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-black/10 disabled:opacity-40"
      >
        {busy ? <Spinner className="h-4 w-4" /> : <LuDownload className="h-4 w-4" aria-hidden />}
      </button>
    </div>
  );
}

function Media({ message }) {
  if (!message.media) return null;
  if (message.type === 'image' || message.type === 'sticker') return <ImageMedia message={message} />;
  if (message.type === 'audio' || message.type === 'video') return <PlayableMedia message={message} />;
  return <DocumentMedia message={message} />;
}

const STATUS = {
  queued: { icon: LuClock, label: 'Sending', className: 'text-mist-400' },
  sent: { icon: LuCheck, label: 'Sent', className: 'text-mist-400' },
  delivered: { icon: LuCheckCheck, label: 'Delivered', className: 'text-mist-400' },
  read: { icon: LuCheckCheck, label: 'Read', className: 'text-sky-700' },
  failed: { icon: LuCircleAlert, label: 'Not sent', className: 'text-brick-600' },
};

function sentByLabel(message) {
  if (message.source === 'auto_reply') return 'Auto-reply';
  if (message.source === 'campaign') return 'Campaign';
  return message.senderName || null;
}

export function MessageBubble({ message }) {
  const mine = message.direction === 'out';
  const status = mine ? STATUS[message.status] : null;
  const from = mine ? sentByLabel(message) : null;
  const failed = message.status === 'failed';

  return (
    <div className={cx('flex', mine ? 'justify-end' : 'justify-start')}>
      <div className="max-w-[min(78%,34rem)]">
        <div
          className={cx(
            'rounded-2xl px-3.5 py-2 text-mist-900 shadow-sm',
            mine ? 'rounded-br-sm bg-leaf-100' : 'rounded-bl-sm bg-white',
            failed && 'ring-1 ring-brick-600/40',
          )}
        >
          {from || message.templateName ? (
            <p className="mb-0.5 text-xs font-semibold text-leaf-800">
              {[from, message.templateName ? `template “${message.templateName}”` : null].filter(Boolean).join(', ')}
            </p>
          ) : null}
          {message.media ? (
            <div className={message.body ? 'mb-1.5' : undefined}>
              <Media message={message} />
            </div>
          ) : null}
          {message.type === 'unsupported' ? (
            <p className="italic text-mist-500">{message.body}</p>
          ) : message.body ? (
            <RichText text={message.body} />
          ) : null}
          <p className="mt-0.5 flex items-center justify-end gap-1 text-xs text-mist-500">
            <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
            {status ? <status.icon className={cx('h-3.5 w-3.5', status.className)} aria-label={status.label} /> : null}
          </p>
        </div>
        {failed ? (
          <p className="mt-1 text-right text-xs text-brick-700">
            Not sent{message.errorMessage ? `: ${message.errorMessage}` : ''}
            {message.errorCode ? ` (code ${message.errorCode})` : ''}
          </p>
        ) : null}
      </div>
    </div>
  );
}
