'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, refreshSession, setAccessToken, setSessionLostHandler } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // status: "loading" until we know, then "authed" or "guest"
  const [state, setState] = useState({ status: 'loading', user: null, workspace: null });

  const applySession = useCallback((session) => {
    if (session?.accessToken) setAccessToken(session.accessToken);
    setState(
      session?.user
        ? { status: 'authed', user: session.user, workspace: session.workspace }
        : { status: 'guest', user: null, workspace: null },
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    setSessionLostHandler(() => {
      setAccessToken(null);
      setState({ status: 'guest', user: null, workspace: null });
    });
    refreshSession().then((session) => {
      if (!cancelled) applySession(session);
    });
    return () => {
      cancelled = true;
    };
  }, [applySession]);

  const value = useMemo(
    () => ({
      ...state,
      isManager: state.user?.role === 'owner' || state.user?.role === 'admin',
      applySession,
      async login(email, password) {
        applySession(await api('/auth/login', { method: 'POST', body: { email, password } }));
      },
      async signup(fields) {
        applySession(await api('/auth/signup', { method: 'POST', body: fields }));
      },
      async logout() {
        try {
          await api('/auth/logout', { method: 'POST' });
        } finally {
          setAccessToken(null);
          setState({ status: 'guest', user: null, workspace: null });
        }
      },
      /** Re-read the user and workspace (after changing settings). */
      async reload() {
        const profile = await api('/me');
        if (profile) setState({ status: 'authed', user: profile.user, workspace: profile.workspace });
      },
    }),
    [state, applySession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
