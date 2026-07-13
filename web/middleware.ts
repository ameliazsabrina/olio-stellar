import { type NextRequest, NextResponse } from "next/server";
import {
  DASHBOARD_PATH,
  isAuthOnlyPublicRoute,
  isProtectedRoute,
  PASSKEY_SESSION_COOKIE,
  SIGN_IN_PATH,
} from "./src/lib/auth-routes";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasPasskeySession = Boolean(
    request.cookies.get(PASSKEY_SESSION_COOKIE)?.value,
  );

  if (isProtectedRoute(pathname) && !hasPasskeySession) {
    return NextResponse.redirect(new URL(SIGN_IN_PATH, request.url));
  }

  if (isAuthOnlyPublicRoute(pathname) && hasPasskeySession) {
    return NextResponse.redirect(new URL(DASHBOARD_PATH, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/dashboard/:path*"],
};
