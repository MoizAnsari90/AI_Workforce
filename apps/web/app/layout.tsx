import "./globals.css";
import { ClientProviders } from "@/components/ClientProviders";
import { appearanceBootScript } from "@/lib/appearance";
import { cookies, headers } from 'next/headers';
import { direction, LANGUAGE_COOKIE, selectLocale } from '@/lib/language';

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [cookieStore, requestHeaders] = await Promise.all([cookies(), headers()]);
  const locale = selectLocale(cookieStore.get(LANGUAGE_COOKIE)?.value, requestHeaders.get('accept-language') || '');
  return (
    <html lang={locale} dir={direction(locale)} data-theme="dark" data-palette="standard" data-contrast="standard" className="dark" suppressHydrationWarning>
      <head><script id="appearance-init" dangerouslySetInnerHTML={{ __html: appearanceBootScript }} /></head>
      <body>
        <ClientProviders initialLocale={locale}>{children}</ClientProviders>
      </body>
    </html>
  );
}
