import { useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/context/auth-context";

const TIMEOUT_MS = 5 * 60 * 1000;       // 5 minutes
const WARN_BEFORE_MS = 60 * 1000;        // warn 1 minute before logout

const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "scroll",
  "touchstart",
  "click",
] as const;

export function useInactivityTimeout() {
  const { isSignedIn, signOut } = useAuth();
  const navigate = useNavigate();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warnRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warnToastId = useRef<string | number | null>(null);

  const clearTimers = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (warnRef.current) clearTimeout(warnRef.current);
    if (warnToastId.current !== null) {
      toast.dismiss(warnToastId.current);
      warnToastId.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    clearTimers();

    warnRef.current = setTimeout(() => {
      warnToastId.current = toast.warning(
        "You will be signed out in 1 minute due to inactivity.",
        { duration: 60_000 }
      );
    }, TIMEOUT_MS - WARN_BEFORE_MS);

    timeoutRef.current = setTimeout(async () => {
      await signOut();
      navigate("/signin", { replace: true });
      toast.info("You were signed out due to inactivity.");
    }, TIMEOUT_MS);
  }, [clearTimers, signOut, navigate]);

  useEffect(() => {
    if (!isSignedIn) {
      clearTimers();
      return;
    }

    ACTIVITY_EVENTS.forEach((e) =>
      window.addEventListener(e, reset, { passive: true })
    );
    reset();

    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, reset));
      clearTimers();
    };
  }, [isSignedIn, reset, clearTimers]);
}
