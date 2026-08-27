import { NextResponse } from "next/server";

const BRIDGE_URL = process.env.CATIA_BRIDGE_INTERNAL_URL ?? "http://localhost:9100";

export async function GET(): Promise<Response> {
  try {
    const upstream = await fetch(`${BRIDGE_URL}/events`, {
      headers: { accept: "text/event-stream" },
      cache: "no-store",
    });

    if (!upstream.ok || !upstream.body) {
      return NextResponse.json(
        { detail: `CATIA bridge returned ${upstream.status}` },
        { status: upstream.status },
      );
    }

    return new Response(upstream.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch {
    return NextResponse.json(
      { detail: "CATIA bridge is unreachable." },
      { status: 502 },
    );
  }
}
