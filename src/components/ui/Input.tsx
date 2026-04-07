import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  error?: string;
  label?: string;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ error, label, id, className, ...rest }, ref) => (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={id} className="text-xs font-semibold uppercase tracking-[0.2em] text-slate">
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={id}
        className={cn(
          "w-full rounded-2xl border px-4 py-3 text-sm text-ink placeholder:text-slate/60 transition",
          "focus:outline-none focus:ring-2 focus:ring-neon focus:ring-offset-1",
          error ? "border-red-400 bg-red-50" : "border-ink/10 bg-white",
          rest.disabled && "cursor-not-allowed opacity-50",
          className
        )}
        {...rest}
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
);
Input.displayName = "Input";
