"use client";

import type { LucideIcon } from "lucide-react";
import {
  ArrowDownToLine,
  AtSign,
  Database,
  FileCheck,
  KeyRound,
  Link2,
  LockKeyhole,
  Network,
  QrCode,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { useWallet } from "../WalletProvider";
import { ActivityFeed } from "./ActivityFeed";
import { BalanceCard } from "./BalanceCard";
import { DashboardShell } from "./DashboardShell";
import { PersonalLinkCard } from "./PersonalLinkCard";
import { ReceiveDialog } from "./ReceiveDialog";
import { useMyNotes } from "./useMyNotes";
import { WithdrawDialog } from "./WithdrawDialog";

type FlowStep = {
  label: string;
  detail: string;
  icon: LucideIcon;
  action:
    | { kind: "receive"; label: string }
    | { kind: "withdraw"; label: string }
    | { kind: "badge"; label: string }
    | { kind: "link"; label: string; href: string };
};

const WORKFLOW_STEPS: FlowStep[] = [
  {
    label: "Receive",
    detail:
      "Share a link or QR — anyone, on any wallet, pays you confidential USDC.",
    icon: QrCode,
    action: { kind: "receive", label: "Create link" },
  },
  {
    label: "Balance",
    detail:
      "Your viewing key scans the pool and decrypts the payments only you can see.",
    icon: ShieldCheck,
    action: { kind: "badge", label: "Auto-scanned" },
  },
  {
    label: "Claim out",
    detail: "Prove a payment in-browser and release it to any Stellar wallet.",
    icon: ArrowDownToLine,
    action: { kind: "withdraw", label: "Cash out" },
  },
  {
    label: "Disclose",
    detail:
      "Generate a per-payment proof to show a bank, accountant, or auditor.",
    icon: FileCheck,
    action: { kind: "link", label: "Open ledger", href: "#activity" },
  },
];

function FlowCard({
  step,
  index,
  onReceive,
  onWithdraw,
  withdrawDisabled,
}: {
  step: FlowStep;
  index: number;
  onReceive: () => void;
  onWithdraw: () => void;
  withdrawDisabled: boolean;
}) {
  const Icon = step.icon;
  const { action } = step;
  return (
    <Card className="gap-4 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex size-9 items-center justify-center rounded-lg bg-sage text-olive-deep">
          <Icon className="size-4" aria-hidden="true" />
        </div>
        <span className="font-mono text-xs text-muted-text">0{index + 1}</span>
      </div>
      <div className="grid gap-1">
        <h3 className="font-heading text-base font-semibold text-ink">
          {step.label}
        </h3>
        <p className="text-sm leading-6 text-muted-text">{step.detail}</p>
      </div>
      {action.kind === "receive" && (
        <Button
          variant="default"
          size="sm"
          className="mt-auto w-fit"
          onClick={onReceive}
        >
          <Link2 className="size-3.5" aria-hidden="true" />
          {action.label}
        </Button>
      )}
      {action.kind === "withdraw" && (
        <Button
          variant="secondary"
          size="sm"
          className="mt-auto w-fit"
          onClick={onWithdraw}
          disabled={withdrawDisabled}
        >
          <ArrowDownToLine className="size-3.5" aria-hidden="true" />
          {action.label}
        </Button>
      )}
      {action.kind === "link" && (
        <Button
          variant="secondary"
          size="sm"
          className="mt-auto w-fit"
          nativeButton={false}
          render={<a href={action.href} />}
        >
          <FileCheck className="size-3.5" aria-hidden="true" />
          {action.label}
        </Button>
      )}
      {action.kind === "badge" && (
        <Badge variant="secondary" className="mt-auto w-fit rounded-full">
          {action.label}
        </Badge>
      )}
    </Card>
  );
}

function PrivacyStatus({ username }: { username: string }) {
  const rows = [
    {
      label: "Identity",
      value: username ? `@${username}` : "Username pending",
      icon: AtSign,
    },
    { label: "Auth", value: "Passkey ready", icon: KeyRound },
    { label: "Storage", value: "Mongo link metadata", icon: Database },
    { label: "Network", value: "Stellar testnet", icon: Network },
  ] as const;

  return (
    <Card className="gap-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-base font-semibold text-ink">
            System status
          </h2>
          <p className="mt-1 text-sm text-muted-text">
            What the dashboard depends on after onboarding.
          </p>
        </div>
        <LockKeyhole className="size-5 text-olive" aria-hidden="true" />
      </div>

      <div className="grid gap-2">
        {rows.map(({ label, value, icon: Icon }) => (
          <div
            key={label}
            className="flex items-center justify-between gap-3 rounded-lg border border-line/70 bg-sage/25 px-3 py-2.5"
          >
            <div className="flex items-center gap-2 text-sm text-muted-text">
              <Icon className="size-4 text-olive" aria-hidden="true" />
              {label}
            </div>
            <div className="max-w-36 truncate text-right text-sm font-medium text-ink">
              {value}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function Dashboard() {
  const { address, username } = useWallet();
  const [origin, setOrigin] = useState("");
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const { notes, claimable, loading, refresh } = useMyNotes(address);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const payLink = username && origin ? `${origin}/pay/${username}` : "";
  const hasNotes = claimable > 0n;

  return (
    <DashboardShell>
      <section className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="grid gap-2">
          <div className="text-xs font-semibold uppercase text-muted-text">
            Private account
          </div>
          <h1 className="font-heading text-3xl font-semibold leading-tight text-olive-deep md:text-4xl">
            Dashboard
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-text">
            Receive confidential USDC from anyone, hold it as private notes,
            then cash out to a wallet or prove a single payment on demand.
          </p>
        </div>
        <Badge
          variant="outline"
          className="w-fit rounded-full border-olive/25 bg-panel px-3 py-1.5 text-xs text-olive-deep"
        >
          {username ? `@${username}` : "Username pending"}
        </Badge>
      </section>

      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid gap-5">
          <BalanceCard
            claimable={claimable}
            loading={loading}
            onWithdraw={() => setWithdrawOpen(true)}
            onReceive={() => setReceiveOpen(true)}
          />

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {WORKFLOW_STEPS.map((step, index) => (
              <FlowCard
                key={step.label}
                step={step}
                index={index}
                onReceive={() => setReceiveOpen(true)}
                onWithdraw={() => setWithdrawOpen(true)}
                withdrawDisabled={!hasNotes || loading}
              />
            ))}
          </div>

          <ActivityFeed notes={notes} loading={loading} />
        </div>

        <aside className="grid content-start gap-5">
          <PersonalLinkCard username={username ?? ""} payLink={payLink} />
          <PrivacyStatus username={username ?? ""} />
        </aside>
      </section>

      <WithdrawDialog
        open={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
        notes={notes}
        onSuccess={refresh}
      />
      <ReceiveDialog
        open={receiveOpen}
        onClose={() => setReceiveOpen(false)}
        username={username ?? ""}
        origin={origin}
      />
    </DashboardShell>
  );
}
