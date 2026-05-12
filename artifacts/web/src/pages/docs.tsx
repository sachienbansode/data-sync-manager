import { useState, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { useListDocApps } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BookOpen, Search, ExternalLink, FileCode, Calendar, Tag, X,
  Plus, Settings2, Layers, ArrowRight, AlertCircle,
} from "lucide-react";

export default function Docs() {
  const { user } = useAuth();
  const isAdmin = user?.roleName === "Admin";
  const [, setLocation] = useLocation();
  const { data: apps, isLoading } = useListDocApps();
  const [search, setSearch] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    (apps ?? []).forEach((app) => (app.tags ?? []).forEach((t) => tagSet.add(t)));
    return Array.from(tagSet).sort();
  }, [apps]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return (apps ?? []).filter((app) => {
      const matchesSearch =
        !q ||
        app.name.toLowerCase().includes(q) ||
        app.description?.toLowerCase().includes(q) ||
        (app.tags ?? []).some((t) => t.toLowerCase().includes(q));
      const matchesTag = !selectedTag || (app.tags ?? []).includes(selectedTag);
      return matchesSearch && matchesTag;
    });
  }, [apps, search, selectedTag]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <Skeleton className="h-8 w-64 mb-2" />
            <Skeleton className="h-4 w-96" />
          </div>
        </div>
        <Skeleton className="h-10 w-full max-w-sm" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-40 mb-2" />
                <Skeleton className="h-4 w-64" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const hasApps = (apps ?? []).length > 0;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">API Documentation</h1>
          <p className="text-muted-foreground mt-1">
            Browse and explore interactive API documentation for all registered services.
          </p>
        </div>
        {isAdmin && (
          <div className="flex gap-2 shrink-0">
            <Button variant="outline" size="sm" className="gap-2" onClick={() => setLocation("/docs/admin")}>
              <Settings2 className="h-4 w-4" />
              Manage
            </Button>
          </div>
        )}
      </div>

      {/* Stats bar */}
      {hasApps && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            label="Applications"
            value={(apps ?? []).length}
            icon={<Layers className="h-4 w-4 text-primary" />}
          />
          <StatCard
            label="With Specs"
            value={(apps ?? []).filter((a) => a.latestVersion != null).length}
            icon={<FileCode className="h-4 w-4 text-emerald-500" />}
          />
          <StatCard
            label="Tags"
            value={allTags.length}
            icon={<Tag className="h-4 w-4 text-violet-500" />}
          />
          <StatCard
            label="Pending Spec"
            value={(apps ?? []).filter((a) => a.latestVersion == null).length}
            icon={<AlertCircle className="h-4 w-4 text-amber-500" />}
          />
        </div>
      )}

      {/* Search + tag filter */}
      {hasApps && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search applications…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            {(search || selectedTag) && (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1"
                onClick={() => { setSearch(""); setSelectedTag(null); }}
              >
                <X className="h-3 w-3" />
                Clear
              </Button>
            )}
            <span className="text-sm text-muted-foreground shrink-0">
              {filtered.length} of {(apps ?? []).length}
            </span>
          </div>

          {allTags.length > 0 && (
            <div className="flex flex-wrap gap-2 items-center">
              <Tag className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              {allTags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors border ${
                    selectedTag === tag
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted text-muted-foreground border-border hover:bg-muted/80 hover:text-foreground"
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!hasApps ? (
        <div className="border rounded-xl bg-muted/20 p-12 text-center space-y-4">
          <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <BookOpen className="h-8 w-8 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-semibold">No API documentation yet</h2>
            <p className="text-muted-foreground mt-1 max-w-sm mx-auto">
              Register an API service and upload its OpenAPI spec to get started.
            </p>
          </div>
          {isAdmin && (
            <Button className="gap-2" onClick={() => setLocation("/docs/admin")}>
              <Plus className="h-4 w-4" />
              Register First Application
            </Button>
          )}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 border rounded-lg bg-muted/20">
          <Search className="h-12 w-12 text-muted-foreground/40 mx-auto mb-4" />
          <p className="text-muted-foreground font-medium">No applications match your filters.</p>
          <Button variant="ghost" className="mt-2" onClick={() => { setSearch(""); setSelectedTag(null); }}>
            Clear filters
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((app) => (
            <Card key={app.id} className="flex flex-col hover:shadow-md transition-shadow group">
              <CardHeader className="flex-1 pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                      <FileCode className="h-4 w-4 text-primary" />
                    </div>
                    <CardTitle className="text-base truncate">{app.name}</CardTitle>
                  </div>
                  {app.latestVersion != null ? (
                    <Badge variant="secondary" className="shrink-0 text-xs">v{app.latestVersion}</Badge>
                  ) : (
                    <Badge variant="outline" className="shrink-0 text-xs text-amber-600 border-amber-300">
                      No spec
                    </Badge>
                  )}
                </div>
                {app.description && (
                  <CardDescription className="mt-2 line-clamp-2 ml-10">{app.description}</CardDescription>
                )}
                {(app.tags ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2 ml-10">
                    {(app.tags ?? []).map((tag) => (
                      <button
                        key={tag}
                        onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium transition-colors border ${
                          selectedTag === tag
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-muted/60 text-muted-foreground border-border hover:bg-primary/10 hover:text-primary"
                        }`}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                )}
                {app.latestSpecDate && (
                  <div className="flex items-center gap-1 mt-2 ml-10 text-xs text-muted-foreground">
                    <Calendar className="h-3 w-3" />
                    <span>Updated {new Date(app.latestSpecDate).toLocaleDateString()}</span>
                  </div>
                )}
              </CardHeader>
              <CardContent className="pt-0">
                {app.latestVersion != null ? (
                  <Link href={`/docs/${app.id}`}>
                    <Button size="sm" className="w-full gap-2 group-hover:gap-3 transition-all">
                      <ExternalLink className="h-4 w-4" />
                      View Documentation
                      <ArrowRight className="h-3 w-3 opacity-0 group-hover:opacity-100 -ml-2 group-hover:ml-0 transition-all" />
                    </Button>
                  </Link>
                ) : isAdmin ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full gap-2"
                    onClick={() => setLocation("/docs/admin")}
                  >
                    <Plus className="h-4 w-4" />
                    Upload Spec
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" className="w-full" disabled>
                    Spec not available
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="border rounded-lg p-4 bg-card flex items-center gap-3">
      <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center shrink-0">{icon}</div>
      <div>
        <div className="text-xl font-bold">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}
