import { collectServerDiagnostics, isLoopbackHost } from "@/lib/diagnostics";

export const dynamic = "force-dynamic";

/**
 * The desktop app's log tails, for the setup page's "Copy diagnostics" (ROAD_TO_10 4.8).
 *
 * Served by the Next server rather than the backend on purpose: the page that needs it is the
 * one shown when the backend is *down*, and this process is the one still answering.
 *
 * A 404 — not a 403 — when this is not the desktop shell or the request is not from this
 * machine, so a web deployment looks like it has no such route. Both conditions are in
 * `lib/diagnostics.ts` with the reasons.
 */
export async function GET(request: Request): Promise<Response> {
  const notFound = () => new Response("Not found", { status: 404 });

  if (!isLoopbackHost(request.headers.get("host"))) return notFound();

  // `null` is "this server was not started by the desktop shell", decided in one place.
  const report = await collectServerDiagnostics(process.env);
  if (report === null) return notFound();

  return Response.json(report, { headers: { "Cache-Control": "no-store" } });
}
