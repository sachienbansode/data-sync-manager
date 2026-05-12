import { useState, ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import {
  LayoutDashboard, Users, ShieldAlert, FileText, LogOut, UserCircle, Menu,
  Activity, Mail, Settings, ChevronDown, ChevronRight, Lock, Database,
  GitBranch, Shuffle, BookOpen, Settings2, Shield, Eye, ServerCog, Network,
  Type, FileType, LogIn, Info, Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAppSettings, getLogoUrl } from "@/lib/use-app-settings";

interface LayoutProps { children: ReactNode; }
interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
}
interface NavGroup {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  items: NavItem[];
}

const topNavItems: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/workflow", label: "Data Workflow", icon: GitBranch },
  { href: "/about", label: "About", icon: Info },
];

const apiDocGroup: NavGroup = {
  label: "API Documentation",
  icon: BookOpen,
  items: [
    { href: "/docs", label: "Browse", icon: BookOpen },
    { href: "/docs/admin", label: "API Docs", icon: Settings2, adminOnly: true },
  ],
};

const adminGroups: NavGroup[] = [
  {
    label: "RBAC",
    icon: Shield,
    items: [
      { href: "/users", label: "Users", icon: Users },
      { href: "/roles", label: "Roles & Permissions", icon: ShieldAlert },
    ],
  },
  {
    label: "Security & Audit",
    icon: Eye,
    items: [
      { href: "/audit-log", label: "Audit Log", icon: FileText },
      { href: "/admin/login-report", label: "Login Report", icon: LogIn },
      { href: "/pii-records", label: "PII Records", icon: Lock },
      { href: "/admin/pii-permissions", label: "PII Permissions", icon: Database },
    ],
  },
  {
    label: "Settings",
    icon: Settings,
    items: [
      { href: "/admin/app-settings", label: "App Settings", icon: Settings },
      { href: "/admin/font-settings", label: "Font Settings", icon: Type },
      { href: "/admin/email-settings", label: "Email Settings", icon: Mail },
      { href: "/admin/allowed-file-types", label: "Allowed File Types", icon: FileType },
      { href: "/admin/application-types", label: "Application Types", icon: Layers },
    ],
  },
  {
    label: "Data Management",
    icon: ServerCog,
    items: [
      { href: "/admin/db-connections", label: "Connections", icon: Network },
      { href: "/admin/field-mappings", label: "Field Mappings", icon: Shuffle },
    ],
  },
];

