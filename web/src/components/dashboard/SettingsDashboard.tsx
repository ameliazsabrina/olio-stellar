"use client";
import { openVerification } from "../../features/verification/openVerification";

import {
  Check,
  KeyRound,
  Loader,
  LockKeyhole,
  LogOut,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { useChangeRecoveryPin } from "../../features/recovery/hooks/useChangeRecoveryPin";
import { useVerification } from "../../features/verification/useVerification";
import { PASSPORT_PATH, VERIFICATION_PATH } from "../../lib/auth-routes";
import { cn } from "../../lib/utils";
import { trpc } from "../../trpc/react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { useWallet } from "../WalletProvider";
import { ChangeRecoveryPinDialog } from "./ChangeRecoveryPinDialog";
import { DashboardPageHeader } from "./DashboardPageHeader";
import { DashboardTile } from "./DashboardTile";
import { EligibilityBadge } from "./VerificationDashboard";
import { ELIGIBILITY_HEADLINES } from "./verificationCopy";

export function SettingsDashboard() {
  const { username, disconnect } = useWallet();
  const [changePinOpen, setChangePinOpen] = useState(false);
  const { changeRecoveryPin, validateCurrentPin, isChanging } =
    useChangeRecoveryPin();
  const escrowQuery = trpc.wallets.getEscrow.useQuery();

  return (
    <>
      <DashboardPageHeader
        title="Settings"
        description="The essentials for your Olio account, explained without the crypto jargon."
      />

      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-4 pb-16 md:grid-cols-2 lg:grid-cols-12 lg:gap-5">
        <IdentityTile username={username} />
        <RecoveryTile
          protectedRecovery={Boolean(escrowQuery.data)}
          loading={escrowQuery.isLoading}
          onChangePin={() => setChangePinOpen(true)}
        />
        <IdentityVerificationTile />
        <SessionTile onSignOut={disconnect} />
      </div>

      <ChangeRecoveryPinDialog
        open={changePinOpen}
        onOpenChange={setChangePinOpen}
        onSubmit={changeRecoveryPin}
        onValidateCurrentPin={validateCurrentPin}
        isChanging={isChanging}
        onSuccess={() => {
          void escrowQuery.refetch();
          toast.success("Recovery PIN changed");
        }}
      />
    </>
  );
}

function IdentityTile({ username }: { username: string | null }) {
  return (
    <section className="min-w-0 lg:col-span-5">
      <DashboardTile
        appearance="linen"
        className="min-h-[19rem]"
        header={
          <TileHeading
            icon={<UserRound className="size-5" aria-hidden="true" />}
            title="Account handle"
          />
        }
        content={
          <div className="mt-8">
            <p className="truncate font-heading text-4xl font-semibold tracking-tight sm:text-5xl">
              {username ? `@${username}` : "No handle yet"}
            </p>
            <p className="mt-4 max-w-md text-sm leading-6 text-muted-foreground">
              This is the public name people use to pay you. It does not reveal
              your balance or payment history.
            </p>
          </div>
        }
        footer={
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <LockKeyhole className="size-3.5" aria-hidden="true" />
            Your handle is permanent and cannot be renamed.
          </div>
        }
      />
    </section>
  );
}

function RecoveryTile({
  protectedRecovery,
  loading,
  onChangePin,
}: {
  protectedRecovery: boolean;
  loading: boolean;
  onChangePin: () => void;
}) {
  return (
    <section className="min-w-0 lg:col-span-7">
      <DashboardTile
        appearance="glass"
        className="min-h-[19rem] text-brand-linen"
        header={
          <div className="flex items-start justify-between gap-4">
            <TileHeading
              inverse
              icon={<KeyRound className="size-5" aria-hidden="true" />}
              title="Recovery PIN"
            />
            {loading ? (
              <Badge appearance="glass" className="gap-1.5">
                <Loader className="size-3 animate-spin" aria-hidden="true" />
                Checking
              </Badge>
            ) : protectedRecovery ? (
              <Badge variant="success">
                <Check className="size-3" aria-hidden="true" />
                Ready
              </Badge>
            ) : (
              <Badge variant="danger">Needs attention</Badge>
            )}
          </div>
        }
        content={
          <div className="mt-8 max-w-xl">
            <p className="font-heading text-3xl font-semibold tracking-tight">
              {loading
                ? "Checking your recovery setup…"
                : protectedRecovery
                  ? "Protected by your recovery PIN"
                  : "Set up your recovery PIN"}
            </p>
            <p className="mt-4 text-sm leading-6 text-brand-linen/70">
              {protectedRecovery
                ? "Your PIN lets you restore access on another device. Olio never sees or stores the PIN itself."
                : "Without a recovery PIN, moving to a new device could leave you unable to access your funds."}
            </p>
          </div>
        }
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3">
            {protectedRecovery && !loading ? (
              <Button variant="glass" onClick={onChangePin}>
                Change PIN
              </Button>
            ) : null}
          </div>
        }
      />
    </section>
  );
}

