import { Component, type ErrorInfo, type ReactNode } from "react";

type AppErrorBoundaryProps = {
  children: ReactNode;
};

type AppErrorBoundaryState = {
  hasError: boolean;
};

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {
    hasError: false,
  };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("App render failed", error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-ash px-6 py-12">
          <div className="w-full max-w-lg rounded-3xl border border-ink/10 bg-white p-8 text-center shadow-[0_18px_60px_rgba(15,23,42,0.08)]">
            <p className="text-xs uppercase tracking-[0.3em] text-slate">Portal recovery</p>
            <h1 className="mt-3 text-[21px] font-semibold text-neon sm:text-[27px]">
              Something interrupted the page
            </h1>
            <p className="mt-3 text-sm text-slate">
              The portal hit an unexpected UI error. Refreshing usually gets you back in immediately.
            </p>
            <button
              type="button"
              onClick={this.handleReload}
              className="mt-6 rounded-[0.9rem] bg-neon px-5 py-3 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(29,50,108,0.2)] transition duration-200 hover:bg-neon/90"
            >
              Reload portal
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
