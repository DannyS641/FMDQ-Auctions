import { cn } from "@/lib/cn";

type EmptyStateProps = {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
};

export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-16 text-center", className)}>
      <p className="text-sm font-semibold text-ink">{title}</p>
      {description && <p className="mt-2 text-sm text-slate">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
