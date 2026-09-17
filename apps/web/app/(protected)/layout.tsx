"use client";
import { AuthProvider } from "@/contexts/AuthContext.hooks";
import { useRouter, usePathname } from "next/navigation";

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  
  // ClientLayout functionality (AuthProvider setup)
  return (
    <AuthProvider router={router} pathname={pathname}>
      {children}
    </AuthProvider>
  );
}
