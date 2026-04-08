import { cn } from "@/lib/cn";

type SpinnerProps = {
  size?: "sm" | "md" | "lg";
  className?: string;
};

type PageSpinnerProps = {
  fullScreen?: boolean;
  label?: string;
};

export function Spinner({ size = "md", className }: SpinnerProps) {
  const sizes = { sm: "h-4 w-4", md: "h-6 w-6", lg: "h-10 w-10" };
  return (
    <div
      role="status"
      aria-label="Loading"
      className={cn(
        "animate-spin rounded-full border-2 border-ink/10 border-t-neon",
        sizes[size],
        className
      )}
    />
  );
}

export function PageSpinner({
  fullScreen = false,
  label = "Loading page",
}: PageSpinnerProps) {
  return (
    <div
      className={cn(
        "flex w-full items-center justify-center bg-ash py-16",
        fullScreen && "min-h-screen py-0"
      )}
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <Spinner size="lg" />
        <p className="text-sm font-medium text-slate">{label}</p>
      </div>
    </div>
  );
}
