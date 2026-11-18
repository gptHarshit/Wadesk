'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  LuArchive,
  LuArrowLeft,
  LuFile,
  LuFileText,
  LuMessageSquare,
  LuPanelRight,
  LuPaperclip,
  LuRotateCcw,
  LuSend,
  LuTimer,
  LuX,
} from 'react-icons/lu';
import { api } from '@/lib/api';
import { contactLabel, dayKey, formatBytes, formatDayHeading, formatDuration, formatPhone } from '@/lib/format';
import { useTick } from '@/lib/hooks';
import { useSocketEvent } from '@/lib/socket';
import { SendTemplateDialog } from '../templates';
import { Avatar, Button, ErrorBlock, IconButton, LoadingBlock, cx, useFeedback } from '../ui';
import { MessageBubble } from './MessageBubble';
import { SavedRepliesDialog, fillSavedReply } from './SavedReplies';

const DAY_MS = 24 * 60 * 60 * 1000;

function mergeMessages(current, incoming) {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, { ...byId.get(m.id), ...m });
  return [...byId.values()].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt) || a.id.localeCompare(b.id));
}

/**
 * WhatsApp lets a business reply freely for 24 hours after the customer's last
 * message. This strip shows how much of that window is left.
 */
function ReplyWindow({ conversation }) {
  useTick(30_000);
  const remaining = conversation.windowExpiresAt ? new Date(conversation.windowExpiresAt).getTime() - Date.now() : 0;
  if (remaining <= 0) return null;
  const low = remaining < 4 * 60 * 60 * 1000;
  return (
    <div className="flex items-center gap-2.5 px-4 pt-2 text-xs text-mist-600">
      <LuTimer className={cx('h-3.5 w-3.5 shrink-0', low ? 'text-marigold-700' : 'text-mist-400')} aria-hidden />
      <span className={low ? 'font-medium text-marigold-800' : undefined}>Reply window closes in {formatDuration(remaining)}</span>
      <span className="h-1 flex-1 overflow-hidden rounded-full bg-mist-200" aria-hidden>
        <span
          className={cx('block h-full rounded-full', low ? 'bg-marigold-500' : 'bg-leaf-500')}
          style={{ width: `${Math.max(2, Math.min(100, (remaining / DAY_MS) * 100))}%` }}
        />
      </span>
    </div>
  );
}

function Composer({ conversation, onSent, onOpenTemplates }) {
  const { toast } = useFeedback();
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [sending, setSending] = useState(false);
  const [savedOpen, setSavedOpen] = useState(false);
  const textarea = useRef(null);
  const fileInput = useRef(null);

  // Grow the box with the text, up to about six lines.
  useLayoutEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
  }, [text]);

  async function send() {
    const body = text.trim();
    if ((!body && !file) || sending) return;
    setSending(true);
    try {
      let result;
      if (file) {
        const form = new FormData();
        form.set('file', file);
        if (body) form.set('caption', body);
        result = await api(`/conversations/${conversation.id}/media`, { method: 'POST', form });
      } else {
        result = await api(`/conversations/${conversation.id}/messages`, { method: 'POST', body: { text: body } });
      }
      setText('');
      setFile(null);
      onSent(result);
      if (result.message.status === 'failed') toast.error(result.message.errorMessage || 'WhatsApp did not accept this message');
    } catch (err) {
      toast.error(err);
    } finally {
      setSending(false);
      textarea.current?.focus();
    }
  }

  function insertSaved(reply) {
    const filled = fillSavedReply(reply.body, conversation.contact);
    setText((current) => (current.trim() ? `${current.replace(/\s+$/, '')}\n${filled}` : filled));
    setSavedOpen(false);
    requestAnimationFrame(() => {
      const el = textarea.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }

  function onKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  }

  if (!conversation.windowOpen) {
    return (
      <div className="border-t border-mist-200 bg-marigold-50 px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <LuTimer className="h-5 w-5 shrink-0 text-marigold-700" aria-hidden />
          <p className="min-w-0 flex-1 text-sm leading-snug text-marigold-800">
            {conversation.lastInboundAt
              ? 'The 24-hour reply window has closed. Send an approved template; you can reply freely again once the customer answers.'
              : 'This customer hasn’t messaged you yet. WhatsApp only allows an approved template as the first message.'}
          </p>
          <Button icon={LuFileText} onClick={onOpenTemplates}>
            Choose template
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-mist-200 bg-white">
      <ReplyWindow conversation={conversation} />
      {file ? (
        <div className="mx-4 mt-2 flex items-center gap-2 rounded-md bg-mist-100 px-3 py-2 text-sm">
          <LuFile className="h-4 w-4 shrink-0 text-mist-500" aria-hidden />
          <span className="min-w-0 flex-1 truncate font-medium">{file.name}</span>
          <span className="text-mist-500">{formatBytes(file.size)}</span>
          <button type="button" onClick={() => setFile(null)} aria-label="Remove attachment" className="rounded p-0.5 hover:bg-mist-200">
            <LuX className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ) : null}
      <div className="flex items-end gap-1.5 px-3 py-2.5">
        <input
          ref={fileInput}
          type="file"
          className="hidden"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            e.target.value = '';
          }}
        />
        <IconButton label="Attach a file" icon={LuPaperclip} onClick={() => fileInput.current?.click()} className="mb-0.5" />
        <IconButton label="Send a template" icon={LuFileText} onClick={onOpenTemplates} className="mb-0.5" />
        <IconButton label="Saved replies" icon={LuMessageSquare} onClick={() => setSavedOpen(true)} className="mb-0.5" />
        <textarea
          ref={textarea}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={file ? 'Add a caption (optional)' : 'Type a message'}
          aria-label="Message"
          className="max-h-[150px] min-h-10 flex-1 resize-none rounded-2xl border border-mist-300 bg-mist-50 px-4 py-2 leading-snug placeholder:text-mist-400 focus:border-leaf-600 focus:bg-white focus:outline-none"
        />
        <Button onClick={send} loading={sending} disabled={!text.trim() && !file} icon={LuSend} className="mb-0.5 rounded-full" aria-label="Send">
          <span className="hidden sm:inline">Send</span>
        </Button>
      </div>
      <SavedRepliesDialog open={savedOpen} onClose={() => setSavedOpen(false)} onInsert={insertSaved} />
    </div>
  );
}

