import { useAppSettings, getLogoUrl } from "@/lib/use-app-settings";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Activity, Shield, GitBranch, BookOpen, Lock, Database,
  Mail, Settings, Users, FileText, Network, Eye, Printer,
  Cpu, Link2, Megaphone, ChevronRight,
} from "lucide-react";

/* ─── Feature groups ─── */
const GROUPS = [
  {
    label: "Security & Identity",
    color: "from-red-500/10 to-orange-500/10 border-red-500/20",
    headerColor: "text-red-600",
    dotColor: "bg-red-500",
    features: [
      {
        icon: Shield,
        title: "Role-Based Access Control",
        badge: "Security",
        bullets: [
          "Fine-grained per-page permission matrices",
          "5 built-in roles with fully configurable access",
          "Admin can grant/revoke module access per role",
          "Real-time permission enforcement across all pages",
        ],
      },
      {
        icon: Lock,
        title: "MFA & SSO Authentication",
        badge: "Authentication",
        bullets: [
          "Local password login with bcrypt hashing",
          "Email OTP for passwordless access",
          "TOTP-based multi-factor authentication",
          "Microsoft 365 Single Sign-On (OAuth 2.0)",
        ],
      },
      {
        icon: Eye,
        title: "PII Data Protection",
        badge: "Privacy",
        bullets: [
          "Field-level PII encryption at rest",
          "Audit-logged reveal actions per user",
          "Role-based PII field visibility permissions",
          "Configurable sensitivity levels per field",
        ],
      },
    ],
  },
  {
    label: "Data Pipelines & Integration",
    color: "from-blue-500/10 to-indigo-500/10 border-blue-500/20",
    headerColor: "text-blue-600",
    dotColor: "bg-blue-500",
    features: [
      {
        icon: GitBranch,
        title: "Data Workflow Engine",
        badge: "Data",
        bullets: [
          "Source-to-destination pipeline configuration",
          "Scheduling: immediate, daily, weekly, monthly",
          "Field mapping and transformation rules",
          "Automated execution with job history tracking",
        ],
      },
      {
        icon: Network,
        title: "DB Connection Manager",
        badge: "Integration",
        bullets: [
          "Central registry for PostgreSQL, MySQL, MSSQL, Oracle",
          "Encrypted credential storage",
          "Connection reuse across multiple pipelines",
          "Test connection validation before save",
        ],
      },
      {
        icon: Database,
        title: "Field Mappings",
        badge: "Data",
        bullets: [
          "Global reusable transformation rule library",
          "Type casting, date formatting, renaming",
          "Custom expression support",
          "Shared across all pipeline definitions",
        ],
      },
      {
        icon: Cpu,
        title: "Python ETL Engine",
        badge: "Data",
        bullets: [
          "Streaming ETL with server-side named cursors",
          "Bulk COPY via StringIO for full-load performance",
          "Incremental upserts with ON CONFLICT DO UPDATE",
          "Per-batch watermark persistence for crash recovery",
          "Supports PostgreSQL, MySQL, MSSQL, Oracle, S3, SFTP, CSV",
        ],
      },
    ],
  },
  {
    label: "API Documentation",
    color: "from-teal-500/10 to-cyan-500/10 border-teal-500/20",
    headerColor: "text-teal-600",
    dotColor: "bg-teal-500",
    features: [
      {
        icon: BookOpen,
        title: "API Documentation Hub",
        badge: "Documentation",
        bullets: [
          "Register applications with metadata and ownership",
          "Upload or author OpenAPI 3.x specifications",
          "Attach supporting PDF/Markdown documents",
          "Role-based documentation access control",
          "Versioned spec management per application",
        ],
      },
    ],
  },
  {
    label: "Communication & Email",
    color: "from-sky-500/10 to-cyan-500/10 border-sky-500/20",
    headerColor: "text-sky-600",
    dotColor: "bg-sky-500",
    features: [
      {
        icon: Mail,
        title: "Email Configuration",
        badge: "Notifications",
        bullets: [
          "Configurable SMTP with connection pooling",
          "Powers OTP delivery and system notifications",
          "Pipeline failure and alert emails",
          "Custom sender name and address",
        ],
      },
      {
        icon: Megaphone,
        title: "Communication HUB — Bulk Email",
        badge: "Communication",
        bullets: [
          "Netcore Cloud API integration for bulk sending",
          "HTML templates with variable placeholders ({{first_name}})",
          "Version-controlled template snapshots",
          "CSV recipient upload with deduplication",
          "Schedule campaigns: immediate, future, recurring",
          "Delivery event tracking: opens, clicks, bounces, spam",
          "CID inline image and file attachment support",
        ],
      },
    ],
  },
  {
    label: "Audit, Compliance & Analytics",
    color: "from-yellow-500/10 to-amber-500/10 border-yellow-500/20",
    headerColor: "text-yellow-600",
    dotColor: "bg-yellow-500",
    features: [
      {
        icon: FileText,
        title: "Audit & Compliance",
        badge: "Compliance",
        bullets: [
          "Immutable audit log for all user actions",
          "Detailed login reports with IP and device tracking",
          "Daily login activity analytics",
          "Resource-level audit trail (URLs, pipelines, docs)",
        ],
      },
      {
        icon: Activity,
        title: "Live Dashboard",
        badge: "Analytics",
        bullets: [
          "Platform health overview at a glance",
          "User metrics, MFA adoption rates",
          "Login activity trend charts",
          "Pipeline and API documentation counts",
        ],
      },
    ],
  },
  {
    label: "Administration & Tools",
    color: "from-violet-500/10 to-purple-500/10 border-violet-500/20",
    headerColor: "text-violet-600",
    dotColor: "bg-violet-500",
    features: [
      {
        icon: Users,
        title: "User Management",
        badge: "Admin",
        bullets: [
          "Full user lifecycle: create, activate, deactivate",
          "Password reset and role assignment",
          "Last login tracking per user",
          "Bulk import and export support",
        ],
      },
      {
        icon: Settings,
        title: "Platform Customisation",
        badge: "Settings",
        bullets: [
          "Application name, logo and theme",
          "Custom font family and sizes",
          "Allowed attachment file types",
          "White-label branding for the login screen",
        ],
      },
      {
        icon: Link2,
        title: "URL Shortener & Analytics",
        badge: "Tools",
        bullets: [
          "Branded short links with custom domains",
          "Date-range expiry and activation scheduling",
          "Real-time click analytics: geo, browser, OS, device",
          "QR code generation and CSV export",
          "Public REST API with key authentication",
        ],
      },
    ],
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
  Communication: "bg-sky-500/10 text-sky-600 border-sky-500/20",
};

const STAT_ITEMS = [
  { value: "15+", label: "Modules" },
  { value: "5", label: "User Roles" },
  { value: "4", label: "DB Engines" },
  { value: "7", label: "Email Events" },
];

export default function About() {
  const { data: appCfg } = useAppSettings();
  const logoUrl = appCfg?.hasLogo ? getLogoUrl() : null;
  const currentYear = new Date().getFullYear();

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
        }
      `}</style>

      <div id="about-printable" className="space-y-10 animate-in fade-in duration-500">

        {/* ── Hero ── */}
        <div className="relative rounded-2xl overflow-hidden border bg-gradient-to-br from-primary/5 via-background to-primary/10 p-8">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-transparent to-transparent pointer-events-none" />
          <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-6">
            <div className="flex items-center gap-5">
              {logoUrl ? (
                <img src={logoUrl} alt="Logo" className="h-16 w-16 object-contain rounded-xl border shadow-md" />
              ) : (
                <div className="h-16 w-16 rounded-xl bg-primary/15 border border-primary/20 flex items-center justify-center shadow-inner">
                  <Activity className="h-8 w-8 text-primary" />
                </div>
              )}
              <div>
                <h1 className="text-3xl font-bold tracking-tight">{appCfg?.appName ?? "Ashika Platform"}</h1>
                <p className="text-muted-foreground mt-1">Enterprise Integration & Data Management Platform</p>
                <p className="text-xs text-muted-foreground/70 mt-0.5">Built for Ashika Group · Technology Team</p>
              </div>
            </div>
            <Button onClick={() => window.print()} variant="outline" className="gap-2 no-print shrink-0">
              <Printer className="h-4 w-4" />
              Download PDF
            </Button>
          </div>

          {/* Stats row */}
          <div className="relative mt-8 grid grid-cols-2 sm:grid-cols-4 gap-4">
            {STAT_ITEMS.map(s => (
              <div key={s.label} className="rounded-xl border bg-background/60 backdrop-blur-sm px-4 py-3 text-center">
                <p className="text-2xl font-bold text-primary">{s.value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Feature Groups ── */}
        {GROUPS.map((group) => (
          <div key={group.label}>
            {/* Group header */}
            <div className={`flex items-center gap-3 mb-4 pb-3 border-b`}>
              <span className={`text-lg font-bold ${group.headerColor}`}>{group.label}</span>
              <span className="text-muted-foreground text-xs">
                {group.features.length} {group.features.length === 1 ? "module" : "modules"}
              </span>
            </div>

            {/* Feature cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {group.features.map((feature) => {
                const Icon = feature.icon;
                const badgeClass = BADGE_COLORS[feature.badge] ?? "bg-muted text-muted-foreground";
                return (
                  <div
                    key={feature.title}
                    className={`rounded-xl border bg-gradient-to-br ${group.color} p-4 hover:shadow-md transition-shadow`}
                  >
                    {/* Card header */}
                    <div className="flex items-start gap-3 mb-3">
                      <div className="h-9 w-9 rounded-lg bg-background/70 border flex items-center justify-center shrink-0 shadow-sm">
                        <Icon className="h-4.5 w-4.5 text-foreground/70" style={{ height: "1.05rem", width: "1.05rem" }} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold text-sm leading-snug">{feature.title}</h3>
                        <Badge variant="outline" className={`mt-1 text-[10px] px-1.5 py-0 font-medium ${badgeClass}`}>
                          {feature.badge}
                        </Badge>
                      </div>
                    </div>

                    {/* Bullet list */}
                    <ul className="space-y-1.5">
                      {feature.bullets.map((bullet, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                          <ChevronRight className={`h-3 w-3 mt-0.5 shrink-0 ${group.headerColor}`} />
                          <span className="leading-relaxed">{bullet}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {/* ── Footer ── */}
        <div className="border-t pt-6 space-y-1 text-center text-xs text-muted-foreground">
          <p className="font-medium text-sm text-foreground/70">Designed and developed by Ashika Group — Technology Team</p>
          <p>{appCfg?.appName ?? "Ashika Platform"} · Enterprise Integration & Data Management Platform</p>
          <p>Copyright &copy; {currentYear} Ashika Stock Services Limited. All rights reserved.</p>
        </div>
      </div>
    </>
  );
}
