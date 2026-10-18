"use client";

import { AuthProvider } from "@/contexts/AuthContext.hooks";
import { ToastProvider } from "@/contexts/ToastContext";
import { useRouter, usePathname } from "next/navigation";
import { ReactNode } from "react";
import { AppearanceProvider } from "@/contexts/AppearanceContext";
import { LanguageProvider } from '@/contexts/LanguageContext';
import type { Locale } from '@/lib/language';

export function ClientProviders({ children, initialLocale }: { children: ReactNode; initialLocale: Locale }) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <LanguageProvider initialLocale={initialLocale}><AppearanceProvider><ToastProvider>
      <AuthProvider router={router} pathname={pathname}>
        {children}
      </AuthProvider>
    </ToastProvider></AppearanceProvider></LanguageProvider>
  );
}
