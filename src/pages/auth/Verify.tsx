import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { verifyEmail, resendVerification } from "@/api/auth";
import { ApiError } from "@/lib/api-client";

type State = "verifying" | "success" | "already_verified" | "error" | "resending" | "resent";

export default function Verify() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [state, setState] = useState<State>(token ? "verifying" : "error");
  const [errorMessage, setErrorMessage] = useState("");
  const [email, setEmail] = useState("");

  useEffect(() => {
    if (!token) return;

    verifyEmail(token)
      .then((result) => {
        setState(result.verified ? "success" : "already_verified");
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 409) {
          setState("already_verified");
        } else {
          setErrorMessage(err instanceof Error ? err.message : "Verification failed.");
          setState("error");
        }
      });
  }, [token]);

  const handleResend = () => {
    if (!email) return;
    setState("resending");
    resendVerification(email)
      .then(() => setState("resent"))
      .catch(() => setState("resent")); // generic — don't reveal if email exists
  };

  return (
    <AuthLayout title="Email verification">
      <div className="flex flex-col items-center gap-4 py-4 text-center">
        {state === "verifying" && (
          <>
            <Spinner size="lg" />
            <p className="text-sm text-slate">Verifying your email address&hellip;</p>
          </>
        )}

        {state === "success" && (
          <>
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-2xl">
              ✓
            </div>
            <p className="text-sm text-ink">Your email has been verified. You can now sign in.</p>
            <Link to="/signin">
              <Button className="mt-2">Sign in</Button>
            </Link>
          </>
        )}

        {state === "already_verified" && (
          <>
            <p className="text-sm text-slate">Your email is already verified.</p>
            <Link to="/signin">
              <Button variant="secondary">Go to sign in</Button>
            </Link>
          </>
        )}

        {state === "error" && (
          <>
            <p className="text-sm text-red-500">
              {errorMessage || "The verification link is invalid or has expired."}
            </p>
            <p className="mt-2 text-xs text-slate">
              Enter your email below to request a new verification link.
            </p>
            <div className="mt-2 flex w-full max-w-xs flex-col gap-2">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm text-ink placeholder:text-slate/60 focus:outline-none focus:ring-2 focus:ring-neon"
              />
              <Button onClick={handleResend} disabled={!email}>
                Resend verification email
              </Button>
            </div>
          </>
        )}

        {state === "resending" && (
          <>
            <Spinner size="lg" />
            <p className="text-sm text-slate">Sending verification email&hellip;</p>
          </>
        )}

        {state === "resent" && (
          <>
            <p className="text-sm text-ink">
              If that email is registered, a verification link has been sent. Check your inbox.
            </p>
            <Link to="/signin">
              <Button variant="secondary" className="mt-2">Back to sign in</Button>
            </Link>
          </>
        )}
      </div>
    </AuthLayout>
  );
}
