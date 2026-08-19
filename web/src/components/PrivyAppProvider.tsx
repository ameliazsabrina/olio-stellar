"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import type { ReactNode } from "react";
import { env } from "@/env";

// Privy validates the ID during server rendering. A non-secret, inert 25-char
// placeholder keeps credential-free CI builds deterministic; the runtime UI
// still reports configuration/authentication errors until a real ID is set.
export const privyAppId =
  env.NEXT_PUBLIC_PRIVY_APP_ID || "olio_missing_privy_app_id";

export function PrivyAppProvider({ children }: { children: ReactNode }) {
  return (
    <PrivyProvider
      appId={privyAppId}
      config={{
        loginMethods: ["google", "github", "passkey", "email"],
        appearance: {
          theme: "dark",
          accentColor: "#91975b",
          landingHeader: "Sign in to Olio",
          loginMessage: "Use Google, GitHub, or a passkey.",
        },
        embeddedWallets: {
          ethereum: { createOnLogin: "off" },
          solana: { createOnLogin: "off" },
          showWalletUIs: true,
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
