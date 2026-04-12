import { type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/auth-context";

type AuthLayoutProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function AuthLayout({ eyebrow = "FMDQ Auctions Portal", title, description, children, footer }: AuthLayoutProps) {
  const navigate = useNavigate();
  const { isSignedIn, session } = useAuth();

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      {/* Left — image panel */}
      <div className="hidden w-[42%] shrink-0 overflow-hidden lg:block">
        <div className="relative h-full w-full bg-[#0f172a]">
          <img src="/slides/slide-1.jpg" alt="" fetchPriority="high" className="slide-fade absolute inset-0 h-full w-full object-cover opacity-80" />
          <img src="/slides/slide-2.jpg" alt="" loading="lazy" className="slide-fade absolute inset-0 h-full w-full object-cover opacity-80" style={{ animationDelay: "4s" }} />
          <img src="/slides/slide-3.jpg" alt="" loading="lazy" className="slide-fade absolute inset-0 h-full w-full object-cover opacity-80" style={{ animationDelay: "8s" }} />
        </div>
      </div>

      {/* Right — form panel */}
      <div className="flex flex-1 flex-col overflow-y-auto">
        {/* Top bar */}
        <div className="flex items-center justify-between px-8 pt-8 pb-2">
          <Link to="/">
            <img src="/slides/fmdq-logo.png" alt="FMDQ" className="h-9 w-auto" />
          </Link>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="rounded-[0.9rem] border border-ink/15 px-5 py-2 text-xs font-semibold uppercase tracking-[0.15em] text-ink transition hover:bg-ash"
          >
            Back
          </button>
        </div>

        {/* Form area */}
        <div className="flex flex-1 flex-col justify-center px-8 py-10 sm:px-12 lg:px-16 xl:px-20">
          <div className="w-full max-w-md">
            {/* Session status */}
            <div className="mb-6 rounded-2xl border border-ink/10 bg-white px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-slate">User</p>
              <p className="mt-1 text-sm font-semibold text-ink">
                {isSignedIn ? session.displayName : "No active session"}
              </p>
            </div>

            {/* Divider */}
            <div className="mb-6 flex items-center gap-3">
              <div className="h-px flex-1 bg-ink/10" />
              <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-slate">Secure access</p>
              <div className="h-px flex-1 bg-ink/10" />
            </div>

            {/* Eyebrow + heading */}
            {eyebrow && (
              <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-slate">{eyebrow}</p>
            )}
            <h1 className="mt-2 text-[21px] font-semibold text-neon">{title}</h1>
            {description && <p className="mt-2 text-sm text-slate">{description}</p>}

            {/* Form */}
            <div className="mt-6">{children}</div>

            {/* Footer */}
            {footer && (
              <div className="mt-6 text-center text-sm text-slate">{footer}</div>
            )}

            {/* New users hint */}
            <p className="mt-6 rounded-2xl bg-[#fff7e8] px-4 py-3 text-xs text-[#9a6408]">
              New users should create an account first, verify their email, then sign in.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
