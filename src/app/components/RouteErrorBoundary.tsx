import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class RouteErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Route chunk loading or render error:", error, errorInfo);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  private handleHardReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      const isChunkError =
        this.state.error?.message?.includes("Failed to fetch dynamically imported module") ||
        this.state.error?.message?.includes("Importing a module script failed") ||
        this.state.error?.message?.includes("Loading chunk");

      return (
        <div className="flex flex-col items-center justify-center min-h-[360px] p-6 text-center space-y-4">
          <div className="size-14 rounded-2xl bg-destructive/10 text-destructive flex items-center justify-center border border-destructive/20">
            <AlertTriangle className="size-7" />
          </div>
          <div className="max-w-md">
            <h3 className="font-bold text-lg">
              {this.props.fallbackTitle || "Network Connection Error"}
            </h3>
            <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
              {isChunkError
                ? "The PDA device experienced a network timeout or connection interruption while downloading this screen. Please check Wi-Fi/cellular connection and tap retry."
                : (this.state.error?.message || "An unexpected error occurred while loading this screen.")}
            </p>
          </div>
          <div className="flex gap-2.5 pt-2">
            <button
              onClick={this.handleRetry}
              className="px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:opacity-90 flex items-center gap-2 cursor-pointer shadow-sm"
            >
              <RefreshCw className="size-4" />
              <span>Retry Screen</span>
            </button>
            <button
              onClick={this.handleHardReload}
              className="px-4 py-2 bg-secondary text-secondary-foreground text-sm font-semibold rounded-lg hover:bg-secondary/80 border border-border cursor-pointer"
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
