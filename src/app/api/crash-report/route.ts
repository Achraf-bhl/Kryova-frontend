import { isAcceptableEndpoint, MAX_REPORT_BYTES, reportBytes } from "@/lib/crash-report";
import { collectServerDiagnostics, isLoopbackHost, redact } from "@/lib/diagnostics";

export const dynamic = "force-dynamic";

/**
 * Where a crash report the person chose to send goes (ROAD_TO_10 9.2).
 *
 * - `GET` — what the dialog needs before it opens: is a destination configured, and the log
 *   tails to put in the preview. The destination is `KRYOVA_CRASH_REPORT_URL`, which only the
 *   deployment sets; **with it unset nothing can be sent and the dialog says so** (the report
 *   can still be copied). The URL itself is never returned, only whether it exists.
 * - `POST` — `{ report, consent: true }`. Refused without the literal `consent: true`, refused
 *   over the size cap, scrubbed again here (the browser's scrub is a courtesy; this one is the
 *   lock), and forwarded once. No retry: a report is not worth a loop.
 *
 * 404 unless this is the desktop shell and the request is from this machine, the same two
 * conditions as `/api/diagnostics`, for the same reasons.
 */
export async function GET(request: Request): Promise<Response> {
  if (!isLoopbackHost(request.headers.get("host"))) return new Response("Not found", { status: 404 });
  const diagnostics = await collectServerDiagnostics(process.env);
  if (diagnostics === null) return new Response("Not found", { status: 404 });
  return Response.json(
    {
      configured: isAcceptableEndpoint(process.env.KRYOVA_CRASH_REPORT_URL),
      logs: diagnostics.logs.map(({ name, tail }) => ({ name, tail })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request): Promise<Response> {
  const notFound = () => new Response("Not found", { status: 404 });
  if (!isLoopbackHost(request.headers.get("host"))) return notFound();
  if (process.env.KRYOVA_DESKTOP !== "1") return notFound();

  const endpoint = process.env.KRYOVA_CRASH_REPORT_URL;
  if (!endpoint || !isAcceptableEndpoint(endpoint)) {
    return Response.json(
      { error: "This install has no place to send reports. Copy the report instead." },
      { status: 501 },
    );
  }

  let body: { report?: unknown; consent?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "The request was not JSON." }, { status: 400 });
  }
  if (body.consent !== true) {
    return Response.json({ error: "A report is sent only with the person's consent." }, { status: 400 });
  }
  if (typeof body.report !== "string" || body.report.length === 0) {
    return Response.json({ error: "There is no report to send." }, { status: 400 });
  }
  if (reportBytes(body.report) > MAX_REPORT_BYTES) {
    return Response.json({ error: "The report is larger than 256 KiB." }, { status: 413 });
  }

  try {
    const sent = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: redact(body.report),
      signal: AbortSignal.timeout(15_000),
    });
    if (!sent.ok) {
      return Response.json({ error: `The report server answered ${sent.status}.` }, { status: 502 });
    }
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "The report could not be sent." },
      { status: 502 },
    );
  }
  return Response.json({ sent: true });
}
