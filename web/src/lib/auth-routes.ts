export const PRIVY_ACCESS_TOKEN_COOKIE = "privy-token";
export const PRIVY_SESSION_COOKIE = "privy-session";
export const DASHBOARD_PATH = "/dashboard";
export const LINKS_PATH = "/links";
export const WITHDRAW_PATH = "/withdraw";
export const HISTORY_PATH = "/history";
export const SETTINGS_PATH = "/settings";
export const VERIFICATION_PATH = "/verification";
export const PASSPORT_PATH = "/passport";
export const PUBLIC_BUSINESS_PATH = "/business";
export const SIGN_IN_PATH = "/";
export const REFRESH_PATH = "/refresh";

export const DASHBOARD_PATHS = [
  DASHBOARD_PATH,
  LINKS_PATH,
  WITHDRAW_PATH,
  HISTORY_PATH,
  SETTINGS_PATH,
  VERIFICATION_PATH,
  PASSPORT_PATH,
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
