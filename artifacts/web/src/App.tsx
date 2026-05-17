import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ThemeProvider } from "@/lib/theme";
import { useFontSettings } from "@/lib/use-app-settings";

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
import DbConnections from "@/pages/admin/db-connections";
import DataObjects from "@/pages/admin/data-objects";
import FieldMappings from "@/pages/admin/field-mappings";
import FontSettings from "@/pages/admin/font-settings";
import AllowedFileTypes from "@/pages/admin/allowed-file-types";
import LoginReport from "@/pages/admin/login-report";
import ApplicationTypes from "@/pages/admin/application-types";
import EmailTemplates from "@/pages/admin/email-templates";
import Workflow from "@/pages/workflow";
import WorkflowJobs from "@/pages/workflow-jobs";
import PipelineMappings from "@/pages/pipeline-mappings";
import Docs from "@/pages/docs";
import DocsViewer from "@/pages/docs-viewer";
import DocsAdmin from "@/pages/docs-admin";
import About from "@/pages/about";
import UrlShortener from "@/pages/url-shortener";
import DataPreview from "@/pages/data-preview";
import ShortDomains from "@/pages/admin/short-domains";
import Campaigns from "@/pages/email-hub/campaigns";
import CampaignDetail from "@/pages/email-hub/campaign-detail";
import EmailHubTemplates from "@/pages/email-hub/templates";
import CommSettings from "@/pages/admin/comm-settings";
import { ProtectedRoute } from "@/components/protected-route";
import { FaviconSync } from "@/components/favicon-sync";
import { SessionTimeoutProvider } from "@/components/session-timeout";

const queryClient = new QueryClient();

function RootRoute() {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return null;
  return isAuthenticated ? <Redirect to="/dashboard" /> : <Redirect to="/login" />;
}

/** Applies font settings from DB as CSS variables on <html> */
function FontApplicator() {
  useFontSettings();
  return null;
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
        <ProtectedRoute component={Profile} path="/profile" skipPermissionCheck />
      </Route>
      <Route path="/audit-log">
        <ProtectedRoute component={AuditLog} path="/audit-log" />
      </Route>
      <Route path="/pii-records">
        <Redirect to="/admin/pii-permissions" />
      </Route>
      <Route path="/admin/data-objects">
        <ProtectedRoute component={DataObjects} path="/admin/data-objects" requireRole="Admin" />
      </Route>
      <Route path="/about">
        <ProtectedRoute component={About} path="/about" skipPermissionCheck />
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
      <Route path="/admin/font-settings">
        <ProtectedRoute component={FontSettings} path="/admin/font-settings" requireRole="Admin" />
      </Route>
      <Route path="/admin/allowed-file-types">
        <ProtectedRoute component={AllowedFileTypes} path="/admin/allowed-file-types" requireRole="Admin" />
      </Route>
      <Route path="/admin/login-report">
        <ProtectedRoute component={LoginReport} path="/admin/login-report" requireRole="Admin" />
      </Route>
      <Route path="/admin/application-types">
        <ProtectedRoute component={ApplicationTypes} path="/admin/application-types" requireRole="Admin" />
      </Route>
      <Route path="/admin/email-templates">
        <ProtectedRoute component={EmailTemplates} path="/admin/email-templates" requireRole="Admin" />
      </Route>
      <Route path="/workflow/jobs">
        <ProtectedRoute component={WorkflowJobs} path="/workflow/jobs" />
      </Route>
      <Route path="/workflow/:id/mappings">
        <ProtectedRoute component={PipelineMappings} path="/workflow" />
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

      <Route path="/url-shortener">
        <ProtectedRoute component={UrlShortener} path="/url-shortener" />
      </Route>
      <Route path="/admin/short-domains">
        <ProtectedRoute component={ShortDomains} path="/admin/short-domains" requireRole="Admin" />
      </Route>

      <Route path="/email-hub/campaigns/:id">
        <ProtectedRoute component={CampaignDetail} path="/email-hub/campaigns" />
      </Route>
      <Route path="/email-hub/campaigns">
        <ProtectedRoute component={Campaigns} path="/email-hub/campaigns" />
      </Route>
      <Route path="/email-hub/templates">
        <ProtectedRoute component={EmailHubTemplates} path="/email-hub/templates" />
      </Route>
      <Route path="/admin/comm-settings">
        <ProtectedRoute component={CommSettings} path="/admin/comm-settings" requireRole="Admin" />
      </Route>

      <Route path="/data-preview">
        <ProtectedRoute component={DataPreview} path="/data-preview" requireRole="Admin" />
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
              <SessionTimeoutProvider>
                <FaviconSync />
                <FontApplicator />
                <Router />
                <Toaster richColors position="top-right" />
              </SessionTimeoutProvider>
            </AuthProvider>
          </WouterRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
