'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { LuMessagesSquare } from 'react-icons/lu';
import { ContactPanel } from '@/components/inbox/ContactPanel';
import { ConversationList } from '@/components/inbox/ConversationList';
import { Thread } from '@/components/inbox/Thread';
import { EmptyState, cx, useFeedback } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApi, useDebounced } from '@/lib/hooks';
import { useSocketEvent } from '@/lib/socket';

const byNewest = (a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt) || b.id.localeCompare(a.id);

export default function InboxPage() {
  const { user } = useAuth();
  const { toast } = useFeedback();
  const [filters, setFilters] = useState({ status: 'open', assigned: 'all' });
  const [searchInput, setSearchInput] = useState('');
  const search = useDebounced(searchInput.trim(), 300);
  const [list, setList] = useState({ items: [], nextCursor: null, loading: true, error: null });
  const [active, setActive] = useState(null); // the conversation shown in the thread pane
  const [detailsOpen, setDetailsOpen] = useState(false);
  const { data: counts, reload: reloadCounts } = useApi('/conversations/counts');
  const { data: teamData } = useApi('/team');
  const team = (teamData?.items ?? []).filter((m) => m.status === 'active');
  const request = useRef(0);
  const countsTimer = useRef(null);

  const matches = useCallback(
    (conversation) =>
      conversation.status === filters.status &&
      (filters.assigned === 'all' ||
        (filters.assigned === 'me' && conversation.assignedTo === user.id) ||
        (filters.assigned === 'unassigned' && !conversation.assignedTo)),
    [filters, user.id],
  );

  const load = useCallback(
    async ({ cursor = null, quiet = false } = {}) => {
      const id = ++request.current;
      if (!quiet) setList((l) => ({ ...l, loading: true, error: null, ...(cursor ? {} : { items: [] }) }));
      try {
        const page = await api('/conversations', { query: { ...filters, search, cursor } });
        if (id !== request.current) return;
        setList((l) => ({
          items: cursor ? [...l.items, ...page.items.filter((c) => !l.items.some((x) => x.id === c.id))] : page.items,
          nextCursor: page.nextCursor,
          loading: false,
          error: null,
        }));
      } catch (error) {
        if (id === request.current) setList((l) => ({ ...l, loading: false, error }));
      }
    },
    [filters, search],
  );

  useEffect(() => {
    load();
  }, [load]);

  // Arriving from the Contacts page with ?c=<conversation id> opens that chat.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('c');
    if (!id) return;
    api(`/conversations/${id}`)
      .then((conversation) => {
        setActive(conversation);
        if (conversation.status === 'closed') setFilters((f) => ({ ...f, status: 'closed' }));
      })
      .catch((err) => toast.error(err));
    window.history.replaceState(null, '', window.location.pathname);
  }, [toast]);

  const refreshCounts = useCallback(() => {
    clearTimeout(countsTimer.current);
    countsTimer.current = setTimeout(() => reloadCounts({ quiet: true }), 400);
  }, [reloadCounts]);
  useEffect(() => () => clearTimeout(countsTimer.current), []);

  /** Put a new or changed conversation where it belongs in the list (or take it out). */
  const upsert = useCallback(
    (conversation) => {
      if (!conversation) return;
      setActive((current) => (current?.id === conversation.id ? conversation : current));
      setList((l) => {
        const exists = l.items.some((c) => c.id === conversation.id);
        if (!matches(conversation)) return exists ? { ...l, items: l.items.filter((c) => c.id !== conversation.id) } : l;
        // While searching, only refresh rows that are already showing.
        if (!exists && search) return l;
        const items = exists ? l.items.map((c) => (c.id === conversation.id ? conversation : c)) : [conversation, ...l.items];
        return { ...l, items: items.sort(byNewest) };
      });
      refreshCounts();
    },
    [matches, search, refreshCounts],
  );

  useSocketEvent('message:new', ({ conversation }) => upsert(conversation));
  useSocketEvent('conversation:updated', ({ conversation }) => upsert(conversation));
  useSocketEvent('connect', () => {
    load({ quiet: true });
    refreshCounts();
  });

  function onContactChanged(contact) {
    const patch = (c) =>
      c.contact.id === contact.id
        ? { ...c, contact: { ...c.contact, name: contact.name, phone: contact.phone, optedOut: contact.optedOut } }
        : c;
    setActive((current) => (current ? patch(current) : current));
    setList((l) => ({ ...l, items: l.items.map(patch) }));
  }

  async function patchActive(changes) {
    try {
      upsert(await api(`/conversations/${active.id}`, { method: 'PATCH', body: changes }));
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <div className="flex h-full min-h-0">
      {/* On phones the list and the thread take turns; from md up they sit side by side. */}
      <div className={cx('h-full w-full shrink-0 border-r border-mist-200 md:w-80 xl:w-[22rem]', active ? 'hidden md:block' : 'block')}>
        <ConversationList
          list={list}
          filters={filters}
          onFilters={setFilters}
          search={searchInput}
          onSearch={setSearchInput}
          counts={counts}
          selectedId={active?.id}
          onSelect={setActive}
          onLoadMore={() => load({ cursor: list.nextCursor })}
          onRetry={() => load()}
        />
      </div>

      {active ? (
        <>
          <div className={cx('h-full min-w-0 flex-1', detailsOpen ? 'hidden lg:flex' : 'flex')}>
            <Thread
              key={active.id}
              conversation={active}
              team={team}
              onConversation={upsert}
              onBack={() => setActive(null)}
              onToggleDetails={() => setDetailsOpen((open) => !open)}
              detailsOpen={detailsOpen}
            />
          </div>
          {detailsOpen ? (
            <div className="h-full w-full shrink-0 lg:w-80">
              <ContactPanel
                key={active.contact.id}
                conversation={active}
                team={team}
                onClose={() => setDetailsOpen(false)}
                onContactChanged={onContactChanged}
                onPatchConversation={patchActive}
              />
            </div>
          ) : null}
        </>
      ) : (
        <div className="thread-surface hidden h-full flex-1 items-center justify-center md:flex">
          <EmptyState icon={LuMessagesSquare} title="Pick a conversation">
            Choose a chat on the left to read it and reply.
          </EmptyState>
        </div>
      )}
    </div>
  );
}
