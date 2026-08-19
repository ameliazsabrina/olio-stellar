"use client";

import { getAccessToken } from "@privy-io/react-auth";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { DASHBOARD_PATH, SIGN_IN_PATH } from "../../lib/auth-routes";

function safeRedirect(value: string | null): string {
  if (!value?.startsWith("/") || value.startsWith("//")) {
    return DASHBOARD_PATH;
  }
  return value;
}

function RefreshSession() {
  const router = useRouter();
  const searchParams = useSearchParams();
  useEffect(() => {
    let cancelled = false;
    getAccessToken()
      .then((token) => {
        if (!cancelled) {
          router.replace(
            token
              ? safeRedirect(searchParams.get("redirect_uri"))
              : SIGN_IN_PATH,
          );
        }
      })
      .catch(() => {
        if (!cancelled) router.replace(SIGN_IN_PATH);
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
