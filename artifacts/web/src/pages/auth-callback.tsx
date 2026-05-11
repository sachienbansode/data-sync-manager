import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { Loader2 } from "lucide-react";

export default function AuthCallback() {
  const [, setLocation] = useLocation();
  const { login } = useAuth();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const error = params.get("error");

    if (error || !code) {
      setLocation(`/login?error=${error ?? "unknown"}`);
      return;
    }

    fetch("/api/auth/m365/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    })
      .then((res) => res.json())
      .then((data: { accessToken?: string; user?: Parameters<typeof login>[1] }) => {
        if (data.accessToken && data.user) {
          login(data.accessToken, data.user);
          setLocation("/dashboard");
        } else {
          setLocation("/login?error=exchange_failed");
        }
      })
      .catch(() => {
        setLocation("/login?error=exchange_failed");
      });
  }, []);

  return (
    <div
      data-testid="auth-callback-page"
      className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background"
    >
      <Loader2 className="h-10 w-10 animate-spin text-primary" />
      <p className="text-sm text-muted-foreground">Completing sign-in...</p>
    </div>
  );
}