function IdentityVerificationTile() {
  const { business, status, businessesLoading, statusLoading } =
    useVerification();
  const loading = businessesLoading || statusLoading;
  const eligibility = status?.eligibility ?? "not_started";
  const credential = status?.credential ?? null;

  return (
    <section className="min-w-0 lg:col-span-7">
      <DashboardTile
        appearance="linen"
        className="min-h-[19rem]"
        header={
          <div className="flex items-start justify-between gap-4">
            <TileHeading
              icon={<ShieldCheck className="size-5" aria-hidden="true" />}
              title="Identity verification"
            />
            {loading ? (
              <Badge variant="outline" className="gap-1.5">
                <Loader className="size-3 animate-spin" aria-hidden="true" />
                Checking
              </Badge>
            ) : business ? (
              <EligibilityBadge eligibility={eligibility} />
            ) : (
              <Badge variant="outline">Not started</Badge>
            )}
          </div>
        }
        content={
          <div className="mt-8 max-w-xl">
            <p className="font-heading text-3xl font-semibold tracking-tight">
              {loading
                ? "Checking your verification…"
                : business
                  ? ELIGIBILITY_HEADLINES[eligibility]
                  : "Verify once, reuse everywhere"}
            </p>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              {credential?.status === "active"
                ? credential.published
                  ? "Your Identity Verified badge is published."
                  : "Your identity is verified. The badge stays private until you publish it."
                : "Verify yourself or your company to unlock an Identity Verified badge you control."}
            </p>
          </div>
        }
        footer={
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href={VERIFICATION_PATH}
              onClick={(event) => {
                event.preventDefault();
                openVerification();
              }}
              className="inline-flex h-10 items-center rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {business ? "Open verification" : "Start verification"}
            </Link>
            {credential?.status === "active" ? (
              <Link
                href={PASSPORT_PATH}
                className="inline-flex h-10 items-center rounded-lg border border-border px-3 text-sm font-semibold hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Manage badge
              </Link>
            ) : null}
          </div>
        }
      />
    </section>
  );
}

function SessionTile({ onSignOut }: { onSignOut: () => Promise<void> }) {
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  async function confirmSignOut() {
    setSigningOut(true);
    try {
      await onSignOut();
    } finally {
      setSigningOut(false);
      setSignOutOpen(false);
    }
  }

  return (
    <section className="min-w-0 lg:col-span-5">
      <DashboardTile
        appearance="glass"
        className="min-h-[19rem] text-brand-linen"
        header={
          <TileHeading
            inverse
            icon={<LogOut className="size-5" aria-hidden="true" />}
            title="Your session"
          />
        }
        content={
          <p className="mt-8 max-w-md text-sm leading-6 text-brand-linen/70">
            Signing out removes access from this device. It does not delete your
            account, payment history, or funds.
          </p>
        }
        footer={
          <Button variant="glass" onClick={() => setSignOutOpen(true)}>
            <LogOut className="size-4" aria-hidden="true" />
            Sign out on this device
          </Button>
        }
      />

      <Dialog open={signOutOpen} onOpenChange={setSignOutOpen}>
        <DialogContent appearance="linen" size="sm">
          <DialogHeader>
            <DialogTitle>Sign out of Olio?</DialogTitle>
            <DialogDescription>
              This removes access from this device. Your account and funds stay
              safe, and you can return with your recovery PIN.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose
              render={<Button variant="outline" disabled={signingOut} />}
            >
              Cancel
            </DialogClose>
            <Button
              variant="destructive"
              onClick={confirmSignOut}
              disabled={signingOut}
              aria-busy={signingOut}
            >
              {signingOut ? (
                <Loader className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <LogOut className="size-4" aria-hidden="true" />
              )}
              {signingOut ? "Signing out…" : "Sign out"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function TileHeading({
  icon,
  title,
  inverse = false,
}: {
  icon: ReactNode;
  title: string;
  inverse?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <span
        className={cn(
          "flex size-11 shrink-0 items-center justify-center rounded-2xl ring-1",
          inverse
            ? "bg-brand-linen/10 text-brand-linen ring-brand-linen/15"
            : "bg-foreground/8 text-foreground ring-foreground/10",
        )}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <h2 className="mt-1 font-heading text-2xl font-semibold tracking-tight">
          {title}
        </h2>
      </div>
    </div>
  );
}
