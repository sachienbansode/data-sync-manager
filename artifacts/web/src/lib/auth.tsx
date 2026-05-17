import { createContext, useContext, useEffect, useRef, useState, ReactNode, useCallback } from "react";
import { useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { toast } from "sonner";

const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;  // 30 minutes
const WARNING_BEFORE_MS     =  1 * 60 * 1000;  // warn 1 minute before
const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "click"] as const;

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

  const logoutTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warningToastRef = useRef<string | number | null>(null);
  const isAuthenticatedRef = useRef(false);

  const clearInactivityTimers = useCallback(() => {
    if (logoutTimerRef.current)  clearTimeout(logoutTimerRef.current);
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    if (warningToastRef.current) toast.dismiss(warningToastRef.current);
    logoutTimerRef.current  = null;
    warningTimerRef.current = null;
    warningToastRef.current = null;
  }, []);

  // Forward-declared so the activity listener can reference it
  const resetInactivityTimer = useCallback(() => {
    if (!isAuthenticatedRef.current) return;
    clearInactivityTimers();

    warningTimerRef.current = setTimeout(() => {
      warningToastRef.current = toast.warning(
        "Your session will expire in 1 minute due to inactivity.",
        { duration: WARNING_BEFORE_MS, id: "inactivity-warning" },
      );
    }, INACTIVITY_TIMEOUT_MS - WARNING_BEFORE_MS);

    logoutTimerRef.current = setTimeout(() => {
      toast.dismiss("inactivity-warning");
      toast.error("Session expired due to inactivity. Please log in again.");
      // Trigger logout without waiting for user action
      setAccessToken(null);
      setRefreshToken(null);
      isAuthenticatedRef.current = false;
      clearInactivityTimers();
      queryClient.removeQueries({ queryKey: getGetMeQueryKey() });
      setUser(null);
      setHasToken(false);
      setLocation("/login");
    }, INACTIVITY_TIMEOUT_MS);
  }, [clearInactivityTimers, queryClient, setLocation]);

  // Attach / detach activity listeners whenever auth state changes
  useEffect(() => {
    if (!user) {
      isAuthenticatedRef.current = false;
      clearInactivityTimers();
      ACTIVITY_EVENTS.forEach(evt => window.removeEventListener(evt, resetInactivityTimer));
      return;
    }

    isAuthenticatedRef.current = true;
    resetInactivityTimer();
    ACTIVITY_EVENTS.forEach(evt =>
      window.addEventListener(evt, resetInactivityTimer, { passive: true })
    );

    return () => {
      ACTIVITY_EVENTS.forEach(evt => window.removeEventListener(evt, resetInactivityTimer));
      clearInactivityTimers();
    };
  }, [user, resetInactivityTimer, clearInactivityTimers]);

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
    if (user.roleName === "Admin") return true; // Admin always has full access
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
