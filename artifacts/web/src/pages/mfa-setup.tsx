import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useSetupMfa, useVerifyMfa } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";

import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Shield, ShieldCheck, ArrowLeft, Loader2, Copy } from "lucide-react";
import { toast } from "sonner";

export default function MfaSetup() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const setupMfaMutation = useSetupMfa();
  const verifyMfaMutation = useVerifyMfa();
  
  const [setupData, setSetupData] = useState<{ secret: string; qrCodeUrl: string } | null>(null);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");

  useEffect(() => {
    const initSetup = async () => {
      try {
        const data = await setupMfaMutation.mutateAsync();
        setSetupData(data);
      } catch (err) {
        toast.error("Failed to initialize MFA setup");
      }
    };
    
    // Only fetch if user doesn't already have MFA enabled
    if (user && !user.mfaEnabled) {
      initSetup();
    } else if (user?.mfaEnabled) {
      setLocation("/profile");
    }
  }, [user]);

  const handleVerify = async () => {
    if (code.length !== 6) return;
    
    setError("");
    try {
      // In setup flow, we don't have a tempToken. The verify endpoint for setup
      // typically uses the current session token to verify the code and enable MFA.
      // Since our generated API requires tempToken, we pass an empty string indicating setup mode.
      await verifyMfaMutation.mutateAsync({
        data: { tempToken: "setup", code }
      });
      
      toast.success("MFA successfully enabled!");
      // Force reload to get updated user profile with mfaEnabled=true
      window.location.href = "/dashboard";
    } catch (err) {
      setError("Invalid verification code. Please try again.");
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
    <div className="min-h-screen flex items-center justify-center bg-background p-4 relative overflow-hidden">
      <div className="absolute inset-0 z-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 200 200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noiseFilter\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.65\' numOctaves=\'3\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noiseFilter)\'/%3E%3C/svg%3E")' }}></div>
      
      <Card className="w-full max-w-md z-10 shadow-xl border-border">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto h-12 w-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
            <Shield className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl">Secure Your Account</CardTitle>
          <CardDescription>
            Set up Two-Factor Authentication (2FA) using an authenticator app like Google Authenticator or Authy.
          </CardDescription>
        </CardHeader>
        
        <CardContent className="space-y-6 pt-6">
          <div className="bg-card p-4 rounded-xl border flex justify-center bg-white dark:bg-white">
            {/* The QR code URL from the backend should be an image src or SVG. We render it directly. */}
            <img 
              src={setupData.qrCodeUrl} 
              alt="MFA QR Code" 
              className="w-48 h-48 rounded-md"
            />
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-center">Can't scan the QR code?</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-muted p-2 rounded text-xs text-center border break-all">
                {setupData.secret}
              </code>
              <Button variant="outline" size="icon" onClick={copySecret}>
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
              disabled={verifyMfaMutation.isPending}
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
              <p className="text-sm font-medium text-destructive text-center">
                {error}
              </p>
            )}
          </div>
        </CardContent>
        
        <CardFooter className="flex flex-col gap-3">
          <Button 
            className="w-full" 
            onClick={handleVerify}
            disabled={code.length !== 6 || verifyMfaMutation.isPending}
          >
            {verifyMfaMutation.isPending ? "Verifying..." : "Verify & Enable"}
            {!verifyMfaMutation.isPending && <ShieldCheck className="ml-2 h-4 w-4" />}
          </Button>
          <Button variant="ghost" className="w-full" onClick={() => setLocation("/profile")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Profile
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
