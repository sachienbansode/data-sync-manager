import { useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useLogin, useVerifyMfa } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Activity, KeyRound, Mail, ArrowRight } from "lucide-react";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

export default function Login() {
  const [, setLocation] = useLocation();
  const { login } = useAuth();
  
  const [step, setStep] = useState<"login" | "mfa">("login");
  const [tempToken, setTempToken] = useState<string>("");
  const [mfaError, setMfaError] = useState("");

  const loginMutation = useLogin();
  const verifyMfaMutation = useVerifyMfa();

  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const onSubmit = async (values: z.infer<typeof loginSchema>) => {
    try {
      const response = await loginMutation.mutateAsync({ data: values });
      
      if (response.requiresMfa && response.tempToken) {
        setTempToken(response.tempToken);
        setStep("mfa");
      } else if (response.accessToken && response.user) {
        login(response.accessToken, response.user);
        setLocation("/dashboard");
      }
    } catch (error) {
      console.error(error);
      form.setError("root", { message: "Invalid credentials" });
    }
  };

  const handleMfaSubmit = async (code: string) => {
    if (code.length !== 6) return;
    
    setMfaError("");
    try {
      const response = await verifyMfaMutation.mutateAsync({
        data: { tempToken, code }
      });
      
      if (response.accessToken && response.user) {
        login(response.accessToken, response.user);
        setLocation("/dashboard");
      }
    } catch (error) {
      console.error(error);
      setMfaError("Invalid verification code");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 relative overflow-hidden">
      <div className="absolute inset-0 z-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 200 200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noiseFilter\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.65\' numOctaves=\'3\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noiseFilter)\'/%3E%3C/svg%3E")' }}></div>
      
      <div className="w-full max-w-md z-10 relative">
        <div className="mb-8 flex flex-col items-center">
          <div className="h-12 w-12 bg-primary/10 rounded-xl flex items-center justify-center mb-4">
            <Activity className="h-6 w-6 text-primary" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Ashika Enterprise</h1>
          <p className="text-sm text-muted-foreground mt-2">Sign in to your account</p>
        </div>

        <div className="bg-card border border-border shadow-xl rounded-xl p-8 relative overflow-hidden">
          
          {step === "login" ? (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Mail className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input placeholder="name@ashikagroup.com" className="pl-9" {...field} />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Password</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <KeyRound className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input type="password" placeholder="••••••••" className="pl-9" {...field} />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  {form.formState.errors.root && (
                    <div className="text-sm font-medium text-destructive bg-destructive/10 p-3 rounded-md border border-destructive/20">
                      {form.formState.errors.root.message}
                    </div>
                  )}

                  <Button type="submit" className="w-full mt-2" disabled={loginMutation.isPending}>
                    {loginMutation.isPending ? "Signing in..." : "Sign in"}
                    {!loginMutation.isPending && <ArrowRight className="ml-2 h-4 w-4" />}
                  </Button>
                </form>
              </Form>

              <div className="mt-6">
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">
                      Or continue with
                    </span>
                  </div>
                </div>

                <Button 
                  variant="outline" 
                  type="button" 
                  className="w-full mt-6 bg-transparent"
                  onClick={() => {
                    window.location.href = "/api/auth/m365";
                  }}
                >
                  <svg className="mr-2 h-4 w-4" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg">
                    <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
                    <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
                    <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
                    <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
                  </svg>
                  Microsoft 365
                </Button>
              </div>
            </div>
          ) : (
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
                  maxLength={6} 
                  onChange={(value) => {
                    if (value.length === 6) {
                      handleMfaSubmit(value);
                    }
                  }}
                  disabled={verifyMfaMutation.isPending}
                >
                  <InputOTPGroup className="w-full justify-center gap-2">
                    <InputOTPSlot index={0} className="w-12 h-12 text-lg" />
                    <InputOTPSlot index={1} className="w-12 h-12 text-lg" />
                    <InputOTPSlot index={2} className="w-12 h-12 text-lg" />
                    <InputOTPSlot index={3} className="w-12 h-12 text-lg" />
                    <InputOTPSlot index={4} className="w-12 h-12 text-lg" />
                    <InputOTPSlot index={5} className="w-12 h-12 text-lg" />
                  </InputOTPGroup>
                </InputOTP>
              </div>

              {mfaError && (
                <div className="text-sm font-medium text-destructive mb-4">
                  {mfaError}
                </div>
              )}

              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setStep("login")}
                className="mt-4"
              >
                Back to login
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Ensure the icon is imported for the MFA step
import { ShieldAlert } from "lucide-react";