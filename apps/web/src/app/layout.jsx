import { Providers } from '@/components/Providers';
import { THEME_BOOT_SCRIPT } from '@/lib/theme';
import './globals.css';

export const metadata = {
  title: 'WaDesk',
  description: 'A shared WhatsApp inbox and campaign tool for your team.',
  icons: { icon: '/icon.svg' },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#12313a',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        {/* Mukta covers Latin and Devanagari, so Hindi names and messages render in the same face. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Anek+Latin:wght@500;600;700&family=Mukta:wght@400;500;600;700&display=swap"
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
