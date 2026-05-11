import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";
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
// NOTE on XSS risk: tokens are in JS memory (not httpOnly cookies). This is an
// acknowledged tradeoff for a same-origin SPA. Mitigations: 15-min access token
// TTL, strict CSP, no eval/innerHTML in codebase. Future hardening: move to
// httpOnly SameSite=Strict cookies (requires CORS rework).
let _accessToken: string | null = null;

export const setAccessToken = (token: string | null): void => {
  _accessToken = token;
};

export const getAccessToken = (): string | null => _accessToken;

// Refresh token is persisted in sessionStorage (survives F5 in same tab, cleared
// when the browser session ends).
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

// Bootstrap: always called on mount. Exchanges the stored refresh token for a
// fresh access token so an expired in-memory token never blocks session restore.
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
  // hasToken is set to true only AFTER a successful bootstrap or login.
  // This prevents useGetMe from firing with a stale or absent token.
  const [hasToken, setHasToken] = useState(false);
  const [, setLocation] = useLocation();

  // On mount: always bootstrap from stored refresh token (even if an old
  // access token might have been in memory — it is not persisted, so memory
  // is clean after a page reload).
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
      // /me failed (e.g. access token issued with wrong secret). Clear everything.
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
