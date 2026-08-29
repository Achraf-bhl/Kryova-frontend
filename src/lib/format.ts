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
    default:
      return "text-muted";
  }
}
