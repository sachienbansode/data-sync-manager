import { useAppSettings, getLogoUrl } from "@/lib/use-app-settings";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Activity, Shield, GitBranch, BookOpen, Lock, Database,
  Mail, Settings, Users, FileText, Network, Eye, Printer, Cpu, Link2,
} from "lucide-react";

const FEATURES = [
  {
    icon: Shield,
    title: "Role-Based Access Control",
    description: "Fine-grained RBAC with per-page permission matrices. Define roles and control exactly which modules each user can access.",
    badge: "Security",
  },
  {
    icon: Lock,
    title: "MFA & SSO Authentication",
    description: "Local password authentication, Email OTP, TOTP multi-factor authentication, and Microsoft 365 Single Sign-On.",
    badge: "Authentication",
  },
  {
    icon: GitBranch,
    title: "Data Workflow Engine",
    description: "Configure source-to-destination data pipelines with scheduling, field mappings, and automated execution via Python/pandas.",
    badge: "Data",
  },
  {
    icon: Network,
    title: "DB Connection Manager",
    description: "Centralised connection registry for PostgreSQL, MySQL, MSSQL, and Oracle databases. Reuse connections across pipelines.",
    badge: "Integration",
  },
  {
    icon: BookOpen,
    title: "API Documentation Hub",
    description: "Register applications, upload or write OpenAPI 3.x specs, attach supporting documents, and control documentation access by role.",
    badge: "Documentation",
  },
  {
    icon: Eye,
    title: "PII Data Protection",
    description: "Field-level PII encryption with audit-logged reveal actions. Role-based PII field access permissions.",
    badge: "Privacy",
  },
  {
    icon: FileText,
    title: "Audit & Compliance",
    description: "Immutable audit log for all user actions. Detailed login reports with daily activity analytics and IP tracking.",
    badge: "Compliance",
  },
  {
    icon: Database,
    title: "Field Mappings",
    description: "Global reusable field transformation rules including type casting, date formatting, renaming, and custom expressions.",
    badge: "Data",
  },
  {
    icon: Mail,
    title: "Email Configuration",
    description: "Configurable SMTP integration with connection pooling for OTP delivery, pipeline failure alerts, and system notifications.",
    badge: "Notifications",
  },
  {
    icon: Users,
    title: "User Management",
    description: "Full user lifecycle management: create, activate, deactivate, reset passwords, assign roles, and track last login.",
    badge: "Admin",
  },
  {
    icon: Settings,
    title: "Platform Customisation",
    description: "Set application name, logo, theme, font family, and font sizes. Manage allowed attachment file types platform-wide.",
    badge: "Settings",
  },
  {
    icon: Activity,
    title: "Live Dashboard",
    description: "Platform health overview with user metrics, MFA adoption, login activity charts, pipeline and API documentation counts.",
    badge: "Analytics",
  },
  {
    icon: Link2,
    title: "URL Shortener & Analytics",
    description: "Create branded short links with custom domains, expiry date ranges, and real-time analytics: click counts, geo-location, browser, OS, and device tracking.",
    badge: "Tools",
  },
  {
    icon: Cpu,
    title: "Python ETL Engine",
    description: "High-performance streaming ETL worker using server-side named cursors (PostgreSQL), bulk COPY via StringIO for full-load, and execute_values with ON CONFLICT DO UPDATE for incremental upserts. Per-batch watermark persistence ensures crash durability. Supports PostgreSQL, MySQL, MSSQL, Oracle, S3, SFTP, and CSV sources and destinations, with pre/post SQL command hooks and field-level transformation rules.",
    badge: "Data",
  },
];

const BADGE_COLORS: Record<string, string> = {
  Security: "bg-red-500/10 text-red-600 border-red-500/20",
  Authentication: "bg-orange-500/10 text-orange-600 border-orange-500/20",
  Data: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  Integration: "bg-purple-500/10 text-purple-600 border-purple-500/20",
  Documentation: "bg-teal-500/10 text-teal-600 border-teal-500/20",
  Privacy: "bg-pink-500/10 text-pink-600 border-pink-500/20",
  Compliance: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",
  Admin: "bg-indigo-500/10 text-indigo-600 border-indigo-500/20",
  Notifications: "bg-cyan-500/10 text-cyan-600 border-cyan-500/20",
  Settings: "bg-green-500/10 text-green-600 border-green-500/20",
  Analytics: "bg-violet-500/10 text-violet-600 border-violet-500/20",
  Tools: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
};

