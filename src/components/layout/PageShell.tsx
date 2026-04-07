import { type ReactNode } from "react";

type PageShellProps = {
  children: ReactNode;
  maxWidth?: "7xl" | "6xl";
};

export function PageShell({ children, maxWidth = "7xl" }: PageShellProps) {
  return (
    <div className={`mx-auto w-full max-w-${maxWidth} flex-1 px-4 py-6 sm:px-6 sm:py-10`}>
      {children}
    </div>
  );
}
