import { cn } from "@/lib/cn";

type ErrorMessageProps = {
  title?: string;
  message?: string | null;
  className?: string;
};

export function ErrorMessage({ title, message, className }: ErrorMessageProps) {
  if (!title && !message) return null;
  return (
    <div
      role="alert"
      className={cn(
        "rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700",
        className
      )}
    >
      {title && <p className="font-semibold">{title}</p>}
      {message && <p className={title ? "mt-1 opacity-80" : ""}>{message}</p>}
    </div>
  );
}
