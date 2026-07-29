export const PASSKEY_SESSION_COOKIE = "olio.passkey.session";
export const DASHBOARD_PATH = "/dashboard";
export const LINKS_PATH = "/links";
export const WITHDRAW_PATH = "/withdraw";
export const HISTORY_PATH = "/history";
export const SIGN_IN_PATH = "/";

export const DASHBOARD_PATHS = [
  DASHBOARD_PATH,
  LINKS_PATH,
  WITHDRAW_PATH,
  HISTORY_PATH,
] as const;
const authOnlyPublicRoutes = [SIGN_IN_PATH] as const;

export function isDashboardRoute(pathname: string): boolean {
  return DASHBOARD_PATHS.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

export const isProtectedRoute = isDashboardRoute;

export function isAuthOnlyPublicRoute(pathname: string): boolean {
  return authOnlyPublicRoutes.includes(
    pathname as (typeof authOnlyPublicRoutes)[number],
  );
}
