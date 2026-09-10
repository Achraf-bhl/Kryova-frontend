export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 1) return `${Math.round(seconds * 1000)} ms`;
  return `${seconds.toFixed(2)} s`;
}

/**
 * "3 minutes ago", from an ISO timestamp.
 *
 * Takes `now` so it is testable without freezing a clock, and defaults to the
 * reader's — which is the point: this is measured against the clock of whoever
 * is looking, the same reason `conversation-resume` is client-only.
 *
 * Deliberately not `Intl.RelativeTimeFormat` with a unit search: the units this
 * needs are few and the thresholds are a product decision (a session last used
 * 90 seconds ago should read "a minute ago", not "2 minutes ago").
 */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const seconds = Math.round((now.getTime() - then.getTime()) / 1000);
  if (Number.isNaN(seconds)) return "at an unknown time";
  if (seconds < 0) return "just now";
  if (seconds < 45) return "just now";
  if (seconds < 90) return "a minute ago";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? "an hour ago" : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return days === 1 ? "yesterday" : `${days} days ago`;
  const months = Math.round(days / 30);
  if (months < 12) return months === 1 ? "a month ago" : `${months} months ago`;
  const years = Math.round(months / 12);
  return years === 1 ? "a year ago" : `${years} years ago`;
}

/**
 * Tailwind token for a job status.
 *
 * Matches the API's lowercase spelling (see `types/api.ts` `JobStatus`). This
 * used to switch on uppercase names, so every branch was dead and every status
 * rendered `text-muted`.
 */
export function statusColor(status: string): string {
  switch (status) {
    case "succeeded":
      return "text-success";
    case "failed":
      return "text-danger";
    case "running":
      return "text-primary";
    // Explicit, though it is also what `default` gives: grey, never the red
    // `failed` gets. A run somebody stopped did what it was told, and colouring
    // it as a failure is how a cancellation ends up read as an incident (P5.6).
    case "cancelled":
      return "text-muted";
    default:
      return "text-muted";
  }
}
