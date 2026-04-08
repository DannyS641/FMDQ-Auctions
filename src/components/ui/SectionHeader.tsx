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
      <h1 className="mt-2 break-words text-[21px] font-semibold text-neon sm:text-[27px]">{title}</h1>
      {description && <p className="mt-3 text-sm text-slate">{description}</p>}
    </div>
  );
}
