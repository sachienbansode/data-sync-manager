import { useState, ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { 
  LayoutDashboard, 
  Users, 
  ShieldAlert, 
  FileText, 
  LogOut, 
  UserCircle,
  Menu,
  Activity,
  X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent } from "@/components/ui/sheet";

interface LayoutProps {
  children: ReactNode;
}

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/users", label: "Users", icon: Users },
  { href: "/roles", label: "Roles & Permissions", icon: ShieldAlert },
  { href: "/audit-log", label: "Audit Log", icon: FileText },
];

function SidebarContent({ onNav }: { onNav?: () => void }) {
  const { user, logout, checkPermission } = useAuth();
  const [location] = useLocation();

  const filteredNavItems = navItems.filter(item => checkPermission(item.href));

  return (
    <div className="flex flex-col h-full bg-sidebar">
      <div className="h-14 flex items-center px-6 border-b border-border shrink-0">
        <Activity className="h-5 w-5 text-primary mr-2" />
        <span className="font-semibold text-sidebar-foreground tracking-tight">Ashika Platform</span>
      </div>

      <ScrollArea className="flex-1 py-4">
        <nav className="space-y-1 px-3">
          {filteredNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.href || location.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className="block"
                onClick={onNav}
              >
                <div
                  className={`flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                  }`}
                >
                  <Icon className={`h-4 w-4 mr-3 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                  {item.label}
                </div>
              </Link>
            );
          })}
        </nav>
      </ScrollArea>

      <div className="p-4 mt-auto border-t border-border shrink-0">
        <div className="flex items-center mb-4 px-2">
          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm mr-3">
            {user?.firstName?.[0]}{user?.lastName?.[0]}
          </div>
          <div className="overflow-hidden">
            <p className="text-sm font-medium text-sidebar-foreground truncate">{user?.firstName} {user?.lastName}</p>
            <p className="text-xs text-muted-foreground truncate">{user?.roleName}</p>
          </div>
        </div>

        <div className="space-y-1">
          <Link href="/profile" className="block" onClick={onNav}>
            <div className="flex items-center px-3 py-2 text-sm font-medium rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent/50 transition-colors">
              <UserCircle className="h-4 w-4 mr-3 text-muted-foreground" />
              Profile
            </div>
          </Link>
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

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      {/* Desktop sidebar — hidden on mobile */}
      <aside className="hidden lg:flex w-64 flex-col border-r border-border shrink-0">
        <SidebarContent />
      </aside>

      {/* Mobile drawer */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="p-0 w-64">
          <SidebarContent onNav={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-background">
        {/* Mobile top bar */}
        <header className="h-14 flex items-center justify-between px-4 border-b border-border bg-card shrink-0 lg:hidden">
          <div className="flex items-center">
            <Activity className="h-5 w-5 text-primary mr-2" />
            <span className="font-semibold tracking-tight">Ashika</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open navigation"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
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
