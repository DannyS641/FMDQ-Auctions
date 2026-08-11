import { type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

type Accent = "neon" | "gold" | "tide" | "violet" | "emerald" | "rose";

const accentStyles: Record<Accent, { bar: string; chipBg: string; chipText: string }> = {
  neon: { bar: "bg-neon", chipBg: "bg-neon/10", chipText: "text-neon" },
  gold: { bar: "bg-gold", chipBg: "bg-gold/10", chipText: "text-gold" },
  tide: { bar: "bg-tide", chipBg: "bg-tide/10", chipText: "text-tide" },
  violet: { bar: "bg-violet-500", chipBg: "bg-violet-50", chipText: "text-violet-600" },
  emerald: { bar: "bg-emerald-500", chipBg: "bg-emerald-50", chipText: "text-emerald-600" },
  rose: { bar: "bg-rose-500", chipBg: "bg-rose-50", chipText: "text-rose-600" },
};

type StatTileProps = {
  icon: ReactNode;
  accent: Accent;
  label: string;
  value: string | number;
  caption?: string;
  onClick?: () => void;
  className?: string;
};

/** White KPI tile with a colored top accent bar + icon chip, matching the reference dashboard tiles. */
export function StatTile({ icon, accent, label, value, caption, onClick, className }: StatTileProps) {
  const styles = accentStyles[accent];
  const Comp = onClick ? "button" : "div";

  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "relative flex flex-col gap-3 overflow-hidden rounded-2xl border border-ink/10 bg-white p-5 text-left transition duration-200",
        onClick && "hover:-translate-y-0.5 hover:border-ink/20 hover:shadow-[0_8px_24px_rgba(15,23,42,0.06)]",
        className
      )}
    >
      <span className={cn("absolute inset-x-0 top-0 h-1", styles.bar)} />
      <div className="flex items-center justify-between">
        <span className={cn("inline-flex h-10 w-10 items-center justify-center rounded-xl", styles.chipBg, styles.chipText)}>
          {icon}
        </span>
        {onClick && <ChevronRight size={16} className="text-slate" />}
      </div>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate">{label}</p>
        <p className="mt-1 text-3xl font-semibold text-ink">{value}</p>
      </div>
      {caption && <p className="text-xs text-slate">{caption}</p>}
    </Comp>
  );
}