export default function About() {
  const { data: appCfg } = useAppSettings();
  const logoUrl = appCfg?.hasLogo ? getLogoUrl() : null;
  const currentYear = new Date().getFullYear();

  const handlePrint = () => window.print();

  return (
    <>
      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 0; }
          * { overflow: visible !important; max-height: none !important; }
          body * { visibility: hidden; }
          #about-printable, #about-printable * { visibility: visible; }
          #about-printable {
            position: absolute; top: 0; left: 0; width: 100%;
            padding: 12mm 16mm 16mm; box-sizing: border-box;
            background: white; color: black;
          }
          .no-print { display: none !important; }
          #about-printable .print-card { border: 1px solid #d1d5db !important; background: white !important; break-inside: avoid; }
          #about-printable h1 { font-size: 22pt; }
          #about-printable h2 { font-size: 14pt; }
          #about-printable p  { font-size: 9pt; }
          #about-printable .feature-grid { display: grid !important; grid-template-columns: repeat(4, 1fr) !important; gap: 6pt !important; }
        }
      `}</style>
      <div id="about-printable" className="space-y-10 animate-in fade-in duration-500">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            {logoUrl ? (
              <img src={logoUrl} alt="Logo" className="h-16 w-16 object-contain rounded-xl border shadow-sm" />
            ) : (
              <div className="h-16 w-16 rounded-xl bg-primary/10 flex items-center justify-center">
                <Activity className="h-8 w-8 text-primary" />
              </div>
            )}
            <div>
              <h1 className="text-4xl font-bold tracking-tight">{appCfg?.appName ?? "Ashika Platform"}</h1>
              <p className="text-muted-foreground mt-1 text-lg">Enterprise Integration & Data Management Platform</p>
            </div>
          </div>
          <Button onClick={handlePrint} variant="outline" className="gap-2 no-print shrink-0">
            <Printer className="h-4 w-4" />
            Download PDF
          </Button>
        </div>

        {/* Mission statement */}
        <Card className="print-card bg-gradient-to-br from-primary/5 to-primary/10 border-primary/20">
          <CardContent className="pt-6">
            <p className="text-base leading-relaxed text-foreground/80 max-w-4xl">
              <strong>{appCfg?.appName ?? "Ashika Platform"}</strong> is a comprehensive enterprise platform built for
              Ashika Group, delivering secure data integration, API documentation management, and robust access
              control in a single unified interface. Designed for scalability, auditability, and ease of
              administration.
            </p>
          </CardContent>
        </Card>

        {/* Features */}
        <div>
          <h2 className="text-2xl font-bold tracking-tight mb-2">Key Features</h2>
          <p className="text-muted-foreground mb-6 no-print">A complete suite of enterprise-grade capabilities.</p>
          <div className="feature-grid grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map((feature) => {
              const Icon = feature.icon;
              const badgeClass = BADGE_COLORS[feature.badge] ?? "bg-muted text-muted-foreground";
              return (
                <Card key={feature.title} className="print-card hover:shadow-md transition-shadow">
                  <CardContent className="pt-5">
                    <div className="flex items-start gap-3 mb-3">
                      <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <Icon className="h-5 w-5 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-semibold text-sm leading-tight">{feature.title}</h3>
                        <Badge variant="outline" className={`mt-1 text-[10px] px-1.5 py-0 font-medium ${badgeClass}`}>
                          {feature.badge}
                        </Badge>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{feature.description}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t pt-6 space-y-1 text-center text-xs text-muted-foreground">
          <p className="font-medium text-sm text-foreground/70">Designed and developed by Ashika Group — Technology Team</p>
          <p>{appCfg?.appName ?? "Ashika Platform"} · Enterprise Integration & Data Management Platform</p>
          <p>Copyright &copy; {currentYear} Ashika Stock Services Limited. All rights reserved.</p>
        </div>
      </div>
    </>
  );
}
