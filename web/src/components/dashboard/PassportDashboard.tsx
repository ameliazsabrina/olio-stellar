"use client";
import { openVerification } from "../../features/verification/openVerification";

import { Check, Copy, Loader } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useVerification } from "../../features/verification/useVerification";
import { VERIFICATION_PATH } from "../../lib/auth-routes";
import { trpc } from "../../trpc/react";
import { Button } from "../ui/button";
import { DashboardPageHeader } from "./DashboardPageHeader";
import { DashboardTile } from "./DashboardTile";
import {
  type IdentityBadgeState,
  IdentityVerificationBadge,
} from "./IdentityVerificationBadge";
import { EligibilityBadge } from "./VerificationDashboard";

export function badgeStateFor(
  credential: { status: "active" | "suspended" | "expired" } | null | undefined,
): IdentityBadgeState {
  if (!credential) return "none";
  if (credential.status === "active") return "verified";
  return credential.status;
}

export function PassportDashboard() {
  const { business, businessesLoading, status } = useVerification();
  const utils = trpc.useUtils();
  const businessId = business?.businessId ?? null;
  const identity = trpc.passport.identity.useQuery(
    { businessId: businessId ?? "" },
    { enabled: businessId !== null },
  );
  const setVisibility = trpc.passport.setVisibility.useMutation({
    onSuccess: (next) => {
      if (businessId) utils.passport.identity.setData({ businessId }, next);
    },
  });
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const preview = identity.data ?? null;
  const badgeState = badgeStateFor(preview?.credential);
  const published = Boolean(preview?.credential?.published);
  const publicUrl = preview?.publicPath ? `${origin}${preview.publicPath}` : "";

  async function toggle(next: boolean) {
    if (!businessId) return;
    try {
      await setVisibility.mutateAsync({ businessId, published: next });
      toast.success(next ? "Badge published" : "Badge hidden");
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "Visibility could not be changed.",
      );
    }
  }

  async function copy() {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Copy failed. Select the link and copy it manually.");
    }
  }

  return (
    <>
      <DashboardPageHeader
        title="Passport"
        description="Your verified identity claim. Private by default; publish it only when you want customers to see it."
      />

      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-4 pb-16 md:grid-cols-2 lg:grid-cols-12 lg:gap-5">
        <section
          className="min-w-0 lg:col-span-7"
          aria-labelledby="passport-claim-heading"
        >
          <DashboardTile
            appearance="glass"
            className="min-h-[19rem] text-brand-linen"
            header={
              <div className="flex items-start justify-between gap-4">
                <h2
                  id="passport-claim-heading"
                  className="dashboard-tile-title text-brand-linen"
                >
                  Identity claim
                </h2>
                {status ? (
                  <EligibilityBadge eligibility={status.eligibility} />
                ) : null}
              </div>
            }
            content={
              <div className="mt-6">
                {businessesLoading || (businessId && identity.isLoading) ? (
                  <div
                    role="status"
                    aria-busy="true"
                    aria-label="Loading passport"
                    className="h-32 rounded-[1.5rem] bg-brand-linen/8 motion-safe:animate-pulse"
                  />
                ) : preview ? (
                  <IdentityVerificationBadge
                    state={badgeState}
                    displayName={preview.displayName}
                    type={preview.type}
                    checkedAt={preview.credential?.checkedAt ?? null}
                    validUntil={preview.credential?.validUntil ?? null}
                    policyVersion={preview.credential?.policyVersion ?? null}
                  />
                ) : (
                  <p className="max-w-md text-sm leading-6 text-brand-linen/70">
                    No verified identity yet. Complete verification to create a
                    claim you can choose to publish.
                  </p>
                )}
              </div>
            }
            footer={
              badgeState !== "verified" ? (
                <Link
                  href={VERIFICATION_PATH}
                  onClick={(event) => {
                    event.preventDefault();
                    openVerification();
                  }}
                  className="inline-flex h-10 items-center rounded-full bg-brand-linen/16 px-4 text-sm font-semibold text-brand-linen ring-1 ring-brand-linen/25 hover:bg-brand-linen/24 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-linen"
                >
                  Go to verification
                </Link>
              ) : (
                <p className="text-xs text-brand-linen/75">
                  This claim covers identity only. It says nothing about
                  revenue, customers or creditworthiness.
                </p>
              )
            }
          />
        </section>

        <section
          className="min-w-0 lg:col-span-5"
          aria-labelledby="passport-visibility-heading"
        >
          <DashboardTile
            appearance="linen"
            className="min-h-[19rem]"
            header={
              <h2
                id="passport-visibility-heading"
                className="dashboard-tile-title"
              >
                Who can see it
              </h2>
            }
            content={
              <div className="mt-6 space-y-4 text-sm leading-6">
                <p className="text-muted-foreground">
                  {published
                    ? "Your badge is public. Anyone with the link below can confirm that Olio verified this identity."
                    : "Your badge is private. Only you can see it until you publish it."}
                </p>
                {publicUrl ? (
                  <div className="flex items-center gap-2">
                    <code
                      className="min-w-0 flex-1 truncate rounded-lg bg-foreground/6 px-3 py-2 font-mono text-xs"
                      data-testid="public-identity-url"
                    >
                      {publicUrl}
                    </code>
                    <Button
                      variant="outline"
                      size="icon-sm"
                      onClick={copy}
                      aria-label={copied ? "Link copied" : "Copy public link"}
                    >
                      {copied ? (
                        <Check className="size-4" aria-hidden="true" />
                      ) : (
                        <Copy className="size-4" aria-hidden="true" />
                      )}
                    </Button>
                  </div>
                ) : null}
              </div>
            }
            footer={
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant={published ? "outline" : "default"}
                  onClick={() => toggle(!published)}
                  disabled={
                    setVisibility.isPending ||
                    !preview ||
                    (!published && !preview.publishable)
                  }
                  aria-busy={setVisibility.isPending}
                  aria-pressed={published}
                >
                  {setVisibility.isPending ? (
                    <Loader
                      className="size-4 animate-spin"
                      aria-hidden="true"
                    />
                  ) : null}
                  {published ? "Hide badge" : "Publish badge"}
                </Button>
                {preview && !preview.publishable ? (
                  <p className="text-xs text-muted-foreground">
                    Publishing unlocks once verification is approved and
                    current.
                  </p>
                ) : null}
              </div>
            }
          />
        </section>

        <section
          className="min-w-0 md:col-span-2 lg:col-span-12"
          aria-labelledby="passport-scope-heading"
        >
          <DashboardTile
            appearance="linen"
            className="min-h-0"
            header={
              <h2 id="passport-scope-heading" className="dashboard-tile-title">
                What this badge means
              </h2>
            }
            content={
              <div className="mt-5 grid gap-4 text-sm leading-6 text-muted-foreground sm:grid-cols-3">
                <p>
                  <span className="font-semibold text-foreground">
                    Verified:{" "}
                  </span>
                  identity documents and checks passed Olio's policy at the time
                  shown.
                </p>
                <p>
                  <span className="font-semibold text-foreground">
                    Not verified:{" "}
                  </span>
                  revenue, customer relationships, creditworthiness or legal
                  compliance in any jurisdiction.
                </p>
                <p>
                  <span className="font-semibold text-foreground">
                    Kept current:{" "}
                  </span>
                  Olio re-checks the result on a schedule and hides the badge if
                  it lapses, is suspended, or the linked account changes.
                </p>
              </div>
            }
          />
        </section>
      </div>
    </>
  );
}