function NavLink({ href, label, Icon, isActive, onNav, indent = false }: {
  href: string; label: string; Icon: React.ComponentType<{ className?: string }>;
  isActive: boolean; onNav?: () => void; indent?: boolean;
}) {
  return (
    <Link href={href} className="block" onClick={onNav}>
      <div className={`flex items-center py-2 text-sm font-medium rounded-md transition-colors ${indent ? "px-3 pl-7" : "px-3"} ${
        isActive ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
      }`}>
        <Icon className={`h-4 w-4 mr-3 shrink-0 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
        {label}
      </div>
    </Link>
  );
}

function CollapsibleGroup({ group, location, onNav, isAdmin, checkPermission, indent = true }: {
  group: NavGroup; location: string; onNav?: () => void;
  isAdmin: boolean; checkPermission: (href: string) => boolean; indent?: boolean;
}) {
  const visibleItems = group.items.filter(item => {
    if (item.adminOnly) return isAdmin;
    return checkPermission(item.href);
  });
  if (visibleItems.length === 0) return null;

  const isAnyActive = visibleItems.some(item => location === item.href || location.startsWith(`${item.href}/`));
  const [expanded, setExpanded] = useState(isAnyActive);
  const GroupIcon = group.icon;

  return (
    <div>
      <button
        onClick={() => setExpanded(p => !p)}
        className={`w-full flex items-center justify-between px-3 py-2 text-sm font-medium rounded-md transition-colors ${
          isAnyActive && !expanded ? "text-sidebar-foreground bg-sidebar-accent/30" : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/20"
        }`}
      >
        <span className="flex items-center gap-3">
          <GroupIcon className="h-4 w-4 text-muted-foreground shrink-0" />
          {group.label}
        </span>
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      </button>
      {expanded && (
        <div className="mt-0.5 space-y-0.5">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.href || location.startsWith(`${item.href}/`);
            return (
              <NavLink
                key={item.href}
                href={item.href}
                label={item.label}
                Icon={Icon}
                isActive={isActive}
                onNav={onNav}
                indent={indent}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function SidebarContent({ onNav }: { onNav?: () => void }) {
  const { user, logout, checkPermission } = useAuth();
  const [location] = useLocation();
  const isAdmin = user?.roleName === "Admin";

  const anyAdminActive = adminGroups.some(g =>
    g.items.some(item => location === item.href || location.startsWith(`${item.href}/`))
  );
  const [adminExpanded, setAdminExpanded] = useState(anyAdminActive);

  const { data: appCfg } = useAppSettings();
  const logoUrl = appCfg?.hasLogo ? getLogoUrl() : null;

  const filteredTop = topNavItems.filter(item => {
    if (item.href === "/about") return true;
    return checkPermission(item.href);
  });

  return (
    <div className="flex flex-col h-full bg-sidebar">
      <div className="h-14 flex items-center px-6 border-b border-border shrink-0">
        {logoUrl ? (
          <img src={logoUrl} alt="Logo" className="h-7 w-7 object-contain mr-2 rounded" />
        ) : (
          <Activity className="h-5 w-5 text-primary mr-2" />
        )}
        <span className="font-semibold text-sidebar-foreground tracking-tight text-sm">
          {appCfg?.appName ?? "Ashika Platform"}
        </span>
      </div>

      <ScrollArea className="flex-1 py-3">
        <nav className="px-3 space-y-0.5">
          {filteredTop.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.href || location.startsWith(`${item.href}/`);
            return (
              <NavLink key={item.href} href={item.href} label={item.label} Icon={Icon} isActive={isActive} onNav={onNav} />
            );
          })}

          {/* API Documentation group — visible to anyone with /docs access or admin */}
          <CollapsibleGroup
            group={apiDocGroup}
            location={location}
            onNav={onNav}
            isAdmin={isAdmin}
            checkPermission={checkPermission}
            indent={false}
          />

          <div className="pt-2">
            <button
              onClick={() => setAdminExpanded(p => !p)}
              className="w-full flex items-center justify-between px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
            >
              <span>Administration</span>
              {adminExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </button>

            {adminExpanded && (
              <div className="mt-1 space-y-0.5">
                {adminGroups.map((group) => (
                  <CollapsibleGroup
                    key={group.label}
                    group={group}
                    location={location}
                    onNav={onNav}
                    isAdmin={isAdmin}
                    checkPermission={checkPermission}
                  />
                ))}
              </div>
            )}
          </div>
        </nav>
      </ScrollArea>

      <div className="p-4 mt-auto border-t border-border shrink-0">
        <div className="flex items-center mb-3 px-2">
          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm mr-3 shrink-0">
            {(user?.firstName?.[0] ?? user?.email?.[0] ?? "?").toUpperCase()}
          </div>
          <div className="overflow-hidden">
            <p className="text-sm font-medium text-sidebar-foreground truncate">{user?.firstName} {user?.lastName}</p>
            <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
            <p className="text-xs text-muted-foreground/70 truncate">{user?.roleName}</p>
          </div>
        </div>
        <div className="space-y-0.5">
          <Link href="/profile" className="block" onClick={onNav}>
            <div className="flex items-center px-3 py-2 text-sm font-medium rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent/50 transition-colors">
              <UserCircle className="h-4 w-4 mr-3 text-muted-foreground" />
              Profile
            </div>
          </Link>
          <div className="flex items-center justify-between px-3 py-1">
            <span className="text-sm font-medium text-sidebar-foreground/70">Theme</span>
            <ThemeToggle />
          </div>
          <button
            onClick={() => { logout(); onNav?.(); }}
            className="w-full flex items-center px-3 py-2 text-sm font-medium rounded-md text-destructive/80 hover:bg-destructive/10 hover:text-destructive transition-colors text-left"
          >
            <LogOut className="h-4 w-4 mr-3" />
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

export function Layout({ children }: LayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { data: appCfg } = useAppSettings();
  const logoUrl = appCfg?.hasLogo ? getLogoUrl() : null;

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      <aside className="hidden lg:flex w-64 flex-col border-r border-border shrink-0">
        <SidebarContent />
      </aside>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="p-0 w-64">
          <SidebarContent onNav={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-background">
        <header className="h-14 flex items-center justify-between px-4 border-b border-border bg-card shrink-0 lg:hidden">
          <div className="flex items-center">
            {logoUrl ? (
              <img src={logoUrl} alt="Logo" className="h-7 w-7 object-contain mr-2 rounded" />
            ) : (
              <Activity className="h-5 w-5 text-primary mr-2" />
            )}
            <span className="font-semibold tracking-tight">{appCfg?.appName ?? "Ashika"}</span>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <Button variant="ghost" size="icon" aria-label="Open navigation" onClick={() => setMobileOpen(true)}>
              <Menu className="h-5 w-5" />
            </Button>
          </div>
        </header>
        <ScrollArea className="flex-1">
          <div className="p-6 md:p-8 max-w-7xl mx-auto">
            {children}
          </div>
        </ScrollArea>
      </main>
    </div>
  );
}
