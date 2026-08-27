"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import type { ReactNode } from "react";
import { env } from "@/env";

export const privyAppId =
  env.NEXT_PUBLIC_PRIVY_APP_ID || "olio_missing_privy_app_id";

export function PrivyAppProvider({ children }: { children: ReactNode }) {
  return (
    <PrivyProvider
      appId={privyAppId}
      config={{
        loginMethods: ["google", "passkey", "email"],
        appearance: {
          theme: "dark",
          accentColor: "#91975b",
          landingHeader: "Sign in to Olio",
          loginMessage: "Use Email, Google,or a passkey.",
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
