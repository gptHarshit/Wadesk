'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { API_URL, getAccessToken, refreshSession } from './api';
import { useAuth } from './auth';

const SocketContext = createContext({ socket: null, connected: false });

/** One live connection per signed-in browser tab, shared by every page. */
export function SocketProvider({ children }) {
  const { status } = useAuth();
  const [value, setValue] = useState({ socket: null, connected: false });

  useEffect(() => {
    if (status !== 'authed') return undefined;

    const socket = io(API_URL, {
      // A function, so every reconnect sends the current access token.
      auth: (cb) => cb({ token: getAccessToken() }),
      transports: ['websocket', 'polling'],
      reconnectionDelayMax: 10_000,
    });
    setValue({ socket, connected: false });

    socket.on('connect', () => setValue({ socket, connected: true }));
    socket.on('disconnect', () => setValue({ socket, connected: false }));
    socket.on('connect_error', async (err) => {
      // The access token expired while we were disconnected: get a new one, then retry.
      if (err?.message === 'unauthorized') {
        const session = await refreshSession();
        if (session) socket.connect();
      }
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      setValue({ socket: null, connected: false });
    };
  }, [status]);

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export const useSocket = () => useContext(SocketContext);

/** Subscribe to a server event for as long as the component is mounted. */
export function useSocketEvent(event, handler) {
  const { socket } = useSocket();
  const latest = useRef(handler);
  latest.current = handler;

  useEffect(() => {
    if (!socket) return undefined;
    const listener = (payload) => latest.current(payload);
    socket.on(event, listener);
    return () => socket.off(event, listener);
  }, [socket, event]);
}
