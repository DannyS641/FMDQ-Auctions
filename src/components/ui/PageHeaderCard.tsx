import { type ReactNode } from "react";
import { cn } from "@/lib/cn";

type PageHeaderCardProps = {
  title: string;
  subtitle?: string;
  /** Buttons rendered top-right of the navy banner. Use `bannerActionClass` so they read on dark. */
  actions?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
};

/** Class for a Button/link placed in the banner `actions` slot, so it reads on the navy background. */
export const bannerActionClass =
  "border border-white/25 bg-white/10 text-white hover:bg-white/20 disabled:opacity-50";

/**
 * Navy banner + gold underline + white body, matching the calm "Genesis"
 * reference: one bordered card that carries the page title up top instead of
 * a bare heading floating over the page background.
 */
export function PageHeaderCard({ title, subtitle, actions, children, footer, className }: PageHeaderCardProps) {
  return (
    <div className={cn("overflow-hidden rounded-3xl border border-ink/10 bg-white", className)}>
      <div className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-gold bg-neon px-5 py-5 sm:px-8 sm:py-6">
        <div className="min-w-0">
          <h1 className="break-words text-lg font-semibold text-white sm:text-xl">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-white/70">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="p-5 sm:p-8">{children}</div>}
      {footer && (
        <div className="border-t border-ink/10 px-5 py-4 text-xs text-slate sm:px-8">{footer}</div>
      )}
    </div>
  );
}
