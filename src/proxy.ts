import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const hasSession =
    request.cookies.has("kryova_access") || request.cookies.has("kryova_refresh");
  const isAuthRoute = ["/login", "/register"].includes(request.nextUrl.pathname);

  if (!hasSession) {
    // /login and /register are the pages a signed-out visitor is supposed to
    // reach. Redirecting them to /login too would send /login to itself and
    // loop until the browser gives up.
    if (isAuthRoute) return NextResponse.next();

    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isAuthRoute) return NextResponse.redirect(new URL("/dashboard", request.url));
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/login", "/register"],
};
