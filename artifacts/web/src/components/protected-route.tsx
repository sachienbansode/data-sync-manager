import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { Loader2 } from "lucide-react";
import { Layout } from "@/components/layout";

interface ProtectedRouteProps {
  component: React.ComponentType;
  path: string;
}

export function ProtectedRoute({ component: Component, path }: ProtectedRouteProps) {
  const { user, isLoading, checkPermission } = useAuth();
  const [location, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && !user) {
      // Not logged in, redirect to login
      setLocation("/login");
    } else if (!isLoading && user && !checkPermission(path)) {
      // Logged in but no permission
      setLocation("/403");
    }
  }, [user, isLoading, location, setLocation, path, checkPermission]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user || !checkPermission(path)) {
    return null;
  }

  return (
    <Layout>
      <Component />
    </Layout>
  );
}
