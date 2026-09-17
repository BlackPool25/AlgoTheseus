/**
 * components/ErrorBoundary/RootErrorBoundary.tsx — Top-level crash guard.
 *
 * Wraps <App/> in main.tsx so a render throw never leaves a blank #root.
 * Pattern mirrors ContainerVisuals/ErrorBoundary (getDerivedStateFromError +
 * componentDidCatch) with a branded full-page fallback + retry. That scoped
 * boundary is untouched — this one owns the root only.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string | null;
}

export class RootErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: null };
  }

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[RootErrorBoundary] Uncaught render error:", error, info.componentStack);
  }

  private handleRetry = (): void => {
    this.setState({ hasError: false, message: null });
  };

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen min-h-dvh bg-viz-body text-viz-ink px-4">
          <h1 className="text-sm font-semibold">AlgoTheseus</h1>
          <p className="mt-1 text-xs font-mono text-viz-ink/60">C++ · libclang</p>
          <div
            role="alert"
            className="mt-6 max-w-md w-full rounded border border-viz-line bg-viz-panel p-4"
          >
            <p className="text-sm font-medium">Something went wrong while rendering.</p>
            <p className="mt-1 text-xs text-viz-ink/60">
              The visualizer hit an unexpected error instead of showing a blank page.
            </p>
            {this.state.message != null && this.state.message.length > 0 && (
              <pre className="mt-2 max-h-24 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] text-red-300">
                {this.state.message}
              </pre>
            )}
            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                onClick={this.handleRetry}
                className="bg-blue-600 hover:bg-blue-500 text-white text-sm rounded px-4 py-1.5 transition-colors"
              >
                Try again
              </button>
              <button
                type="button"
                onClick={this.handleReload}
                className="text-xs text-viz-ink/60 hover:text-viz-ink transition-colors px-2 py-1.5"
              >
                Reload page
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
