import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useGetMe, UserProfile } from "@workspace/api-client-react";
import { useLocation } from "wouter";

// In-memory token storage
let accessToken: string | null = null;

export const setAccessToken = (token: string | null) => {
  accessToken = token;
};

export const getAccessToken = () => accessToken;

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
  const [, setLocation] = useLocation();
  
  const { data, isLoading, isError } = useGetMe({
    query: {
      retry: false,
      staleTime: Infinity,
    }
  });

  useEffect(() => {
    if (data) {
      setUser(data);
    } else if (isError) {
      setUser(null);
      setAccessToken(null);
    }
  }, [data, isError]);

  const login = (token: string, userData: UserProfile) => {
    setAccessToken(token);
    setUser(userData);
  };

  const handleLogout = () => {
    setAccessToken(null);
    setUser(null);
    setLocation("/login");
  };

  const checkPermission = (path: string) => {
    if (!user) return false;
    // Allow basic routes
    if (["/dashboard", "/profile", "/mfa-setup", "/login"].includes(path)) return true;
    
    // Check page permissions
    if (user.pagePermissions) {
      return user.pagePermissions.includes(path);
    }
    return false;
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
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
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};

// Also configure the custom fetch interceptor to inject the token and handle 401s
// We'll assume the API client uses custom-fetch.ts which we might need to modify later if it doesn't already use getAccessToken.
