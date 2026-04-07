import { cn } from "@/lib/cn";

type SectionHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  className?: string;
};

export function SectionHeader({ eyebrow, title, description, className }: SectionHeaderProps) {
  return (
    <div className={cn("", className)}>
      {eyebrow && (
        <p className="text-xs uppercase tracking-[0.3em] text-slate">{eyebrow}</p>
      )}
      <h1 className="mt-2 break-words text-2xl font-semibold text-ink sm:text-3xl">{title}</h1>
      {description && <p className="mt-3 text-sm text-slate">{description}</p>}
    </div>
  );
}
