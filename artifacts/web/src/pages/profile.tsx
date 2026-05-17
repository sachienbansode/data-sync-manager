import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useChangePassword, useDisableMfa } from "@workspace/api-client-react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { format } from "date-fns";

import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { UserCircle, Shield, ShieldOff, KeyRound, Mail, Clock } from "lucide-react";

const passwordSchema = z.object({
  currentPassword: z.string().min(1, "Required"),
  newPassword: z.string().min(8, "Must be at least 8 characters"),
  confirmPassword: z.string().min(8, "Must be at least 8 characters"),
}).refine(data => data.newPassword === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

export default function Profile() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const changePasswordMutation = useChangePassword();
  const disableMfaMutation = useDisableMfa();

  const form = useForm<z.infer<typeof passwordSchema>>({
    resolver: zodResolver(passwordSchema),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
  });

  const onSubmitPassword = async (values: z.infer<typeof passwordSchema>) => {
    try {
      await changePasswordMutation.mutateAsync({
        data: {
          currentPassword: values.currentPassword,
          newPassword: values.newPassword,
        }
      });
      form.reset();
      toast.success("Password updated successfully");
    } catch (error) {
      toast.error("Failed to update password. Check your current password.");
    }
  };

  const handleDisableMfa = async () => {
    if (!confirm("Are you sure you want to disable MFA? This reduces your account security.")) return;
    
    try {
      await disableMfaMutation.mutateAsync();
      toast.success("MFA disabled. Please refresh to see changes.");
      // In a real app we'd invalidate useGetMe query here
    } catch (error) {
      toast.error("Failed to disable MFA");
    }
  };

  if (!user) return null;

  return (
    <div className="space-y-6 max-w-4xl mx-auto animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Profile Settings</h1>
        <p className="text-muted-foreground mt-2">Manage your personal account details and security preferences.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-1">
          <CardContent className="pt-6 flex flex-col items-center text-center">
            <div className="h-24 w-24 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <UserCircle className="h-12 w-12 text-primary" />
            </div>
            <h2 className="text-xl font-bold">{user.firstName} {user.lastName}</h2>
            <p className="text-muted-foreground text-sm mb-4">{user.email}</p>
            
            <Badge variant="secondary" className="mb-6">{user.roleName}</Badge>
            
            <div className="w-full space-y-3 text-sm">
              <div className="flex justify-between py-2 border-b">
                <span className="text-muted-foreground flex items-center"><Shield className="h-4 w-4 mr-2" /> Auth Provider</span>
                <span className="font-medium capitalize">{user.authProvider}</span>
              </div>
              <div className="flex justify-between py-2 border-b">
                <span className="text-muted-foreground flex items-center"><Clock className="h-4 w-4 mr-2" /> Status</span>
                {user.isActive ? (
                  <span className="text-emerald-500 font-medium">Active</span>
                ) : (
                  <span className="text-muted-foreground font-medium">Inactive</span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="md:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Two-Factor Authentication</CardTitle>
              <CardDescription>Add an extra layer of security to your account.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="space-y-1">
                  <p className="font-medium flex items-center">
                    {user.mfaEnabled ? (
                      <><Shield className="h-4 w-4 text-emerald-500 mr-2" /> MFA is Enabled</>
                    ) : (
                      <><ShieldOff className="h-4 w-4 text-muted-foreground mr-2" /> MFA is Disabled</>
                    )}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {user.mfaEnabled 
                      ? "Your account is secured with a TOTP authenticator."
                      : "We recommend enabling MFA to protect your account."}
                  </p>
                </div>
                {user.mfaEnabled ? (
                  <Button variant="outline" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={handleDisableMfa} disabled={disableMfaMutation.isPending}>
                    Disable MFA
                  </Button>
                ) : (
                  <Button onClick={() => setLocation("/mfa")}>
                    Set up MFA
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {user.authProvider === "local" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center"><KeyRound className="h-5 w-5 mr-2" /> Change Password</CardTitle>
                <CardDescription>Update your password to keep your account secure.</CardDescription>
              </CardHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmitPassword)}>
                  <CardContent className="space-y-4">
                    <FormField
                      control={form.control}
                      name="currentPassword"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Current Password</FormLabel>
                          <FormControl>
                            <Input type="password" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="newPassword"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>New Password</FormLabel>
                            <FormControl>
                              <Input type="password" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="confirmPassword"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Confirm New Password</FormLabel>
                            <FormControl>
                              <Input type="password" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </CardContent>
                  <CardFooter className="justify-end border-t pt-4">
                    <Button type="submit" disabled={changePasswordMutation.isPending}>
                      {changePasswordMutation.isPending ? "Updating..." : "Update Password"}
                    </Button>
                  </CardFooter>
                </form>
              </Form>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
