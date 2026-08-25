export type Platform = "macos" | "windows" | "linux" | "unknown";

export interface Prerequisite {
  id: string;
  label: string;
  description: string;
  check: () => Promise<boolean>;
  installHint: string;
  installUrl: string;
}

export function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("mac") || ua.includes("darwin")) return "macos";
  if (ua.includes("win")) return "windows";
  if (ua.includes("linux")) return "linux";
  return "unknown";
}

export const PREREQUISITES: Prerequisite[] = [
  {
    id: "browser",
    label: "Modern browser",
    description: "Chrome, Firefox, Safari, or Edge with WebGL support.",
    check: async () => {
      try {
        const canvas = document.createElement("canvas");
        return !!(canvas.getContext("webgl") || canvas.getContext("experimental-webgl"));
      } catch {
        return false;
      }
    },
    installHint: "Update your browser or enable hardware acceleration in settings.",
    installUrl: "https://get.webgl.org",
  },
  {
    id: "api",
    label: "Kryova API server",
    description: "The backend must be reachable at the configured URL.",
    check: async () => {
      try {
        const url = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";
        const response = await fetch(`${url.replace(/\/$/, "")}/materials`, {
          method: "GET",
          signal: AbortSignal.timeout(5000),
        });
        return response.ok;
      } catch {
        return false;
      }
    },
    installHint: "Start the backend with `uvicorn app.main:app --reload`.",
    installUrl: "https://fastapi.tiangolo.com/#installation",
  },
];

export interface HealthCheckResult {
  prerequisite: Prerequisite;
  ok: boolean;
  error?: string;
}

export async function runHealthChecks(): Promise<HealthCheckResult[]> {
  const results = await Promise.all(
    PREREQUISITES.map(async (prerequisite) => {
      try {
        const ok = await prerequisite.check();
        return { prerequisite, ok };
      } catch (error) {
        return { prerequisite, ok: false, error: error instanceof Error ? error.message : "Unknown error" };
      }
    }),
  );
  return results;
}
