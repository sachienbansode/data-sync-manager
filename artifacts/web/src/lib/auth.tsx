import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useGetMe } from "@workspace/api-client-react";
import { useLocation } from "wouter";

type UserProfile = {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  roleId: number;
  roleName: string;
  isActive: boolean;
  mfaEnabled: boolean;
  authProvider: string;
  pagePermissions?: string[];
};

// In-memory token storage — survives re-renders, cleared on hard refresh (intentional)
let _accessToken: string | null = null;

export const setAccessToken = (token: string | null): void => {
  _accessToken = token;
};

export const getAccessToken = (): string | null => _accessToken;

interface AuthContextType {
  user: UserProfile | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  checkPermission: (path: string) => boolean;
  login: (token: string, userData: UserProfile) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [ready, setReady] = useState(false);
  const [, setLocation] = useLocation();

  const { data, isLoading, isError } = useGetMe({
    query: {
      retry: false,
      staleTime: Infinity,
      enabled: !!_accessToken,
    },
  });

  useEffect(() => {
    if (isLoading) return;
    if (data) {
      setUser(data as UserProfile);
    } else if (isError) {
      setUser(null);
      setAccessToken(null);
    }
    setReady(true);
  }, [data, isLoading, isError]);

  // When there's no token at all, mark ready immediately (no need to wait for /me)
  useEffect(() => {
    if (!_accessToken) setReady(true);
  }, []);

  const login = (token: string, userData: UserProfile) => {
    setAccessToken(token);
    setUser(userData);
    setReady(true);
  };

  const handleLogout = () => {
    setAccessToken(null);
    setUser(null);
    setLocation("/login");
  };

  const checkPermission = (path: string): boolean => {
    if (!user) return false;
    const publicPaths = ["/dashboard", "/profile", "/mfa-setup"];
    if (publicPaths.includes(path)) return true;
    return user.pagePermissions?.includes(path) ?? false;
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading: !ready,
        isAuthenticated: !!user,
        checkPermission,
        login,
        logout: handleLogout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
};
