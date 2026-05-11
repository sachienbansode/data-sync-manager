import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import SwaggerUI from "swagger-ui-react";
import "swagger-ui-react/swagger-ui.css";
import {
  useListDocApps,
  useListDocAppSpecs,
  useGetDocAppSpec,
  getListDocAppSpecsQueryKey,
  getGetDocAppSpecQueryKey,
} from "@workspace/api-client-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, AlertCircle, FileCode } from "lucide-react";
import { Link } from "wouter";
import { getAccessToken } from "@/lib/auth";

export default function DocsViewer() {
  const params = useParams<{ appId: string }>();
  const appId = Number(params.appId);
  const [, setLocation] = useLocation();

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
      query: { queryKey: getGetDocAppSpecQueryKey(appId, version!), enabled: !isNaN(appId) && version != null },
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
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/docs">
          <Button variant="ghost" size="sm" className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            API Docs
          </Button>
        </Link>

        <div className="flex items-center gap-2 min-w-0 flex-1">
          <FileCode className="h-5 w-5 text-primary shrink-0" />
          <h1 className="text-xl font-bold tracking-tight truncate">
            {app?.name ?? "Loading…"}
          </h1>
        </div>

        {specs && specs.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Version:</span>
            <Select
              value={selectedVersion?.toString() ?? ""}
              onValueChange={(val) => setSelectedVersion(Number(val))}
            >
              <SelectTrigger className="w-32 h-8 text-sm">
                <SelectValue placeholder="Select version" />
              </SelectTrigger>
              <SelectContent>
                {specs.map((s) => (
                  <SelectItem key={s.version} value={s.version.toString()}>
                    v{s.version}
                    {s.isActive ? " (latest)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {app?.description && (
        <p className="text-sm text-muted-foreground">{app.description}</p>
      )}

      <div className="border rounded-lg overflow-hidden bg-white">
        {isLoadingSpecs || isLoadingContent ? (
          <div className="p-8 space-y-4">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : isError || !specContent ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
            <AlertCircle className="h-12 w-12 text-muted-foreground/40" />
            <p className="text-muted-foreground font-medium">
              {specs?.length === 0
                ? "No spec versions available for this application."
                : "Failed to load spec content. Please try again."}
            </p>
            <Link href="/docs">
              <Button variant="outline" size="sm">Back to API Docs</Button>
            </Link>
          </div>
        ) : (
          <SwaggerUIWrapper specContent={specContent} />
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
    if (token) {
      req.headers["Authorization"] = `Bearer ${token}`;
    }
    return req;
  };

  if (specContent.type === "inline" && specContent.content) {
    return (
      <SwaggerUI
        spec={parseSpec(specContent.content)}
        requestInterceptor={requestInterceptor}
        tryItOutEnabled={true}
        docExpansion="list"
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
      />
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
      <AlertCircle className="h-12 w-12 text-muted-foreground/40" />
      <p className="text-muted-foreground font-medium">No spec content available.</p>
    </div>
  );
}

function parseSpec(content: string): object {
  try {
    return JSON.parse(content);
  } catch {
    return { openapi: "3.0.0", info: { title: "Spec", version: "0.0.0" }, paths: {} };
  }
}
