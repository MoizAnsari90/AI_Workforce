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
          const data = await res.json();
          setUser(data.data.user);
          setTenant(data.data.tenant);
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
        alert(err.error?.message || "Login failed. Please verify your credentials or register first.");
      }
    } catch (e: any) {
      alert("Network error during login: " + (e.message || "Unknown error"));
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
