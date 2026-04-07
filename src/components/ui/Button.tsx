import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "./Spinner";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  isLoading?: boolean;
};

const variants: Record<Variant, string> = {
  primary:
    "bg-neon text-white shadow-sm hover:bg-neon/90 disabled:bg-neon/50",
  secondary:
    "border border-ink/20 bg-white text-ink hover:bg-[#eef3ff] hover:text-neon disabled:opacity-50",
  ghost:
    "bg-transparent text-ink hover:bg-ink/5 disabled:opacity-50",
  danger:
    "bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300",
};

const sizes: Record<Size, string> = {
  sm: "rounded-[0.75rem] px-4 py-2 text-xs",
  md: "rounded-[0.9rem] px-6 py-3 text-sm",
  lg: "rounded-[1rem] px-8 py-4 text-base",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { variant = "primary", size = "md", isLoading, disabled, children, className, ...rest },
    ref
  ) => (
    <button
      ref={ref}
      disabled={disabled || isLoading}
      className={cn(
        "inline-flex items-center justify-center gap-2 font-semibold transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon focus-visible:ring-offset-2",
        variants[variant],
        sizes[size],
        className
      )}
      {...rest}
    >
      {isLoading && <Spinner size="sm" />}
      {children}
    </button>
  )
);
Button.displayName = "Button";
