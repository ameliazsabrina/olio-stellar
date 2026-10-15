import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { DashboardBackground } from "@/components/dashboard/DashboardBackground";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { DashboardTile } from "@/components/dashboard/DashboardTile";

// Identity badges are retired; old shared links land here instead of a 404.
export const metadata: Metadata = {
  title: "Olio identity check",
  description: "Olio no longer publishes identity badges.",
  robots: { index: false, follow: false },
};

export default function PublicIdentityPage() {
  return (
    <DashboardBackground>
      <DashboardShell contentClassName="flex min-h-svh max-w-3xl flex-col">
        <header className="mb-0 flex min-w-0 items-center justify-center">
          <Link href="/" aria-label="Olio home">
            <Image
              src="/assets/olio-white.svg"
              alt="Olio"
              width={40}
              height={40}
              className="size-16"
            />
          </Link>
        </header>
        <div className="grid flex-1 content-center gap-5 py-8">
          <h1 className="sr-only">Olio identity check</h1>
          <DashboardTile
            appearance="glass"
            className="min-h-0 text-brand-linen"
            header={
              <h2 className="dashboard-tile-title text-brand-linen">
                Identity badges are retired
              </h2>
            }
            content={
              <p
                className="mt-6 max-w-md text-sm leading-6 text-brand-linen/70"
                data-testid="public-identity-retired"
              >
                Olio no longer publishes identity badges, so this link does not
                confirm anything about the business. Ask the business for its
                Olio payment statement instead. You can check that PDF with
                Olio through the link printed on it.
              </p>
            }
          />
        </div>
      </DashboardShell>
    </DashboardBackground>
  );
}
