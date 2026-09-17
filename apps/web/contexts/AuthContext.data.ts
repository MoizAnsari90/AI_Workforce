import { createContext } from "react";

export interface User {
  id: string;
  email: string;
  role: string;
  permissions: string[];
  tenantId: string;
}

export interface Tenant {
  id: string;
  name: string;
  stripeSubscriptionStatus: string;
}

export interface AuthContextType {
  user: User | null;
  tenant: Tenant | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (data: any) => void;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextType | null>(null);
