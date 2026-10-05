import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { DashboardBackground } from "@/components/dashboard/DashboardBackground";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { DashboardTile } from "@/components/dashboard/DashboardTile";
import { IdentityVerificationBadge } from "@/components/dashboard/IdentityVerificationBadge";
import { publicIdSchema } from "@/server/modules/businesses/businesses.schema";
import { publicIdentity } from "@/server/modules/passport/passport.service";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Olio identity check",
  description: "Confirm whether Olio has verified this business identity.",
  robots: { index: false, follow: false },
};

export default async function PublicIdentityPage({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  const { publicId } = await params;
  const parsed = publicIdSchema.safeParse(publicId);
  const identity = parsed.success ? await publicIdentity(parsed.data) : null;

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
                {identity
                  ? "Identity verified by Olio"
                  : "No verified identity"}
              </h2>
            }
            content={
              <div className="mt-6 space-y-5">
                {identity ? (
                  <IdentityVerificationBadge
                    state="verified"
                    displayName={identity.displayName}
                    type={identity.type}
                    checkedAt={identity.checkedAt}
                    validUntil={identity.validUntil}
                    policyVersion={identity.policyVersion}
                  />
                ) : (
                  <p
                    className="max-w-md text-sm leading-6 text-brand-linen/70"
                    data-testid="public-identity-empty"
                  >
                    Olio has no published verification for this link. The badge
                    may be private, expired, suspended, or the link may be
                    incorrect.
                  </p>
                )}
                <p className="max-w-xl text-xs leading-5 text-brand-linen/60">
                  An Olio identity badge confirms that identity checks passed
                  Olio's policy at the time shown. It does not verify revenue,
                  customers, creditworthiness or legal compliance.
                </p>
              </div>
            }
          />
        </div>
      </DashboardShell>
    </DashboardBackground>
  );
}
