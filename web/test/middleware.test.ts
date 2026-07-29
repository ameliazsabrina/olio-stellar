import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { middleware } from "../middleware";
import { PASSKEY_SESSION_COOKIE } from "../src/lib/auth-routes";

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

  it("redirects signed-in users from the public landing route to dashboard", () => {
    const response = middleware(
      request("/", `${PASSKEY_SESSION_COOKIE}=passkey`),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/dashboard",
    );
  });
});
