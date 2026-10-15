"use client";

import { getAccessToken } from "@privy-io/react-auth";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import {
  DASHBOARD_PATH,
  PRIVY_ACCESS_TOKEN_COOKIE,
  PRIVY_SESSION_COOKIE,
  SIGN_IN_PATH,
} from "../../lib/auth-routes";

function safeRedirect(value: string | null): string {
  if (!value?.startsWith("/") || value.startsWith("//")) {
    return DASHBOARD_PATH;
  }
  return value;
}

// A session cookie Privy can no longer refresh would make the middleware
// bounce "/" straight back here, so drop it before going to sign-in.
function clearStaleSessionCookies() {
  for (const name of [PRIVY_SESSION_COOKIE, PRIVY_ACCESS_TOKEN_COOKIE]) {
    document.cookie = `${name}=; Max-Age=0; path=/`;
  }
}

function RefreshSession() {
  const router = useRouter();
  const searchParams = useSearchParams();
  useEffect(() => {
    let cancelled = false;
    const signIn = () => {
      clearStaleSessionCookies();
      router.replace(SIGN_IN_PATH);
    };
    getAccessToken()
      .then((token) => {
        if (cancelled) return;
        if (token)
          router.replace(safeRedirect(searchParams.get("redirect_uri")));
        else signIn();
      })
      .catch(() => {
        if (!cancelled) signIn();
      });
    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  return (
    <main className="grid min-h-svh place-items-center" aria-live="polite">
      <p>Refreshing your secure session…</p>
    </main>
  );
}

export default function RefreshPage() {
  return (
    <Suspense
      fallback={
        <main className="grid min-h-svh place-items-center" aria-live="polite">
          <p>Refreshing your secure session…</p>
        </main>
      }
    >
      <RefreshSession />
    </Suspense>
  );
}
