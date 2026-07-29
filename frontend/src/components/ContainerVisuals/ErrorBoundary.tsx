/**
 * components/ContainerVisuals/ErrorBoundary.tsx — Catches render errors
 * in visual components and shows a small fallback instead of crashing
 * the entire state panel.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[ErrorBoundary] Render error in visual component:", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <span className="text-[10px] text-red-400 font-mono" title="This visual component crashed">
          ⚠ render error
        </span>
      );
    }
    return this.props.children;
  }
}
