import { forwardRef, type ReactNode } from "react";
import { motion, type HTMLMotionProps } from "motion/react";
import { cn } from "@/lib/cn";
import { buttonHover } from "@/lib/motion";
import { Spinner } from "./Spinner";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

type ButtonProps = Omit<HTMLMotionProps<"button">, "children"> & {
  variant?: Variant;
  size?: Size;
  isLoading?: boolean;
  children?: ReactNode;
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
  sm: "rounded-none px-4 py-2 text-xs",
  md: "rounded-none px-6 py-3 text-sm",
  lg: "rounded-none px-8 py-4 text-base",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { variant = "primary", size = "md", isLoading, disabled, children, className, ...rest },
    ref
  ) => (
    <motion.button
      ref={ref}
      disabled={disabled || isLoading}
      {...buttonHover}
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
    </motion.button>
  )
);
Button.displayName = "Button";
