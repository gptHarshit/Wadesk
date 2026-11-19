'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  LuFileText,
  LuInbox,
  LuLayoutDashboard,
  LuLogOut,
  LuMegaphone,
  LuMenu,
  LuMoon,
  LuSettings,
  LuSun,
  LuUsers,
  LuUsersRound,
  LuX,
  LuZap,
} from 'react-icons/lu';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useSocket, useSocketEvent } from '@/lib/socket';
import { applyTheme, currentTheme } from '@/lib/theme';
import { Avatar, cx } from './ui';

/** Switch between light and dark. The choice is saved in this browser only. */
function ThemeToggle() {
  const [theme, setTheme] = useState('light');
  useEffect(() => setTheme(currentTheme()), []);
  const next = theme === 'dark' ? 'light' : 'dark';
  const Icon = theme === 'dark' ? LuSun : LuMoon;
  return (
    <button
      type="button"
      onClick={() => {
        applyTheme(next);
        setTheme(next);
      }}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      className="rounded-md p-2 text-white/60 transition-colors hover:bg-rail-800 hover:text-white"
    >
      <Icon className="h-4 w-4" aria-hidden />
    </button>
  );
}

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LuLayoutDashboard },
  { href: '/inbox', label: 'Inbox', icon: LuInbox, badge: 'unread' },
  { href: '/contacts', label: 'Contacts', icon: LuUsers },
  { href: '/campaigns', label: 'Campaigns', icon: LuMegaphone },
  { href: '/templates', label: 'Templates', icon: LuFileText },
  { href: '/auto-replies', label: 'Auto-replies', icon: LuZap },
  { href: '/team', label: 'Team', icon: LuUsersRound },
  { href: '/settings', label: 'Settings', icon: LuSettings },
];

/** Number of open chats with unread messages, kept fresh by socket events. */
function useUnreadCount() {
  const [unread, setUnread] = useState(0);
  const timer = useRef(null);

  const load = useCallback(() => {
    api('/conversations/counts')
      .then((counts) => setUnread(counts?.unread ?? 0))
      .catch(() => {});
  }, []);
  // Many events can arrive together; one reload shortly after is enough.
  const loadSoon = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(load, 400);
  }, [load]);

  useEffect(() => {
    load();
    return () => clearTimeout(timer.current);
  }, [load]);
  useSocketEvent('message:new', loadSoon);
  useSocketEvent('conversation:updated', loadSoon);
  return unread;
}

function NavLinks({ onNavigate, unread }) {
  const pathname = usePathname();
  return (
    <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2" aria-label="Main">
      {NAV.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const count = item.badge === 'unread' ? unread : 0;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cx(
              'relative flex items-center gap-3 rounded-md px-3 py-2 font-medium transition-colors',
              active ? 'bg-rail-700 text-white' : 'text-white/70 hover:bg-rail-800 hover:text-white',
            )}
          >
            {active ? <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-marigold-400" aria-hidden /> : null}
            <item.icon className="h-[1.15rem] w-[1.15rem] shrink-0" aria-hidden />
            <span className="flex-1">{item.label}</span>
            {count > 0 ? (
              <span className="rounded-full bg-marigold-400 px-1.5 text-xs font-semibold text-ink" aria-label={`${count} unread`}>
                {count > 99 ? '99+' : count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

function Sidebar({ onNavigate }) {
  const { user, workspace, logout } = useAuth();
  const { connected } = useSocket();
  const unread = useUnreadCount();

  return (
    <div className="flex h-full w-60 flex-col bg-rail-900">
      <div className="flex items-center gap-2.5 px-5 pb-3 pt-5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.svg" alt="" className="h-8 w-8" />
        <div className="min-w-0">
          <p className="font-display text-lg font-semibold leading-tight tracking-tight text-white">WaDesk</p>
          <p className="truncate text-sm leading-tight text-white/60">{workspace?.name}</p>
        </div>
      </div>

      <NavLinks onNavigate={onNavigate} unread={unread} />

      <div className="border-t border-white/10 px-3 py-3">
        <div className="flex items-center gap-2.5 px-2">
          <Avatar label={user?.name} seed={user?.id} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium leading-tight text-white">{user?.name}</p>
            <p className="flex items-center gap-1.5 text-xs capitalize leading-tight text-white/60">
              <span className={cx('h-1.5 w-1.5 rounded-full', connected ? 'bg-leaf-500' : 'bg-marigold-400')} aria-hidden />
              {connected ? user?.role : 'reconnecting…'}
            </p>
          </div>
          <ThemeToggle />
          <button
            type="button"
            onClick={logout}
            aria-label="Sign out"
            title="Sign out"
            className="rounded-md p-2 text-white/60 transition-colors hover:bg-rail-800 hover:text-white"
          >
            <LuLogOut className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}

/** Frame for every signed-in page: navigation rail on the left, page on the right. */
export function AppShell({ children }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();
  const current = NAV.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  return (
    <div className="flex h-dvh overflow-hidden bg-mist-50">
      <aside className="hidden shrink-0 lg:block">
        <Sidebar />
      </aside>

      {menuOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-rail-950/60" onClick={() => setMenuOpen(false)} aria-hidden />
          <div className="relative h-full w-60 shadow-xl">
            <Sidebar onNavigate={() => setMenuOpen(false)} />
            <button
              type="button"
              onClick={() => setMenuOpen(false)}
              aria-label="Close menu"
              className="absolute -right-11 top-3 rounded-md bg-rail-900 p-2 text-white"
            >
              <LuX className="h-5 w-5" aria-hidden />
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-2 bg-rail-900 px-3 text-white lg:hidden">
          <button type="button" onClick={() => setMenuOpen(true)} aria-label="Open menu" className="rounded-md p-2 hover:bg-rail-800">
            <LuMenu className="h-5 w-5" aria-hidden />
          </button>
          <span className="font-display font-semibold">{current?.label ?? 'WaDesk'}</span>
        </div>
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
