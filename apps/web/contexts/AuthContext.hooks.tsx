"use client";

import { useContext, useEffect, useState, ReactNode } from "react";
import { AuthContext } from "./AuthContext.data";

export function AuthProvider({ children, router, pathname }: { children: ReactNode; router: any; pathname: string | null }) {
  // SSR-safe state: initialize as null
  const [mounted, setMounted] = useState(false);
  const [user, setUser] = useState<any | null>(null);
  const [tenant, setTenant] = useState<any | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || !router || !pathname) return;
    // Only perform auth logic on client-side
    const checkUserAuth = async () => {
      // Do not check auth on auth pages
      if (pathname === "/login" || pathname === "/register") {
        setIsLoading(false);
        return;
      }

      try {
        const res = await fetch("/api/auth/me");
        if (res.ok) {
          const json = await res.json();
          // API /auth/me returns userContext directly in json.data:
          // { userId, tenantId, email, role, permissions }
          const raw = json.data;
          const userObj = {
            id: raw.userId || raw.id,
            tenantId: raw.tenantId,
            email: raw.email,
            role: raw.role,
            permissions: raw.permissions,
          };
          const tenantObj = {
            id: raw.tenantId,
            name: raw.tenantName || "Default Workspace",
          };

          setUser(userObj);
          setTenant(tenantObj);
          setIsAuthenticated(true);
        } else {
          setIsAuthenticated(false);
        }
      } catch {
        setIsAuthenticated(false);
      } finally {
        setIsLoading(false);
      }
    };

    checkUserAuth();
  }, [router, pathname, mounted]);

  async function login(credentials: any) {
    if (!router) return;
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(credentials),
        headers: { "Content-Type": "application/json" },
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data.data.user);
        setTenant(data.data.tenant);
        setIsAuthenticated(true);
        window.location.href = "/dashboard";
      } else {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || "Login failed. Please check credentials.");
      }
    } catch (e: any) {
      throw e;
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    setTenant(null);
    setIsAuthenticated(false);
    window.location.href = "/login";
  }

  const value = { user, tenant, isAuthenticated, isLoading, login, logout };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  return context || {
    user: null,
    tenant: null,
    isAuthenticated: false,
    isLoading: false,
    login: () => {},
    logout: () => {},
  };
};
