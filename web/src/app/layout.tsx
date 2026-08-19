import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "../components/AppShell";
import { PrivyAppProvider } from "../components/PrivyAppProvider";
import { Toaster } from "../components/ui/sonner";
import { WalletProvider } from "../components/WalletProvider";
import { TRPCReactProvider } from "../trpc/react";

export const metadata: Metadata = {
  title: "Olio: private USDC payments",
  description:
    "Confidential USDC payment links on Stellar. Private by default, provable on demand.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="min-h-full font-sans">
      <body className="min-h-full bg-background text-foreground antialiased font-sans">
        <a
          href="#main-content"
          className="sr-only z-[100] rounded-lg bg-panel px-4 py-2 text-sm font-semibold text-ink shadow-lg focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Skip to main content
        </a>
        <PrivyAppProvider>
          <TRPCReactProvider>
            <WalletProvider>
              <AppShell>{children}</AppShell>
            </WalletProvider>
          </TRPCReactProvider>
        </PrivyAppProvider>
        <Toaster />
      </body>
    </html>
  );
}
