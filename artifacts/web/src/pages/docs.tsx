import { useState, useMemo } from "react";
import { Link } from "wouter";
import { useListDocApps } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { BookOpen, Search, ExternalLink, FileCode, Calendar, Tag, X } from "lucide-react";

export default function Docs() {
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
        app.description.toLowerCase().includes(q) ||
        (app.tags ?? []).some((t) => t.toLowerCase().includes(q));
      const matchesTag = !selectedTag || (app.tags ?? []).includes(selectedTag);
      return matchesSearch && matchesTag;
    });
  }, [apps, search, selectedTag]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">API Documentation</h1>
          <p className="text-muted-foreground mt-2">Browse and explore interactive API documentation.</p>
        </div>
        <div className="relative">
          <Skeleton className="h-10 w-full max-w-sm" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-40 mb-2" />
                <Skeleton className="h-4 w-64" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-24" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">API Documentation</h1>
        <p className="text-muted-foreground mt-2">
          Browse and explore interactive API documentation for all registered applications.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search applications..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <span className="text-sm text-muted-foreground shrink-0">
            {filtered.length} {filtered.length === 1 ? "application" : "applications"}
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
            {selectedTag && (
              <button
                onClick={() => setSelectedTag(null)}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
                Clear
              </button>
            )}
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 border rounded-lg bg-muted/20">
          <BookOpen className="h-12 w-12 text-muted-foreground/40 mx-auto mb-4" />
          <p className="text-muted-foreground font-medium">
            {search || selectedTag
              ? "No applications match your filters."
              : "No API documentation available yet."}
          </p>
          {(search || selectedTag) && (
            <Button
              variant="ghost"
              className="mt-2"
              onClick={() => { setSearch(""); setSelectedTag(null); }}
            >
              Clear filters
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((app) => (
            <Card key={app.id} className="flex flex-col hover:shadow-md transition-shadow">
              <CardHeader className="flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileCode className="h-5 w-5 text-primary shrink-0" />
                    <CardTitle className="text-base truncate">{app.name}</CardTitle>
                  </div>
                  {app.latestVersion != null && (
                    <Badge variant="secondary" className="shrink-0">
                      v{app.latestVersion}
                    </Badge>
                  )}
                </div>
                {app.description && (
                  <CardDescription className="mt-1 line-clamp-2">
                    {app.description}
                  </CardDescription>
                )}
                {(app.tags ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {(app.tags ?? []).map((tag) => (
                      <button
                        key={tag}
                        onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium transition-colors border ${
                          selectedTag === tag
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-muted text-muted-foreground border-border hover:bg-primary/10 hover:text-primary"
                        }`}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                )}
                {app.latestSpecDate && (
                  <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                    <Calendar className="h-3 w-3" />
                    <span>
                      Updated {new Date(app.latestSpecDate).toLocaleDateString()}
                    </span>
                  </div>
                )}
              </CardHeader>
              <CardContent className="pt-0">
                {app.latestVersion != null ? (
                  <Link href={`/docs/${app.id}`}>
                    <Button size="sm" className="w-full gap-2">
                      <ExternalLink className="h-4 w-4" />
                      View Docs
                    </Button>
                  </Link>
                ) : (
                  <Button size="sm" variant="outline" className="w-full" disabled>
                    No spec available
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
