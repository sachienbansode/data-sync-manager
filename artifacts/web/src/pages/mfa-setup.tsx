import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useSetupMfa } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { getAccessToken } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Shield, ShieldCheck, ArrowLeft, Loader2, Copy } from "lucide-react";
import { toast } from "sonner";

export default function MfaSetup() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const setupMfaMutation = useSetupMfa();

  const [setupData, setSetupData] = useState<{ secret: string; qrCodeUrl: string } | null>(null);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [isConfirming, setIsConfirming] = useState(false);

  useEffect(() => {
    if (user && !user.mfaEnabled) {
      setupMfaMutation.mutateAsync().then(setSetupData).catch(() => {
        toast.error("Failed to initialize MFA setup");
      });
    } else if (user?.mfaEnabled) {
      setLocation("/profile");
    }
  }, [user]);

  const handleVerify = async () => {
    if (code.length !== 6) return;

    setError("");
    setIsConfirming(true);
    try {
      const token = getAccessToken();
      const res = await fetch("/api/auth/mfa/confirm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ code }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Verification failed");
      }

      toast.success("MFA successfully enabled!");
      window.location.href = "/dashboard";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid verification code. Please try again.");
    } finally {
      setIsConfirming(false);
    }
  };

  const copySecret = () => {
    if (setupData?.secret) {
      navigator.clipboard.writeText(setupData.secret);
      toast.success("Secret copied to clipboard");
    }
  };

  if (setupMfaMutation.isPending || !setupData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div
      data-testid="mfa-setup-page"
      className="min-h-screen flex items-center justify-center bg-background p-4"
    >
      <Card className="w-full max-w-md shadow-xl border-border">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto h-12 w-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
            <Shield className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl">Secure Your Account</CardTitle>
          <CardDescription>
            Set up Two-Factor Authentication using Google Authenticator, Authy, or any TOTP app.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6 pt-6">
          <div className="bg-white dark:bg-white p-4 rounded-xl border flex justify-center">
            <img
              src={setupData.qrCodeUrl}
              alt="MFA QR Code"
              data-testid="img-qr-code"
              className="w-48 h-48 rounded-md"
            />
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-center">Can't scan the QR code?</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-muted p-2 rounded text-xs text-center border break-all">
                {setupData.secret}
              </code>
              <Button variant="outline" size="icon" onClick={copySecret} data-testid="button-copy-secret">
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="border-t pt-6 space-y-4 flex flex-col items-center">
            <p className="text-sm font-medium text-center">Enter the 6-digit code from your app</p>
            <InputOTP
              maxLength={6}
              value={code}
              onChange={setCode}
              disabled={isConfirming}
              data-testid="input-mfa-setup-code"
            >
              <InputOTPGroup className="w-full justify-center gap-2">
                <InputOTPSlot index={0} className="w-10 h-10 sm:w-12 sm:h-12 text-lg" />
                <InputOTPSlot index={1} className="w-10 h-10 sm:w-12 sm:h-12 text-lg" />
                <InputOTPSlot index={2} className="w-10 h-10 sm:w-12 sm:h-12 text-lg" />
                <InputOTPSlot index={3} className="w-10 h-10 sm:w-12 sm:h-12 text-lg" />
                <InputOTPSlot index={4} className="w-10 h-10 sm:w-12 sm:h-12 text-lg" />
                <InputOTPSlot index={5} className="w-10 h-10 sm:w-12 sm:h-12 text-lg" />
              </InputOTPGroup>
            </InputOTP>

            {error && (
              <p data-testid="text-mfa-setup-error" className="text-sm font-medium text-destructive text-center">
                {error}
              </p>
            )}
          </div>
        </CardContent>

        <CardFooter className="flex flex-col gap-3">
          <Button
            data-testid="button-verify-enable"
            className="w-full"
            onClick={handleVerify}
            disabled={code.length !== 6 || isConfirming}
          >
            {isConfirming ? "Verifying..." : "Verify & Enable"}
            {!isConfirming && <ShieldCheck className="ml-2 h-4 w-4" />}
          </Button>
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => setLocation("/profile")}
            data-testid="button-back-profile"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Profile
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
