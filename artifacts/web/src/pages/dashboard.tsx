import { useGetDashboardSummary } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, ShieldAlert, Activity, UserX, Network, GitBranch, BookOpen, LogIn } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";
import { formatDateTime, formatDate } from "@/lib/date";

const COLORS = ['hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))'];

const ACTION_META: Record<string, { label: string; variant: "default" | "destructive" | "secondary" | "outline" }> = {
  LOGIN_SUCCESS:   { label: "Success",  variant: "default" },
  LOGIN_FAILED:    { label: "Failed",   variant: "destructive" },
  M365_LOGIN:      { label: "M365 SSO", variant: "secondary" },
  EMAIL_OTP_LOGIN: { label: "OTP",      variant: "secondary" },
};

export default function Dashboard() {
  const { data: summary, isLoading } = useGetDashboardSummary();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div><h1 className="text-3xl font-bold tracking-tight">Dashboard</h1></div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1,2,3,4,5,6,7].map(i => (
            <Card key={i}><CardHeader className="pb-2"><Skeleton className="h-4 w-24" /></CardHeader><CardContent><Skeleton className="h-8 w-16" /></CardContent></Card>
          ))}
        </div>
      </div>
    );
  }

  if (!summary) return null;

  const pieData = summary.usersByRole.map(r => ({ name: r.roleName, value: r.count }));

  // Build chart data filling missing days for last 7 days
  type LoginActivityItem = { date: string; successes: number; failures: number };
  const activityMap = new Map<string, LoginActivityItem>();
  (summary.loginActivity ?? []).forEach(d => activityMap.set(d.date, d));

  const chartData: LoginActivityItem[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const found = activityMap.get(key);
    chartData.push({ date: formatDate(d.toISOString()), successes: found?.successes ?? 0, failures: found?.failures ?? 0 });
  }

  const statCards = [
    { label: "Total Users", value: summary.totalUsers, icon: Users, sub: null },
    { label: "Active Users", value: summary.activeUsers, icon: Activity, sub: null },
    { label: "Inactive Users", value: summary.inactiveUsers, icon: UserX, sub: null },
    {
      label: "MFA Adoption",
      value: `${summary.totalUsers > 0 ? Math.round((summary.mfaEnabledUsers / summary.totalUsers) * 100) : 0}%`,
      icon: ShieldAlert,
      sub: `${summary.mfaEnabledUsers} users secured`,
    },
    { label: "DB Connections", value: summary.totalConnections ?? 0, icon: Network, sub: null as string | null },
    { label: "Pipelines", value: summary.totalPipelines ?? 0, icon: GitBranch, sub: null as string | null },
    { label: "API Applications", value: summary.totalApiApps ?? 0, icon: BookOpen, sub: null as string | null },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-2">Platform overview and analytics.</p>
      </div>

      {/* Stats grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {statCards.map(({ label, value, icon: Icon, sub }) => (
          <Card key={label} className="xl:col-span-1">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{label}</CardTitle>
              <Icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{value}</div>
              {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        {/* Login activity bar chart */}
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LogIn className="h-4 w-4 text-primary" />
              Login Activity (7 Days)
            </CardTitle>
            <CardDescription>Daily successful and failed login attempts.</CardDescription>
          </CardHeader>
          <CardContent className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 0, right: 8, left: -20, bottom: 0 }} barSize={14}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", fontSize: 12 }}
                  itemStyle={{ color: "hsl(var(--foreground))" }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="successes" name="Successes" fill="hsl(var(--chart-2))" radius={[3, 3, 0, 0]} />
                <Bar dataKey="failures" name="Failures" fill="hsl(var(--destructive))" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Users by role */}
        <Card className="col-span-3">
          <CardHeader>
            <CardTitle>Users by Role</CardTitle>
            <CardDescription>Distribution of roles across the platform.</CardDescription>
          </CardHeader>
          <CardContent className="h-[260px]">
            {pieData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={75} paddingAngle={5} dataKey="value">
                    {pieData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))" }} itemStyle={{ color: "hsl(var(--foreground))" }} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm">No data available</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent logins compact */}
      {(summary.recentLogins as unknown[]).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <LogIn className="h-4 w-4" />
              Recent Logins
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {(summary.recentLogins as Array<{ id: number; userEmail: string; action: string; ipAddress: string; createdAt: string }>).map((log) => {
                const meta = ACTION_META[log.action] ?? { label: log.action, variant: "outline" as const };
                return (
                  <div key={log.id} className="flex items-center justify-between text-sm gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <Badge variant={meta.variant} className="text-[10px] px-1.5 shrink-0">{meta.label}</Badge>
                      <span className="font-mono text-xs text-muted-foreground truncate">{log.userEmail}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
                      <span className="hidden sm:inline">{log.ipAddress}</span>
                      <span>{formatDateTime(log.createdAt)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
