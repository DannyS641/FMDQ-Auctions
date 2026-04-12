import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { Toaster } from "sonner";
import { AuthProvider } from "@/context/auth-context";
import { AppErrorBoundary } from "@/components/routing/AppErrorBoundary";
import { App } from "./App";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        if (error instanceof Error && "status" in error) {
          const status = (error as { status: number }).status;
          if ([401, 403, 404].includes(status)) return false;
        }
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
      staleTime: 30_000, // 30s — cached data reused on page revisit
    },
    mutations: {
      retry: false,
    },
  },
});

// Handoff from the static boot HTML to the mounted React app.
const loader = document.getElementById("app-loader");
if (loader) {
  // requestAnimationFrame ensures React has painted at least one frame
  requestAnimationFrame(() => {
    document.body.removeAttribute("data-app-loading");
    loader.classList.add("hidden");
  });
}

const root = document.getElementById("root");
if (!root) throw new Error("#root element not found in index.html");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppErrorBoundary>
        <BrowserRouter>
          <AuthProvider>
            <App />
            <Toaster
              position="top-right"
              richColors
              closeButton
              toastOptions={{
                duration: 4000,
                style: { fontFamily: '"Space Grotesk", system-ui, sans-serif' },
              }}
            />
          </AuthProvider>
        </BrowserRouter>
      </AppErrorBoundary>
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  </StrictMode>
);
