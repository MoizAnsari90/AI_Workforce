"use client";

import { AuthProvider } from "@/contexts/AuthContext.hooks";
import { useRouter, usePathname } from "next/navigation";
import { ReactNode } from "react";

export function ClientProviders({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <AuthProvider router={router} pathname={pathname}>
      {children}
    </AuthProvider>
  );
}
