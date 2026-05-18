import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
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

// NOTE: Access tokens are intentionally NOT persisted to sessionStorage.
// They are short-lived (15 min) and kept only in memory. On every page reload
// we always exchange the stored refresh token for a fresh access token, so an
// expired in-memory token can never block session restoration.
let _accessToken: string | null = null;

export const setAccessToken = (token: string | null): void => {
  _accessToken = token;
};

export const getAccessToken = (): string | null => _accessToken;

// Refresh token persisted in sessionStorage (survives F5 in same tab, cleared on browser close).
const REFRESH_TOKEN_KEY = "ashika_rt";

export const setRefreshToken = (token: string | null): void => {
  if (token) {
    sessionStorage.setItem(REFRESH_TOKEN_KEY, token);
  } else {
    sessionStorage.removeItem(REFRESH_TOKEN_KEY);
  }
};

export const getRefreshToken = (): string | null =>
  sessionStorage.getItem(REFRESH_TOKEN_KEY);

// Silent refresh: called by the API client on any 401 received during active use.
export async function silentRefresh(): Promise<string | null> {
  const rt = getRefreshToken();
  if (!rt) return null;
  try {
    const resp = await fetch(`${import.meta.env.BASE_URL}api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: rt }),
    });
    if (!resp.ok) {
      setRefreshToken(null);
      setAccessToken(null);
      return null;
    }
    const data = await resp.json();
    setAccessToken(data.accessToken);
    setRefreshToken(data.refreshToken);
    return data.accessToken as string;
  } catch {
    setRefreshToken(null);
    setAccessToken(null);
    return null;
  }
}

// Bootstrap: always called on mount. Exchanges stored refresh token for a fresh access token.
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
  const [hasToken, setHasToken] = useState(false);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  useEffect(() => {
    bootstrapSession().then((ok) => {
      setHasToken(ok);
      if (!ok) setReady(true);
    });
  }, []);

  const { data, isLoading, isError } = useGetMe({
    query: {
      queryKey: getGetMeQueryKey(),
      retry: false,
      staleTime: 0,
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
      setHasToken(false);
    }
    setReady(true);
  }, [data, isLoading, isError, hasToken]);

  const login = (accessToken: string, refreshToken: string, userData: UserProfile) => {
    setAccessToken(accessToken);
    setRefreshToken(refreshToken);
    setUser(userData);
    // Clear any stale /me cache from a previous user so the query re-fetches
    // with the new token instead of returning the old session's data.
    queryClient.removeQueries({ queryKey: getGetMeQueryKey() });
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
    setReady(true);
    // Clear /me cache so the next login always fetches fresh data
    queryClient.removeQueries({ queryKey: getGetMeQueryKey() });
    setLocation("/login");
  };

  const checkPermission = (path: string): boolean => {
    if (!user) return false;
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
