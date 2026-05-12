import { useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { ShieldAlert, Activity, KeyRound, Mail, ArrowRight, RefreshCw } from "lucide-react";
import { useLogin, useVerifyMfa } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAppSettings, getLogoUrl } from "@/lib/use-app-settings";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

const otpEmailSchema = z.object({
  email: z.string().email("Invalid email address"),
});

type LoginMode = "password" | "emailotp";
type Step = "login" | "mfa" | "emailotp-send" | "emailotp-verify";

export default function Login() {
  const [, setLocation] = useLocation();
  const { login } = useAuth();

  const [mode, setMode] = useState<LoginMode>("password");
  const [step, setStep] = useState<Step>("login");
  const [tempToken, setTempToken] = useState<string>("");
  const [mfaError, setMfaError] = useState("");
  const [otpEmail, setOtpEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpSending, setOtpSending] = useState(false);
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [otpError, setOtpError] = useState("");
  const [otpSent, setOtpSent] = useState(false);

  const loginMutation = useLogin();
  const verifyMfaMutation = useVerifyMfa();

  const passwordForm = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const otpEmailForm = useForm<z.infer<typeof otpEmailSchema>>({
    resolver: zodResolver(otpEmailSchema),
    defaultValues: { email: "" },
  });

  const onPasswordSubmit = async (values: z.infer<typeof loginSchema>) => {
    try {
      const response = await loginMutation.mutateAsync({ data: values });
      if (response.requiresMfa && response.tempToken) {
        setTempToken(response.tempToken);
        setStep("mfa");
      } else if (response.accessToken && response.refreshToken && response.user) {
        login(response.accessToken, response.refreshToken, response.user);
        setLocation("/dashboard");
      }
    } catch {
      passwordForm.setError("root", { message: "Invalid email or password" });
    }
  };

  const handleMfaSubmit = async (code: string) => {
    if (code.length !== 6) return;
    setMfaError("");
    try {
      const response = await verifyMfaMutation.mutateAsync({ data: { tempToken, code } });
      if (response.accessToken && response.refreshToken && response.user) {
        login(response.accessToken, response.refreshToken, response.user);
        setLocation("/dashboard");
      }
    } catch {
      setMfaError("Invalid verification code. Please try again.");
    }
  };

  const handleSendOtp = async (values: z.infer<typeof otpEmailSchema>) => {
    setOtpSending(true);
    setOtpError("");
    try {
      const resp = await fetch(`${import.meta.env.BASE_URL}api/auth/email-otp/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: values.email }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error ?? "Failed to send OTP");
      setOtpEmail(values.email);
      setOtpSent(true);
      setStep("emailotp-verify");
    } catch (err: unknown) {
      setOtpError(err instanceof Error ? err.message : "Failed to send OTP");
    } finally {
      setOtpSending(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (otpCode.length !== 6) return;
    setOtpVerifying(true);
    setOtpError("");
    try {
      const resp = await fetch(`${import.meta.env.BASE_URL}api/auth/email-otp/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: otpEmail, otp: otpCode }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error ?? "Invalid OTP");
      if (data.accessToken && data.refreshToken && data.user) {
        login(data.accessToken, data.refreshToken, data.user);
        setLocation("/dashboard");
      }
    } catch (err: unknown) {
      setOtpError(err instanceof Error ? err.message : "Invalid or expired OTP");
      setOtpCode("");
    } finally {
      setOtpVerifying(false);
    }
  };

  const resetToLogin = () => {
    setStep("login");
    setOtpCode("");
    setOtpError("");
    setOtpSent(false);
    setMfaError("");
    passwordForm.reset();
  };

  const handleModeChange = (m: string) => {
    setMode(m as LoginMode);
    setStep(m === "emailotp" ? "emailotp-send" : "login");
    setOtpCode("");
    setOtpError("");
    setOtpSent(false);
    setMfaError("");
  };

  const { data: appCfg } = useAppSettings();
  const logoUrl = `${import.meta.env.BASE_URL}api/admin/app-settings/logo`;

  return (
    <div
      data-testid="login-page"
      className="min-h-screen flex items-center justify-center bg-background p-4 relative overflow-hidden"
    >
      <div className="absolute top-4 right-4 z-20">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-md z-10 relative">
        <div className="mb-8 flex flex-col items-center">
          <div className="h-16 w-16 rounded-xl flex items-center justify-center mb-4 overflow-hidden bg-primary/10">
            {appCfg?.hasLogo ? (
              <img src={logoUrl} alt="Logo" className="h-full w-full object-contain p-1" />
            ) : (
              <Activity className="h-7 w-7 text-primary" />
            )}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{appCfg?.appName ?? "Ashika Enterprise"}</h1>
          <p className="text-sm text-muted-foreground mt-2">Sign in to your account</p>
        </div>

        <div className="bg-card border border-border shadow-xl rounded-xl p-8 relative overflow-hidden">
          {/* MFA step */}
          {step === "mfa" && (
            <div className="animate-in fade-in slide-in-from-right-8 duration-500 flex flex-col items-center">
              <div className="h-12 w-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
                <ShieldAlert className="h-6 w-6 text-primary" />
              </div>
              <h2 className="text-xl font-semibold mb-2">Two-Factor Authentication</h2>
              <p className="text-sm text-center text-muted-foreground mb-6">
                Enter the 6-digit code from your authenticator app.
              </p>
              <div className="w-full max-w-xs mx-auto mb-4">
                <InputOTP
                  data-testid="input-mfa-code"
                  maxLength={6}
                  onChange={(value) => { if (value.length === 6) handleMfaSubmit(value); }}
                  disabled={verifyMfaMutation.isPending}
                >
                  <InputOTPGroup className="w-full justify-center gap-2">
                    {[0,1,2,3,4,5].map(i => <InputOTPSlot key={i} index={i} className="w-12 h-12 text-lg" />)}
                  </InputOTPGroup>
                </InputOTP>
              </div>
              {mfaError && <div data-testid="text-mfa-error" className="text-sm font-medium text-destructive mb-4">{mfaError}</div>}
              <Button variant="ghost" size="sm" onClick={resetToLogin} className="mt-4">Back to login</Button>
            </div>
          )}

          {/* Email OTP verify step */}
          {step === "emailotp-verify" && (
            <div className="animate-in fade-in slide-in-from-right-8 duration-500 flex flex-col items-center">
              <div className="h-12 w-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
                <Mail className="h-6 w-6 text-primary" />
              </div>
              <h2 className="text-xl font-semibold mb-2">Check Your Email</h2>
              <p className="text-sm text-center text-muted-foreground mb-1">
                We sent a 6-digit code to
              </p>
              <p className="text-sm font-medium text-foreground mb-6">{otpEmail}</p>
              <div className="w-full max-w-xs mx-auto mb-4">
                <InputOTP
                  maxLength={6}
                  value={otpCode}
                  onChange={(value) => { setOtpCode(value); if (value.length === 6) { setOtpCode(value); setTimeout(() => handleVerifyOtp(), 0); } }}
                  disabled={otpVerifying}
                >
                  <InputOTPGroup className="w-full justify-center gap-2">
                    {[0,1,2,3,4,5].map(i => <InputOTPSlot key={i} index={i} className="w-12 h-12 text-lg" />)}
                  </InputOTPGroup>
                </InputOTP>
              </div>
              {otpError && <div className="text-sm font-medium text-destructive mb-4 text-center">{otpError}</div>}
              <Button className="w-full max-w-xs" onClick={handleVerifyOtp} disabled={otpCode.length !== 6 || otpVerifying}>
                {otpVerifying ? "Verifying..." : "Verify Code"}
              </Button>
              <div className="flex gap-3 mt-4">
                <Button variant="ghost" size="sm" onClick={() => { setStep("emailotp-send"); setOtpCode(""); setOtpError(""); setOtpSent(false); }}>
                  <RefreshCw className="h-3 w-3 mr-1" />Resend
                </Button>
                <Button variant="ghost" size="sm" onClick={() => { resetToLogin(); setMode("password"); }}>Back to login</Button>
              </div>
            </div>
          )}

          {/* Main login steps */}
          {(step === "login" || step === "emailotp-send") && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <Tabs value={mode} onValueChange={handleModeChange} className="mb-6">
                <TabsList className="w-full">
                  <TabsTrigger value="password" className="flex-1">Password</TabsTrigger>
                  <TabsTrigger value="emailotp" className="flex-1">Email OTP</TabsTrigger>
                </TabsList>
              </Tabs>

              {mode === "password" && (
                <Form {...passwordForm}>
                  <form onSubmit={passwordForm.handleSubmit(onPasswordSubmit)} className="space-y-4">
                    <FormField control={passwordForm.control} name="email" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Mail className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input data-testid="input-email" placeholder="name@ashikagroup.com" className="pl-9" autoComplete="email" {...field} />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={passwordForm.control} name="password" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Password</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <KeyRound className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input data-testid="input-password" type="password" placeholder="••••••••" className="pl-9" autoComplete="current-password" {...field} />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    {passwordForm.formState.errors.root && (
                      <div data-testid="text-login-error" className="text-sm font-medium text-destructive bg-destructive/10 p-3 rounded-md border border-destructive/20">
                        {passwordForm.formState.errors.root.message}
                      </div>
                    )}
                    <Button data-testid="button-sign-in" type="submit" className="w-full mt-2" disabled={loginMutation.isPending}>
                      {loginMutation.isPending ? "Signing in..." : "Sign in"}
                      {!loginMutation.isPending && <ArrowRight className="ml-2 h-4 w-4" />}
                    </Button>
                  </form>
                </Form>
              )}

              {mode === "emailotp" && (
                <Form {...otpEmailForm}>
                  <form onSubmit={otpEmailForm.handleSubmit(handleSendOtp)} className="space-y-4">
                    <FormField control={otpEmailForm.control} name="email" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email Address</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Mail className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input placeholder="name@ashikagroup.com" className="pl-9" autoComplete="email" {...field} />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    {otpError && <div className="text-sm font-medium text-destructive bg-destructive/10 p-3 rounded-md border border-destructive/20">{otpError}</div>}
                    <Button type="submit" className="w-full mt-2" disabled={otpSending}>
                      {otpSending ? "Sending OTP..." : "Send OTP"}
                      {!otpSending && <ArrowRight className="ml-2 h-4 w-4" />}
                    </Button>
                    <p className="text-xs text-center text-muted-foreground">A one-time code will be sent to your email address.</p>
                  </form>
                </Form>
              )}

              <div className="mt-6">
                <div className="relative">
                  <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
                  </div>
                </div>
                <Button
                  data-testid="button-m365"
                  variant="outline"
                  type="button"
                  className="w-full mt-6 bg-transparent"
                  onClick={() => { window.location.href = "/api/auth/m365"; }}
                >
                  <svg className="mr-2 h-4 w-4" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg">
                    <rect x="1" y="1" width="9" height="9" fill="#f25022" />
                    <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
                    <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
                    <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
                  </svg>
                  Microsoft 365
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
