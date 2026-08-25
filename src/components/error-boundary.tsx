"use client";

import { Component } from "react";

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center gap-4 rounded-lg bg-surface p-12 shadow-card">
          <p className="font-medium text-danger">Something went wrong</p>
          <p className="max-w-sm text-center text-sm text-muted">
            {this.state.error?.message ?? "An unexpected error occurred."}
          </p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, error: null })}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-canvas"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
