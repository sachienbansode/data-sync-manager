import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { Loader2 } from "lucide-react";
import { Layout } from "@/components/layout";

interface ProtectedRouteProps {
  component: React.ComponentType;
  path: string;
  requireRole?: string;
}

export function ProtectedRoute({ component: Component, path, requireRole }: ProtectedRouteProps) {
  const { user, isLoading, checkPermission } = useAuth();
  const [location, setLocation] = useLocation();

  const hasPermission = !isLoading && !!user && checkPermission(path);
  const hasRole = !requireRole || user?.roleName === requireRole;

  useEffect(() => {
    if (!isLoading && !user) {
      setLocation("/login");
    } else if (!isLoading && user && (!checkPermission(path) || !hasRole)) {
      setLocation("/403");
    }
  }, [user, isLoading, location, setLocation, path, checkPermission, hasRole]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user || !hasPermission || !hasRole) {
    return null;
  }

  return (
    <Layout>
      <Component />
    </Layout>
  );
}
