import type { CatiaStatus } from "@/types/catia";

const BRIDGE_URL = process.env.NEXT_PUBLIC_CATIA_BRIDGE_URL ?? "http://localhost:9100";

export async function fetchCatiaStatus(): Promise<CatiaStatus> {
  const response = await fetch(`${BRIDGE_URL}/status`, {
    signal: AbortSignal.timeout(3000),
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Bridge returned ${response.status}`);
  return response.json() as Promise<CatiaStatus>;
}

export function catiaBridgeUrl(): string {
  return BRIDGE_URL;
}
