import type { Metadata } from "next";
import "./globals.css";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";
import { AppShell } from "../components/AppShell";
import { Toaster } from "../components/ui/sonner";
import { WalletProvider } from "../components/WalletProvider";
import { TRPCReactProvider } from "../trpc/react";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Olio: private USDC payments",
  description:
    "Confidential USDC payment links on Stellar. Private by default, provable on demand.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={cn("min-h-full", "font-sans", geist.variable)}>
      <body className="min-h-full bg-paper text-ink antialiased font-sans">
        <TRPCReactProvider>
          <WalletProvider>
            <AppShell>{children}</AppShell>
          </WalletProvider>
        </TRPCReactProvider>
        <Toaster />
      </body>
    </html>
  );
}
