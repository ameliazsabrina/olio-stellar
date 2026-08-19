import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { middleware } from "../middleware";
import {
  PRIVY_ACCESS_TOKEN_COOKIE,
  PRIVY_SESSION_COOKIE,
} from "../src/lib/auth-routes";

function request(pathname: string, cookie?: string) {
  return new NextRequest(`http://localhost:3000${pathname}`, {
    headers: cookie ? { cookie } : undefined,
  });
}

describe("route middleware", () => {
  it.each([
    "/dashboard",
    "/links",
    "/withdraw",
    "/history",
  ])("redirects unsigned users away from %s", (pathname) => {
    const response = middleware(request(pathname));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/");
  });

  it("redirects an access-token session from landing to dashboard", () => {
    const response = middleware(
      request("/", `${PRIVY_ACCESS_TOKEN_COOKIE}=access-token`),
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/dashboard",
    );
  });

  it("refreshes a cookie-backed session before entering a protected route", () => {
    const response = middleware(
      request("/links?tab=active", `${PRIVY_SESSION_COOKIE}=session`),
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/refresh?redirect_uri=%2Flinks%3Ftab%3Dactive",
    );
  });

  it("does not erase active Privy OAuth callback parameters", () => {
    expect(middleware(request("/?privy_oauth_code=code")).status).toBe(200);
  });
});
