import { useState, useEffect } from "react";
import { useParams } from "wouter";
import SwaggerUI from "swagger-ui-react";
import "swagger-ui-react/swagger-ui.css";
import * as yaml from "js-yaml";
import {
  useListDocApps,
  useListDocAppSpecs,
  useGetDocAppSpec,
  getListDocAppSpecsQueryKey,
  getGetDocAppSpecQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, AlertCircle, FileCode, Settings2, Calendar, Tag, ExternalLink } from "lucide-react";
import { formatDate } from "@/lib/date";
import { Link } from "wouter";
import { getAccessToken } from "@/lib/auth";

export default function DocsViewer() {
  const params = useParams<{ appId: string }>();
  const appId = Number(params.appId);
  const { user } = useAuth();
  const isAdmin = user?.roleName === "Admin";

  const { data: apps } = useListDocApps();
  const app = apps?.find((a) => a.id === appId);

  const { data: specs, isLoading: isLoadingSpecs } = useListDocAppSpecs(appId, {
    query: { queryKey: getListDocAppSpecsQueryKey(appId), enabled: !isNaN(appId) },
  });

  const activeSpec = specs?.find((s) => s.isActive);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);

  useEffect(() => {
    if (activeSpec && selectedVersion === null) {
      setSelectedVersion(activeSpec.version);
    }
  }, [activeSpec, selectedVersion]);

  const version = selectedVersion ?? activeSpec?.version;

  const { data: specContent, isLoading: isLoadingContent, isError } = useGetDocAppSpec(
    appId,
    version!,
    {
      query: {
        queryKey: getGetDocAppSpecQueryKey(appId, version!),
        enabled: !isNaN(appId) && version != null,
      },
    }
  );

  if (isNaN(appId)) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
        <AlertCircle className="h-12 w-12 text-destructive" />
        <p className="text-lg font-medium">Invalid application ID</p>
        <Link href="/docs">
          <Button variant="outline">Back to API Docs</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/docs">
          <Button variant="ghost" size="sm" className="gap-2 shrink-0">
            <ArrowLeft className="h-4 w-4" />
            API Docs
          </Button>
        </Link>

        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
            <FileCode className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight truncate">
              {app?.name ?? "Loading…"}
            </h1>
            {app?.description && (
              <p className="text-xs text-muted-foreground truncate">{app.description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {specs && specs.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground hidden sm:block">Version:</span>
              <Select
                value={selectedVersion?.toString() ?? ""}
                onValueChange={(val) => setSelectedVersion(Number(val))}
              >
                <SelectTrigger className="w-48 h-8 text-sm">
                  <SelectValue placeholder="Select version" />
                </SelectTrigger>
                <SelectContent>
                  {specs.map((s) => (
                    <SelectItem key={s.version} value={s.version.toString()}>
                      {s.specLabel ? `${s.specLabel}` : `v${s.version}`}
                      {s.isActive ? " ★" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {isAdmin && (
            <Link href="/docs/mgr">
              <Button variant="outline" size="sm" className="gap-2">
                <Settings2 className="h-4 w-4" />
                Manage
              </Button>
            </Link>
          )}
        </div>
      </div>

      {/* Meta bar */}
      {app && (
        <div className="flex flex-wrap items-center gap-3 px-1">
          {(app.tags ?? []).map((tag) => (
            <Badge key={tag} variant="secondary" className="gap-1 text-xs">
              <Tag className="h-3 w-3" />
              {tag}
            </Badge>
          ))}
          {activeSpec && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              Last updated {formatDate(activeSpec.uploadedAt)}
            </span>
          )}
          {specs && specs.length > 0 && (
            <Badge variant="outline" className="text-xs">
              {specs.length} version{specs.length !== 1 ? "s" : ""}
            </Badge>
          )}
        </div>
      )}

      {/* Swagger UI Panel */}
      <div className="border rounded-lg overflow-hidden bg-white dark:bg-card shadow-sm">
        {isLoadingSpecs || isLoadingContent ? (
          <div className="p-8 space-y-4">
            <Skeleton className="h-10 w-72" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <div className="space-y-2 mt-4">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          </div>
        ) : isError || !specContent ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
            <AlertCircle className="h-12 w-12 text-muted-foreground/40" />
            <div>
              <p className="text-muted-foreground font-medium">
                {specs?.length === 0
                  ? "No spec versions have been uploaded for this application."
                  : "Failed to load the spec. Please try again."}
              </p>
              {specs?.length === 0 && isAdmin && (
                <Link href="/docs/mgr">
                  <Button variant="outline" size="sm" className="mt-3 gap-2">
                    <ExternalLink className="h-4 w-4" />
                    Upload a spec
                  </Button>
                </Link>
              )}
            </div>
          </div>
        ) : (
          <SwaggerUIWrapper specContent={specContent as SpecContent} />
        )}
      </div>
    </div>
  );
}

interface SpecContent {
  type: string;
  url?: string | null;
  content?: string | null;
  version: number;
  specUrl?: string | null;
}

function SwaggerUIWrapper({ specContent }: { specContent: SpecContent }) {
  const token = getAccessToken();
  const requestInterceptor = (req: { headers: Record<string, string> }) => {
    if (token) req.headers["Authorization"] = `Bearer ${token}`;
    return req;
  };

  if (specContent.type === "inline" && specContent.content) {
    return (
      <SwaggerUI
        spec={parseSpec(specContent.content)}
        requestInterceptor={requestInterceptor}
        tryItOutEnabled={true}
        docExpansion="list"
        defaultModelsExpandDepth={1}
      />
    );
  }

  const url = specContent.url ?? specContent.specUrl ?? undefined;
  if (url) {
    return (
      <SwaggerUI
        url={url}
        requestInterceptor={requestInterceptor}
        tryItOutEnabled={true}
        docExpansion="list"
        defaultModelsExpandDepth={1}
      />
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
      <AlertCircle className="h-12 w-12 text-muted-foreground/40" />
      <p className="text-muted-foreground font-medium">No spec content available for this version.</p>
    </div>
  );
}

function parseSpec(content: string): object {
  try {
    return JSON.parse(content);
  } catch {
    try {
      return yaml.load(content) as object;
    } catch {
      return { openapi: "3.0.0", info: { title: "Parse Error", version: "0.0.0" }, paths: {} };
    }
  }
}
