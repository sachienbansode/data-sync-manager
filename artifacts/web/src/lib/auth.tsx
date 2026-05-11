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

const REFRESH_TOKEN_KEY = "ashika_rt";
const ACCESS_TOKEN_KEY = "ashika_at";

// In-memory access token — short-lived, never persisted to disk
let _accessToken: string | null = sessionStorage.getItem(ACCESS_TOKEN_KEY);

export const setAccessToken = (token: string | null): void => {
  _accessToken = token;
  if (token) {
    sessionStorage.setItem(ACCESS_TOKEN_KEY, token);
  } else {
    sessionStorage.removeItem(ACCESS_TOKEN_KEY);
  }
};

export const getAccessToken = (): string | null => _accessToken;

// Opaque refresh token persisted across tab sessions (same browser tab group)
export const setRefreshToken = (token: string | null): void => {
  if (token) {
    sessionStorage.setItem(REFRESH_TOKEN_KEY, token);
  } else {
    sessionStorage.removeItem(REFRESH_TOKEN_KEY);
  }
};

export const getRefreshToken = (): string | null =>
  sessionStorage.getItem(REFRESH_TOKEN_KEY);

// Bootstrap: try to use stored refresh token to get a new access token on load
async function bootstrapSession(): Promise<boolean> {
  const rt = getRefreshToken();
  if (!rt) return false;
  try {
    const resp = await fetch(`${import.meta.env.BASE_URL}api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: rt }),
    });
    if (!resp.ok) {
      setRefreshToken(null);
      setAccessToken(null);
      return false;
    }
    const data = await resp.json();
    setAccessToken(data.accessToken);
    setRefreshToken(data.refreshToken);
    return true;
  } catch {
    setRefreshToken(null);
    setAccessToken(null);
    return false;
  }
}

interface AuthContextType {
  user: UserProfile | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  checkPermission: (path: string) => boolean;
  login: (accessToken: string, refreshToken: string, userData: UserProfile) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [ready, setReady] = useState(false);
  const [hasToken, setHasToken] = useState(!!_accessToken);
  const [, setLocation] = useLocation();

  // On mount: attempt to bootstrap session from stored refresh token
  useEffect(() => {
    if (_accessToken) {
      setHasToken(true);
      return;
    }
    bootstrapSession().then((ok) => {
      setHasToken(ok);
      if (!ok) setReady(true);
    });
  }, []);

  const { data, isLoading, isError } = useGetMe({
    query: {
      retry: false,
      staleTime: Infinity,
      enabled: hasToken,
    },
  });

  useEffect(() => {
    if (!hasToken) return;
    if (isLoading) return;
    if (data) {
      setUser(data as UserProfile);
    } else if (isError) {
      setUser(null);
      setAccessToken(null);
      setRefreshToken(null);
    }
    setReady(true);
  }, [data, isLoading, isError, hasToken]);

  const login = (accessToken: string, refreshToken: string, userData: UserProfile) => {
    setAccessToken(accessToken);
    setRefreshToken(refreshToken);
    setUser(userData);
    setHasToken(true);
    setReady(true);
  };

  const handleLogout = async () => {
    const at = getAccessToken();
    if (at) {
      try {
        await fetch(`${import.meta.env.BASE_URL}api/auth/logout`, {
          method: "POST",
          headers: { Authorization: `Bearer ${at}` },
        });
      } catch { /* best effort */ }
    }
    setAccessToken(null);
    setRefreshToken(null);
    setUser(null);
    setHasToken(false);
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
