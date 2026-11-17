'use client';

import { AuthProvider } from '@/lib/auth';
import { SocketProvider } from '@/lib/socket';
import { FeedbackProvider } from './ui';

export function Providers({ children }) {
  return (
    <AuthProvider>
      <SocketProvider>
        <FeedbackProvider>{children}</FeedbackProvider>
      </SocketProvider>
    </AuthProvider>
  );
}
