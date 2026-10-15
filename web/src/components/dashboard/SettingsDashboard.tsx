"use client";

import {
  BadgeCheck,
  Check,
  KeyRound,
  Loader,
  LogOut,
  type LucideIcon,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { type KeyboardEvent, type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { useChangeRecoveryPin } from "../../features/recovery/hooks/useChangeRecoveryPin";
import { openVerification } from "../../features/verification/openVerification";
import { useVerification } from "../../features/verification/useVerification";
import { PASSPORT_ANCHOR, VERIFICATION_PATH } from "../../lib/auth-routes";
import { cn } from "../../lib/utils";
import { trpc } from "../../trpc/react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
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
import { PassportTiles } from "./PassportTiles";
import { SettingsRow } from "./SettingsRow";
import { ELIGIBILITY_HEADLINES } from "./verificationCopy";

type SectionId = "account" | "security" | typeof PASSPORT_ANCHOR;

const SECTIONS: {
  id: SectionId;
  label: string;
  icon: LucideIcon;
  description: string;
}[] = [
  {
    id: "account",
    label: "Account",
    icon: UserRound,
    description: "How people find and pay you.",
  },
  {
    id: "security",
    label: "Security",
    icon: KeyRound,
    description: "Keep access to your funds on any device.",
  },
  {
    id: PASSPORT_ANCHOR,
    label: "Track Record",
    icon: BadgeCheck,
    description:
      "Your verified identity and the payments you received, ready to share.",
  },
];

const tabId = (id: SectionId) => `settings-tab-${id}`;
const panelId = (id: SectionId) => `settings-panel-${id}`;

// Links shared before the Track Record rename still use `#passport`.
const LEGACY_HASHES: Record<string, SectionId> = { passport: PASSPORT_ANCHOR };

function sectionFromHash(hash: string): SectionId | null {
  const raw = hash.replace(/^#/, "");
  const id = LEGACY_HASHES[raw] ?? raw;
  return SECTIONS.find((section) => section.id === id)?.id ?? null;
}

const LINK_PRIMARY =
  "inline-flex h-10 items-center rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

export function SettingsDashboard() {
  const { username, disconnect } = useWallet();
  const [active, setActive] = useState<SectionId>("account");
  const [changePinOpen, setChangePinOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const { changeRecoveryPin, validateCurrentPin, isChanging } =
    useChangeRecoveryPin();
  const escrowQuery = trpc.wallets.getEscrow.useQuery();

  // `/settings#track-record` and friends open the matching section.
  useEffect(() => {
    const sync = () => {
      const next = sectionFromHash(window.location.hash);
      if (next) setActive(next);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  // On phones the tabs scroll sideways; keep the selected one in view.
  useEffect(() => {
    document
      .getElementById(tabId(active))
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [active]);

  function select(id: SectionId) {
    setActive(id);
    window.history.replaceState(window.history.state, "", `#${id}`);
  }

  function onTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    const last = SECTIONS.length - 1;
    const moves: Record<string, number> = {
      ArrowDown: index + 1,
      ArrowRight: index + 1,
      ArrowUp: index - 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: last,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const target = SECTIONS[(next + SECTIONS.length) % SECTIONS.length];
    select(target.id);
    document.getElementById(tabId(target.id))?.focus();
  }

  const panels: Record<SectionId, ReactNode> = {
    account: (
      <>
        <SettingsRow
          title="Account handle"
          description="The public name people use to pay you. It does not reveal your balance or payment history."
          action={
            <p className="max-w-56 truncate font-heading text-lg font-semibold tracking-tight">
              {username ? `@${username}` : "No handle yet"}
            </p>
          }
        />
        <IdentityVerificationRow />
        <SettingsRow
          className="lg:hidden"
          title="Sign out on this device"
          description="Removes access from this device. It does not delete your account, payment history, or funds."
          action={
            <Button variant="outline" onClick={() => setSignOutOpen(true)}>
              <LogOut className="size-4" aria-hidden="true" />
              Sign out
            </Button>
          }
        />
      </>
    ),
    security: (
      <RecoveryRow
        protectedRecovery={Boolean(escrowQuery.data)}
        loading={escrowQuery.isLoading}
        onChangePin={() => setChangePinOpen(true)}
      />
    ),
    [PASSPORT_ANCHOR]: <PassportTiles />,
  };

  return (
    <>
      <DashboardPageHeader
        title="Settings"
        description="The essentials for your Olio account."
      />

      <Card
        appearance="linen"
        className="mb-16 gap-0 p-0 lg:min-h-[32rem] lg:flex-row"
      >
        <nav
          aria-label="Settings sections"
          className="flex flex-col border-b border-border-subtle p-3 lg:w-60 lg:shrink-0 lg:border-r lg:border-b-0 lg:p-5"
        >
          <div
            role="tablist"
            aria-label="Settings sections"
            className="-m-1 flex gap-1 overflow-x-auto p-1 [scrollbar-width:none] lg:flex-col lg:overflow-visible [&::-webkit-scrollbar]:hidden"
          >
            {SECTIONS.map(({ id, label, icon: Icon }, index) => {
              const selected = id === active;
              return (
                <button
                  key={id}
                  id={tabId(id)}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls={panelId(id)}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => select(id)}
                  onKeyDown={(event) => onTabKeyDown(event, index)}
                  className={cn(
                    "flex h-10 shrink-0 items-center gap-2.5 rounded-xl px-3 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                    selected
                      ? "bg-foreground/8 font-semibold text-foreground"
                      : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
                  )}
                >
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  {label}
                </button>
              );
            })}
          </div>

          <div className="mt-auto hidden pt-6 lg:block">
            <button
              type="button"
              onClick={() => setSignOutOpen(true)}
              className="flex h-10 w-full items-center gap-2.5 rounded-xl px-3 text-sm font-medium text-(--status-danger-fg) transition-colors hover:bg-(--status-danger-bg) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <LogOut className="size-4 shrink-0" aria-hidden="true" />
              Sign out
            </button>
          </div>
        </nav>

        <div className="min-w-0 flex-1 px-5 py-6 sm:px-8 sm:py-7">
          {SECTIONS.map(({ id, label, description }) => (
            <div
              key={id}
              id={panelId(id)}
              role="tabpanel"
              aria-labelledby={tabId(id)}
              hidden={id !== active}
            >
              <header className="border-b border-border-subtle pb-5">
                <h2 className="type-product-panel-title text-foreground">
                  {label}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {description}
                </p>
              </header>
              {panels[id]}
            </div>
          ))}
        </div>
      </Card>

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
      <SignOutDialog
        open={signOutOpen}
        onOpenChange={setSignOutOpen}
        onSignOut={disconnect}
      />
    </>
  );
}

function RecoveryRow({
  protectedRecovery,
  loading,
  onChangePin,
}: {
  protectedRecovery: boolean;
  loading: boolean;
  onChangePin: () => void;
}) {
  return (
    <SettingsRow
      title="Recovery PIN"
      description={
        loading
          ? "Checking your recovery setup…"
          : protectedRecovery
            ? "Your PIN lets you restore access on another device. Olio never sees or stores the PIN itself."
            : "Without a recovery PIN, moving to a new device could leave you unable to access your funds."
      }
      action={
        <>
          {loading ? (
            <Badge variant="outline" className="gap-1.5">
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
          {protectedRecovery && !loading ? (
            <Button variant="outline" onClick={onChangePin}>
              Change PIN
            </Button>
          ) : null}
        </>
      }
    />
  );
}

function IdentityVerificationRow() {
  const { business, status, businessesLoading, statusLoading } =
    useVerification();
  const loading = businessesLoading || statusLoading;
  const eligibility = status?.eligibility ?? "not_started";
  const credential = status?.credential ?? null;

  return (
    <SettingsRow
      title={
        loading
          ? "Checking your verification…"
          : business
            ? ELIGIBILITY_HEADLINES[eligibility]
            : "Verify once, reuse everywhere"
      }
      description={
        credential?.status === "active"
          ? "Your identity is verified. You can download a payment statement of your track record."
          : "Verify yourself or your company to unlock a payment statement of your track record."
      }
      action={
        <Link
          href={VERIFICATION_PATH}
          onClick={(event) => {
            event.preventDefault();
            openVerification();
          }}
          className={LINK_PRIMARY}
        >
          {business ? "Open verification" : "Start verification"}
        </Link>
      }
    />
  );
}

function SignOutDialog({
  open,
  onOpenChange,
  onSignOut,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSignOut: () => Promise<void>;
}) {
  const [signingOut, setSigningOut] = useState(false);

  async function confirmSignOut() {
    setSigningOut(true);
    try {
      await onSignOut();
    } finally {
      setSigningOut(false);
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
  );
}
