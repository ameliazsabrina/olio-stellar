import type { Metadata } from "next";
import "./globals.css";
import { WalletProvider } from "../components/WalletProvider";
import { AppShell } from "../components/AppShell";

export const metadata: Metadata = {
  title: "Olio — private USDC payments",
  description: "Confidential USDC payment links on Stellar. Private by default, provable on demand."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="min-h-full">
      <body className="min-h-full bg-paper text-ink antialiased font-sans">
        <WalletProvider>
          <AppShell>{children}</AppShell>
        </WalletProvider>
      </body>
    </html>
  );
}
