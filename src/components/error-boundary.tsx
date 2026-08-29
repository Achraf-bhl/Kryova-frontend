"use client";

import { Component } from "react";

/** Anything with a `digest` is a React-redacted server error. */
export interface DisplayableError {
  message?: string;
  digest?: string;
}

/**
 * React replaces server error messages with this prefix in production, keeping
 * the real one server-side and handing the client only a `digest` to correlate
 * with the log. Rendering that placeholder to a user is worse than rendering
 * nothing, so it is filtered out here rather than at each call site.
 */
const REDACTED_PREFIX = "An error occurred in the Server";

export function isUsefulErrorMessage(message: string | undefined): boolean {
  const trimmed = message?.trim();
  return Boolean(trimmed) && !trimmed!.startsWith(REDACTED_PREFIX);
}

/**
 * The detail block under an error headline: the message when it says something,
 * the digest when there is one, and nothing at all when neither is useful.
 */
export function ErrorDetail({ error }: { error: DisplayableError }) {
  const message = error.message?.trim();
  const showMessage = isUsefulErrorMessage(message);

  if (!showMessage && !error.digest) return null;

  return (
    <div className="mt-4 rounded-md border border-border bg-canvas p-3 text-left">
      {showMessage && <p className="text-sm wrap-break-word text-accent">{message}</p>}
      {error.digest && (
        <p className="mt-1 font-mono text-xs text-muted">Reference: {error.digest}</p>
      )}
    </div>
  );
}

interface State {
  hasError: boolean;
  error: (Error & { digest?: string }) | null;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Changing this value resets the boundary (useful for route changes). */
  resetKey?: string | number;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (
      this.state.hasError &&
      prevProps.resetKey !== undefined &&
      this.props.resetKey !== undefined &&
      prevProps.resetKey !== this.props.resetKey
    ) {
      this.setState({ hasError: false, error: null });
    }
  }

  render() {
    if (this.state.hasError) {
      const error = this.state.error;
      return (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg bg-surface p-12 shadow-card">
          <p className="font-medium text-danger">Something went wrong</p>
          <p className="max-w-sm text-center text-sm text-muted">
            This part of the page failed to render. Retrying is safe — nothing was
            submitted.
          </p>
          {error && <ErrorDetail error={error} />}
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, error: null })}
            className="mt-2 rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-canvas"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
