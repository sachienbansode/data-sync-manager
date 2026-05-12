import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ThemeProvider } from "@/lib/theme";

import NotFound from "@/pages/not-found";
import Login from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import Users from "@/pages/users";
import Roles from "@/pages/roles";
import Profile from "@/pages/profile";
import AuditLog from "@/pages/audit-log";
import MfaSetup from "@/pages/mfa-setup";
import Forbidden from "@/pages/403";
import AuthCallback from "@/pages/auth-callback";
import EmailSettings from "@/pages/admin/email-settings";
import AppSettings from "@/pages/admin/app-settings";
import PiiPermissions from "@/pages/admin/pii-permissions";
import PiiRecords from "@/pages/pii-records";
import DbConnections from "@/pages/admin/db-connections";
import FieldMappings from "@/pages/admin/field-mappings";
import Workflow from "@/pages/workflow";
import WorkflowJobs from "@/pages/workflow-jobs";
import Docs from "@/pages/docs";
import DocsViewer from "@/pages/docs-viewer";
import DocsAdmin from "@/pages/docs-admin";
import { ProtectedRoute } from "@/components/protected-route";

const queryClient = new QueryClient();

function RootRoute() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) return null;
  return isAuthenticated ? <Redirect to="/dashboard" /> : <Redirect to="/login" />;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={RootRoute} />
      <Route path="/login" component={Login} />
      <Route path="/403" component={Forbidden} />

      <Route path="/mfa-setup">
        <ProtectedRoute component={MfaSetup} path="/mfa-setup" />
      </Route>
      <Route path="/dashboard">
        <ProtectedRoute component={Dashboard} path="/dashboard" />
      </Route>
      <Route path="/users">
        <ProtectedRoute component={Users} path="/users" />
      </Route>
      <Route path="/roles">
        <ProtectedRoute component={Roles} path="/roles" />
      </Route>
      <Route path="/profile">
        <ProtectedRoute component={Profile} path="/profile" />
      </Route>
      <Route path="/audit-log">
        <ProtectedRoute component={AuditLog} path="/audit-log" />
      </Route>
      <Route path="/pii-records">
        <ProtectedRoute component={PiiRecords} path="/pii-records" />
      </Route>
      <Route path="/admin/email-settings">
        <ProtectedRoute component={EmailSettings} path="/admin/email-settings" />
      </Route>
      <Route path="/admin/app-settings">
        <ProtectedRoute component={AppSettings} path="/admin/app-settings" />
      </Route>
      <Route path="/admin/pii-permissions">
        <ProtectedRoute component={PiiPermissions} path="/admin/pii-permissions" />
      </Route>
      <Route path="/admin/db-connections">
        <ProtectedRoute component={DbConnections} path="/admin/db-connections" />
      </Route>
      <Route path="/admin/field-mappings">
        <ProtectedRoute component={FieldMappings} path="/admin/field-mappings" />
      </Route>
      <Route path="/workflow/jobs">
        <ProtectedRoute component={WorkflowJobs} path="/workflow/jobs" />
      </Route>
      <Route path="/workflow">
        <ProtectedRoute component={Workflow} path="/workflow" />
      </Route>
      <Route path="/docs">
        <ProtectedRoute component={Docs} path="/docs" />
      </Route>
      <Route path="/docs/admin">
        <ProtectedRoute component={DocsAdmin} path="/docs" requireRole="Admin" />
      </Route>
      <Route path="/docs/:appId">
        <ProtectedRoute component={DocsViewer} path="/docs" />
      </Route>

      <Route path="/auth/callback" component={AuthCallback} />

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <AuthProvider>
              <Router />
              <Toaster richColors position="top-right" />
            </AuthProvider>
          </WouterRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
