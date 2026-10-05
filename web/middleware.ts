import { type NextRequest, NextResponse } from "next/server";
import {
  DASHBOARD_PATH,
  isAuthOnlyPublicRoute,
  isProtectedRoute,
  PRIVY_ACCESS_TOKEN_COOKIE,
  PRIVY_SESSION_COOKIE,
  REFRESH_PATH,
  SIGN_IN_PATH,
} from "./src/lib/auth-routes";

const OAUTH_QUERY_KEYS = [
  "privy_oauth_code",
  "privy_oauth_state",
  "privy_oauth_provider",
] as const;

export function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  if (
    pathname === REFRESH_PATH ||
    OAUTH_QUERY_KEYS.some((key) => searchParams.has(key))
  ) {
    return NextResponse.next();
  }

  const hasAccessToken = Boolean(
    request.cookies.get(PRIVY_ACCESS_TOKEN_COOKIE)?.value,
  );
  const hasSession = Boolean(request.cookies.get(PRIVY_SESSION_COOKIE)?.value);

  if (isProtectedRoute(pathname) && !hasAccessToken) {
    if (hasSession) {
      const target = `${pathname}${request.nextUrl.search}`;
      const refresh = new URL(REFRESH_PATH, request.url);
      refresh.searchParams.set("redirect_uri", target);
      return NextResponse.redirect(refresh);
    }
    return NextResponse.redirect(new URL(SIGN_IN_PATH, request.url));
  }

  if (isAuthOnlyPublicRoute(pathname) && (hasAccessToken || hasSession)) {
    if (!hasAccessToken && hasSession) {
      const refresh = new URL(REFRESH_PATH, request.url);
      refresh.searchParams.set("redirect_uri", DASHBOARD_PATH);
      return NextResponse.redirect(refresh);
    }
    return NextResponse.redirect(new URL(DASHBOARD_PATH, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/refresh",
    "/dashboard/:path*",
    "/links/:path*",
    "/withdraw/:path*",
    "/history/:path*",
    "/settings/:path*",
    "/verification/:path*",
    "/passport/:path*",
  ],
};
