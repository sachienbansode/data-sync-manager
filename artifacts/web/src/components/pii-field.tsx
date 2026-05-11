import { useState } from "react";
import { Eye, EyeOff, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getAccessToken } from "@/lib/auth";
import { toast } from "sonner";

interface PiiFieldProps {
  recordId: number;
  fieldName: "phone" | "nationalId" | "bankAccount" | "panNumber" | "emailCounterparty" | "address";
  hasValue: boolean;
  fieldLabel?: string;
  className?: string;
}

const MASKED = "••••••••";

export function PiiField({ recordId, fieldName, hasValue, fieldLabel, className }: PiiFieldProps) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hidden, setHidden] = useState(false);

  if (!hasValue) {
    return <span className="text-muted-foreground text-sm">—</span>;
  }

  const handleReveal = async () => {
    if (revealed && !hidden) {
      setHidden(true);
      return;
    }
    if (revealed && hidden) {
      setHidden(false);
      return;
    }

    setLoading(true);
    try {
      const token = getAccessToken();
      const res = await fetch(`${import.meta.env.BASE_URL}api/pii/reveal`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ recordId, fieldName }),
      });

      if (res.status === 403) {
        toast.error(`You don't have permission to reveal ${fieldLabel ?? fieldName}`);
        return;
      }
      if (res.status === 429) {
        toast.error("Rate limit exceeded — max 20 reveals per minute");
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? "Failed to reveal field");
        return;
      }

      const data = await res.json();
      setRevealed(data.value);
      setHidden(false);
    } catch {
      toast.error("Network error while revealing field");
    } finally {
      setLoading(false);
    }
  };

  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-sm ${className ?? ""}`}>
      <span className={revealed && !hidden ? "text-foreground select-all" : "tracking-widest text-muted-foreground"}>
        {revealed && !hidden ? revealed : MASKED}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="h-5 w-5 shrink-0"
        onClick={handleReveal}
        disabled={loading}
        title={revealed && !hidden ? "Hide" : "Reveal"}
      >
        {loading ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : revealed && !hidden ? (
          <EyeOff className="h-3 w-3" />
        ) : (
          <Eye className="h-3 w-3" />
        )}
      </Button>
    </span>
  );
}

export function PiiFieldLocked({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 font-mono text-sm text-muted-foreground ${className ?? ""}`}>
      <Lock className="h-3 w-3" />
      <span className="tracking-widest">{MASKED}</span>
    </span>
  );
}
