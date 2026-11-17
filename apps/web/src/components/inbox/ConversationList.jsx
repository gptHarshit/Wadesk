'use client';

import { LuCheck, LuCheckCheck, LuCircleAlert, LuInbox, LuSearch } from 'react-icons/lu';
import { contactLabel, formatListTime } from '@/lib/format';
import { Avatar, Button, EmptyState, ErrorBlock, LoadingBlock, Tabs, cx } from '../ui';

const ASSIGNED_OPTIONS = [
  { value: 'all', label: 'Everyone' },
  { value: 'me', label: 'Assigned to me' },
  { value: 'unassigned', label: 'Unassigned' },
];

function Row({ conversation, active, onSelect }) {
  const name = contactLabel(conversation.contact);
  const unread = conversation.unreadCount > 0;
  const outgoing = conversation.lastMessageDirection === 'out';
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(conversation)}
        aria-current={active ? 'true' : undefined}
        className={cx(
          'relative flex w-full items-center gap-3 px-4 py-3 text-left transition-colors',
          active ? 'bg-leaf-50' : 'hover:bg-mist-50',
        )}
      >
        {active ? <span className="absolute inset-y-0 left-0 w-[3px] bg-leaf-600" aria-hidden /> : null}
        <Avatar label={name} seed={conversation.contact.id} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className={cx('truncate text-mist-900', unread ? 'font-bold' : 'font-medium')}>{name}</span>
            <span className={cx('shrink-0 text-xs', unread ? 'font-semibold text-marigold-700' : 'text-mist-500')}>
              {formatListTime(conversation.lastMessageAt)}
            </span>
          </span>
          <span className="mt-0.5 flex items-center gap-1.5">
            {outgoing ? <LuCheck className="h-3.5 w-3.5 shrink-0 text-mist-400" aria-label="You replied" /> : null}
            <span className={cx('min-w-0 flex-1 truncate text-sm', unread ? 'font-medium text-mist-800' : 'text-mist-500')}>
              {conversation.lastMessagePreview || 'No messages yet'}
            </span>
            {unread ? (
              <span className="shrink-0 rounded-full bg-marigold-400 px-1.5 text-xs font-bold text-mist-900" aria-label={`${conversation.unreadCount} unread`}>
                {conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}
              </span>
            ) : null}
          </span>
          {conversation.assignee ? <span className="mt-0.5 block truncate text-xs text-mist-500">Assigned to {conversation.assignee.name}</span> : null}
        </span>
      </button>
    </li>
  );
}

export function ConversationList({ list, filters, onFilters, search, onSearch, counts, selectedId, onSelect, onLoadMore, onRetry }) {
  return (
    <div className="flex h-full flex-col bg-white">
      <div className="space-y-2.5 border-b border-mist-200 px-4 pb-3 pt-4">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-mist-900">Inbox</h1>
        </div>
        <Tabs
          value={filters.status}
          onChange={(status) => onFilters({ ...filters, status })}
          tabs={[
            { value: 'open', label: 'Open', count: counts?.unread },
            { value: 'closed', label: 'Closed' },
          ]}
        />
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <LuSearch className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-mist-400" aria-hidden />
            <input
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Name or number"
              aria-label="Search conversations"
              className="h-9 w-full rounded-md border border-mist-300 bg-white pl-8 pr-2 text-sm placeholder:text-mist-400 focus:border-leaf-600 focus:outline-none"
            />
          </div>
          <select
            value={filters.assigned}
            onChange={(e) => onFilters({ ...filters, assigned: e.target.value })}
            aria-label="Filter by assignee"
            className="h-9 rounded-md border border-mist-300 bg-white px-2 text-sm text-mist-800 focus:border-leaf-600 focus:outline-none"
          >
            {ASSIGNED_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
                {option.value === 'me' && counts?.mine ? ` (${counts.mine})` : ''}
                {option.value === 'unassigned' && counts?.unassigned ? ` (${counts.unassigned})` : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {list.loading && !list.items.length ? (
          <LoadingBlock label="Loading conversations" />
        ) : list.error && !list.items.length ? (
          <ErrorBlock error={list.error} onRetry={onRetry} />
        ) : !list.items.length ? (
          <EmptyState icon={search ? LuSearch : filters.status === 'closed' ? LuCheckCheck : LuInbox} title={search ? 'No matches' : filters.status === 'closed' ? 'Nothing closed yet' : 'No open conversations'}>
            {search
              ? `Nothing matches “${search}”.`
              : filters.status === 'closed'
                ? 'Chats you close land here.'
                : 'New WhatsApp messages appear here as soon as they arrive.'}
          </EmptyState>
        ) : (
          <>
            <ul className="divide-y divide-mist-100">
              {list.items.map((conversation) => (
                <Row key={conversation.id} conversation={conversation} active={conversation.id === selectedId} onSelect={onSelect} />
              ))}
            </ul>
            {list.nextCursor ? (
              <div className="flex justify-center py-3">
                <Button variant="secondary" size="sm" onClick={onLoadMore} loading={list.loading}>
                  Show more
                </Button>
              </div>
            ) : null}
            {list.error ? (
              <p className="flex items-center justify-center gap-1.5 py-2 text-sm text-brick-700">
                <LuCircleAlert className="h-4 w-4" aria-hidden /> {list.error.message}
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