function ThreadHeader({ conversation, team, onBack, onPatch, onToggleDetails, detailsOpen }) {
  const contact = conversation.contact;
  const name = contactLabel(contact);
  const closed = conversation.status === 'closed';
  return (
    <header className="flex items-center gap-2 border-b border-mist-200 bg-white px-3 py-2.5">
      <IconButton label="Back to conversations" icon={LuArrowLeft} onClick={onBack} className="md:hidden" />
      <Avatar label={name} seed={contact.id} />
      <div className="min-w-0 flex-1">
        <h2 className="truncate font-semibold leading-tight text-mist-900">{name}</h2>
        <p className="truncate text-sm leading-tight text-mist-500">{formatPhone(contact.phone) || contact.waUsername || 'Number hidden by the customer'}</p>
      </div>
      <label className="hidden items-center gap-1.5 text-sm text-mist-600 sm:flex">
        <span className="sr-only">Assigned to</span>
        <select
          value={conversation.assignedTo ?? ''}
          onChange={(e) => onPatch({ assignedTo: e.target.value || null })}
          className="h-9 max-w-40 rounded-md border border-mist-300 bg-white px-2 text-mist-800 focus:border-leaf-600 focus:outline-none"
        >
          <option value="">Unassigned</option>
          {team.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
      </label>
      <Button variant="secondary" size="sm" icon={closed ? LuRotateCcw : LuArchive} onClick={() => onPatch({ status: closed ? 'open' : 'closed' })}>
        {closed ? 'Reopen' : 'Close'}
      </Button>
      <IconButton
        label={detailsOpen ? 'Hide contact details' : 'Show contact details'}
        icon={LuPanelRight}
        onClick={onToggleDetails}
        className={detailsOpen ? 'bg-mist-100 text-mist-900' : undefined}
      />
    </header>
  );
}

/** One conversation: header, messages (newest at the bottom), composer. Mount with key={conversation.id}. */
export function Thread({ conversation, team, onConversation, onBack, onToggleDetails, detailsOpen }) {
  const { toast } = useFeedback();
  const [messages, setMessages] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [error, setError] = useState(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const scroller = useRef(null);
  const stickToBottom = useRef(true);
  const restoreFrom = useRef(null);
  const readTimer = useRef(null);
  const id = conversation.id;

  const markRead = useCallback(() => {
    clearTimeout(readTimer.current);
    readTimer.current = setTimeout(() => {
      if (document.visibilityState !== 'visible') return;
      api(`/conversations/${id}/read`, { method: 'POST' }).then(onConversation).catch(() => {});
    }, 500);
  }, [id, onConversation]);

  const load = useCallback(
    async ({ quiet = false } = {}) => {
      if (!quiet) setLoading(true);
      setError(null);
      try {
        const page = await api(`/conversations/${id}/messages`);
        setMessages((current) => (quiet ? mergeMessages(current, page.items) : page.items));
        if (!quiet) setCursor(page.nextCursor);
      } catch (err) {
        if (!quiet) setError(err);
      } finally {
        setLoading(false);
      }
    },
    [id],
  );

  useEffect(() => {
    load();
    return () => clearTimeout(readTimer.current);
  }, [load]);

  // Opening a chat with unread messages marks it read.
  useEffect(() => {
    if (conversation.unreadCount > 0) markRead();
  }, [conversation.unreadCount, markRead]);

  useSocketEvent('message:new', ({ message }) => {
    if (message.conversationId !== id) return;
    setMessages((current) => mergeMessages(current, [message]));
  });
  useSocketEvent('message:status', (update) => {
    if (update.conversationId !== id) return;
    setMessages((current) => current.map((m) => (m.id === update.id ? { ...m, ...update } : m)));
  });
  // After a dropped connection, fetch anything we missed.
  useSocketEvent('connect', () => load({ quiet: true }));

  async function loadEarlier() {
    if (!cursor || loadingEarlier) return;
    setLoadingEarlier(true);
    restoreFrom.current = scroller.current ? scroller.current.scrollHeight - scroller.current.scrollTop : null;
    try {
      const page = await api(`/conversations/${id}/messages`, { query: { before: cursor } });
      setMessages((current) => mergeMessages(current, page.items));
      setCursor(page.nextCursor);
    } catch (err) {
      toast.error(err);
    } finally {
      setLoadingEarlier(false);
    }
  }

  // Keep the view pinned to the newest message unless the agent has scrolled up to read history.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (restoreFrom.current !== null) {
      el.scrollTop = el.scrollHeight - restoreFrom.current;
      restoreFrom.current = null;
    } else if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, loading]);

  function onScroll() {
    const el = scroller.current;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }

  function onSent(result) {
    stickToBottom.current = true;
    setMessages((current) => mergeMessages(current, [result.message]));
    onConversation(result.conversation);
  }

  async function patch(changes) {
    try {
      onConversation(await api(`/conversations/${id}`, { method: 'PATCH', body: changes }));
    } catch (err) {
      toast.error(err);
    }
  }

  let lastDay = null;
  return (
    <section className="flex min-w-0 flex-1 flex-col" aria-label={`Conversation with ${contactLabel(conversation.contact)}`}>
      <ThreadHeader
        conversation={conversation}
        team={team}
        onBack={onBack}
        onPatch={patch}
        onToggleDetails={onToggleDetails}
        detailsOpen={detailsOpen}
      />

      <div ref={scroller} onScroll={onScroll} className="thread-surface scroll-thin min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6">
        {loading ? (
          <LoadingBlock label="Loading messages" />
        ) : error ? (
          <ErrorBlock error={error} onRetry={load} />
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-1.5">
            {cursor ? (
              <div className="mb-2 flex justify-center">
                <Button variant="secondary" size="sm" onClick={loadEarlier} loading={loadingEarlier}>
                  Load earlier messages
                </Button>
              </div>
            ) : null}
            {!messages.length ? (
              <p className="mx-auto mt-10 max-w-xs rounded-lg bg-white/80 px-4 py-3 text-center text-sm text-mist-600">
                No messages yet. Send a template to start the conversation.
              </p>
            ) : null}
            {messages.map((message) => {
              const key = dayKey(message.createdAt);
              const heading = key !== lastDay;
              lastDay = key;
              return (
                <div key={message.id} className="flex flex-col gap-1.5">
                  {heading ? (
                    <p className="mx-auto my-2 rounded-full bg-white/90 px-3 py-0.5 text-xs font-medium text-mist-600 shadow-sm">
                      {formatDayHeading(message.createdAt)}
                    </p>
                  ) : null}
                  <MessageBubble message={message} />
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Composer conversation={conversation} onSent={onSent} onOpenTemplates={() => setTemplatesOpen(true)} />
      <SendTemplateDialog open={templatesOpen} onClose={() => setTemplatesOpen(false)} conversation={conversation} onSent={onSent} />
    </section>
  );
}
