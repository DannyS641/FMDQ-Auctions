import { type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type CardProps = HTMLAttributes<HTMLDivElement> & {
  padding?: "sm" | "md" | "lg" | "none";
};

const paddings = {
  none: "",
  sm: "p-4",
  md: "p-5 sm:p-6",
  lg: "p-6 sm:p-8",
};

export function Card({ padding = "md", className, children, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-3xl border border-ink/10 bg-white",
        paddings[padding],
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
