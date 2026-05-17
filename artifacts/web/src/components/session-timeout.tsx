import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Clock } from "lucide-react";

const IDLE_TIMEOUT_MS    = 30 * 60 * 1000;  // 30 minutes
const WARN_BEFORE_MS     = 2  * 60 * 1000;  // warn 2 min before
const WARNING_AT_MS      = IDLE_TIMEOUT_MS - WARN_BEFORE_MS;  // 28 min
const CHECK_INTERVAL_MS  = 30_000;           // poll every 30 s
const ACTIVITY_KEY       = "ashika_last_activity";

const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  "mousemove", "mousedown", "keydown", "touchstart", "scroll", "click",
];

function stampActivity() {
  sessionStorage.setItem(ACTIVITY_KEY, String(Date.now()));
}

function getLastActivity(): number {
  return parseInt(sessionStorage.getItem(ACTIVITY_KEY) ?? "0", 10) || Date.now();
}

export function SessionTimeoutProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, logout } = useAuth();
  const [showWarning, setShowWarning]   = useState(false);
  const [secondsLeft, setSecondsLeft]   = useState(WARN_BEFORE_MS / 1000);
  const checkTimer  = useRef<ReturnType<typeof setInterval> | null>(null);
  const countTimer  = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── reset timers when auth state changes ──────────────────────────────────
  useEffect(() => {
    if (!isAuthenticated) {
      setShowWarning(false);
      clearAll();
      return;
    }
    stampActivity();
    startChecking();
    ACTIVITY_EVENTS.forEach(e => window.addEventListener(e, onActivity, { passive: true }));
    return () => {
      clearAll();
      ACTIVITY_EVENTS.forEach(e => window.removeEventListener(e, onActivity));
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  function onActivity() {
    stampActivity();
    if (showWarning) {
      dismissWarning();
    }
  }

  function clearAll() {
    if (checkTimer.current)  { clearInterval(checkTimer.current);  checkTimer.current  = null; }
    if (countTimer.current)  { clearInterval(countTimer.current);  countTimer.current  = null; }
  }

  function startChecking() {
    clearAll();
    checkTimer.current = setInterval(checkIdle, CHECK_INTERVAL_MS);
  }

  function checkIdle() {
    const idle = Date.now() - getLastActivity();
    if (idle >= IDLE_TIMEOUT_MS) {
      clearAll();
      setShowWarning(false);
      logout();
      return;
    }
    if (idle >= WARNING_AT_MS && !showWarning) {
      triggerWarning(Math.round((IDLE_TIMEOUT_MS - idle) / 1000));
    }
  }

  function triggerWarning(secs: number) {
    setShowWarning(true);
    setSecondsLeft(secs);
    clearInterval(countTimer.current ?? undefined);
    countTimer.current = setInterval(() => {
      setSecondsLeft(prev => {
        if (prev <= 1) {
          clearAll();
          setShowWarning(false);
          logout();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  function dismissWarning() {
    stampActivity();
    clearInterval(countTimer.current ?? undefined);
    countTimer.current = null;
    setShowWarning(false);
    setSecondsLeft(WARN_BEFORE_MS / 1000);
    startChecking();
  }

  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  const timeStr = mins > 0
    ? `${mins}m ${String(secs).padStart(2, "0")}s`
    : `${secs}s`;

  return (
    <>
      {children}

      <Dialog open={showWarning} onOpenChange={() => {}}>
        <DialogContent
          className="sm:max-w-md"
          onPointerDownOutside={e => e.preventDefault()}
          onEscapeKeyDown={e => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
              <Clock className="h-5 w-5" />
              Session about to expire
            </DialogTitle>
            <DialogDescription className="pt-2 text-base">
              Your session will automatically sign you out due to inactivity.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-center py-6">
            <div className="flex flex-col items-center gap-1">
              <span className="text-5xl font-mono font-bold tabular-nums text-amber-600 dark:text-amber-400">
                {timeStr}
              </span>
              <span className="text-sm text-muted-foreground">until automatic sign-out</span>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => { logout(); setShowWarning(false); }}>
              Sign out now
            </Button>
            <Button onClick={dismissWarning}>
              Stay signed in
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
