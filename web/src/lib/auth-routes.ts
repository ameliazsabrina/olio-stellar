export const PASSKEY_SESSION_COOKIE = "olio.passkey.session";
export const DASHBOARD_PATH = "/dashboard";
export const SIGN_IN_PATH = "/";

const protectedRoutes = [DASHBOARD_PATH] as const;
const authOnlyPublicRoutes = [SIGN_IN_PATH] as const;

export function isProtectedRoute(pathname: string): boolean {
  return protectedRoutes.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

export function isAuthOnlyPublicRoute(pathname: string): boolean {
  return authOnlyPublicRoutes.includes(
    pathname as (typeof authOnlyPublicRoutes)[number],
  );
}
