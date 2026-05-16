import { useGetDashboardSummary } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, ShieldAlert, Activity, UserX, Network, GitBranch, BookOpen, LogIn, CheckCircle2, XCircle, Clock } from "lucide-react";
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = summary as any;

  // Build chart data filling missing days for last 7 days
  type LoginActivityItem = { date: string; successes: number; failures: number };
  const activityMap = new Map<string, LoginActivityItem>();
  (s.loginActivity ?? []).forEach((d: LoginActivityItem) => activityMap.set(d.date, d));

  const chartData: LoginActivityItem[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const found = activityMap.get(key);
    chartData.push({ date: formatDate(d.toISOString()), successes: found?.successes ?? 0, failures: found?.failures ?? 0 });
  }

  // Pipeline activity — fill missing days
  type PipelineActivityItem = { date: string; completed: number; failed: number };
  const pipelineMap = new Map<string, PipelineActivityItem>();
  (s.pipelineActivity ?? []).forEach((d: PipelineActivityItem) => pipelineMap.set(d.date, d));
  const pipelineChartData: PipelineActivityItem[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const found = pipelineMap.get(key);
    pipelineChartData.push({ date: formatDate(d.toISOString()), completed: found?.completed ?? 0, failed: found?.failed ?? 0 });
  }

  // Pipeline status totals
  type PipelineJobStat = { status: string; count: number };
  const pipelineStats: PipelineJobStat[] = s.pipelineJobStats ?? [];
  const pipelineTotal = pipelineStats.reduce((a: number, b: PipelineJobStat) => a + b.count, 0);
  const pipelineSuccess = pipelineStats.find((x: PipelineJobStat) => x.status === "success")?.count ?? 0;
  const pipelineFailed = pipelineStats.find((x: PipelineJobStat) => x.status === "failed")?.count ?? 0;
  const pipelineRunning = pipelineStats.find((x: PipelineJobStat) => x.status === "running")?.count ?? 0;

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

      {/* Pipeline analytics row */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="lg:col-span-4">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <GitBranch className="h-4 w-4 text-primary" />
              Pipeline Runs (7 Days)
            </CardTitle>
            <CardDescription>Daily completed and failed pipeline job counts.</CardDescription>
          </CardHeader>
          <CardContent className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={pipelineChartData} margin={{ top: 0, right: 8, left: -20, bottom: 0 }} barSize={14}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", fontSize: 12 }}
                  itemStyle={{ color: "hsl(var(--foreground))" }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="completed" name="Completed" fill="hsl(var(--chart-2))" radius={[3, 3, 0, 0]} />
                <Bar dataKey="failed" name="Failed" fill="hsl(var(--destructive))" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Pipeline Health</CardTitle>
            <CardDescription>All-time job status breakdown.</CardDescription>
          </CardHeader>
          <CardContent>
            {pipelineTotal === 0 ? (
              <div className="h-[180px] flex flex-col items-center justify-center text-muted-foreground text-sm gap-2">
                <GitBranch className="h-8 w-8 opacity-20" />
                No pipeline jobs yet
              </div>
            ) : (
              <div className="space-y-3 pt-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Total Runs</span>
                  <span className="text-2xl font-bold">{pipelineTotal}</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                  <div className="flex-1 bg-muted rounded-full h-2">
                    <div
                      className="bg-green-500 h-2 rounded-full transition-all"
                      style={{ width: `${pipelineTotal > 0 ? (pipelineSuccess / pipelineTotal) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="text-sm font-medium w-8 text-right">{pipelineSuccess}</span>
                  <span className="text-xs text-muted-foreground">Success</span>
                </div>
                <div className="flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-destructive shrink-0" />
                  <div className="flex-1 bg-muted rounded-full h-2">
                    <div
                      className="bg-destructive h-2 rounded-full transition-all"
                      style={{ width: `${pipelineTotal > 0 ? (pipelineFailed / pipelineTotal) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="text-sm font-medium w-8 text-right">{pipelineFailed}</span>
                  <span className="text-xs text-muted-foreground">Failed</span>
                </div>
                {pipelineRunning > 0 && (
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-yellow-500 shrink-0" />
                    <div className="flex-1 bg-muted rounded-full h-2">
                      <div
                        className="bg-yellow-500 h-2 rounded-full transition-all"
                        style={{ width: `${(pipelineRunning / pipelineTotal) * 100}%` }}
                      />
                    </div>
                    <span className="text-sm font-medium w-8 text-right">{pipelineRunning}</span>
                    <span className="text-xs text-muted-foreground">Running</span>
                  </div>
                )}
                <p className="text-xs text-muted-foreground pt-1">
                  Success rate: <span className="font-semibold text-foreground">{pipelineTotal > 0 ? Math.round((pipelineSuccess / pipelineTotal) * 100) : 0}%</span>
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Login analytics + users by role row */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="lg:col-span-4">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <LogIn className="h-4 w-4 text-primary" />
              Login Activity (7 Days)
            </CardTitle>
            <CardDescription>Daily successful and failed login attempts.</CardDescription>
          </CardHeader>
          <CardContent className="h-[200px]">
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
        <Card className="lg:col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Users by Role</CardTitle>
            <CardDescription>Distribution of roles across the platform.</CardDescription>
          </CardHeader>
          <CardContent className="h-[200px]">
            {pieData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={68} paddingAngle={5} dataKey="value">
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
      {((s.recentLogins ?? []) as unknown[]).length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 font-medium">
              <LogIn className="h-4 w-4" />
              Recent Logins
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {(s.recentLogins as Array<{ id: number; userEmail: string; action: string; ipAddress: string; createdAt: string }>).map((log) => {
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
