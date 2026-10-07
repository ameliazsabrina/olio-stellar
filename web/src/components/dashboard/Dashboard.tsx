"use client";

import {
  ArrowUpRight,
  Check,
  Copy,
  ExternalLink,
  Plus,
  QrCode,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import {
  type ForwardedRef,
  forwardRef,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { fromBaseUnits } from "../../lib/crypto";
import {
  HISTORY_PATH,
  LINKS_PATH,
  WITHDRAW_PATH,
} from "../../lib/auth-routes";
import type { MyNote } from "../../lib/notes";
import { cn } from "../../lib/utils";
import { trpc } from "../../trpc/react";
import { useWallet } from "../WalletProvider";
import { BalanceCard, checkedAgo } from "./BalanceCard";
import { DashboardTile } from "./DashboardTile";
import {
  type LinkStatusSummary,
  linkStatusSummary,
  topPaidLinks,
  weeklyActivity,
} from "./dashboardAnalytics";
import { LinkEditorDialog } from "./LinkEditorDialog";
import { PaymentQrDialog } from "./PaymentQrDialog";
import { useMyNotes } from "./useMyNotes";

const tileFocus =
  "group block min-h-full rounded-[1.75rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-linen focus-visible:ring-offset-4 focus-visible:ring-offset-brand-obsidian";
const bodySmall = "text-[0.8125rem] leading-[1.1875rem]";
const caption = "text-xs leading-[1.0625rem]";

export function formatUsd(units: bigint): string {
  return Number(fromBaseUnits(units)).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatWhen(iso: string | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const day = date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
  });
  const time = date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${day}, ${time}`;
}

export function Dashboard() {
  const { address, username, accountUnlocked, promptUnlock } = useWallet();
  const [origin, setOrigin] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [amountsHidden, setAmountsHidden] = useState(false);
  const {
    notes,
    claimable,
    poolSize,
    loading,
    refreshing,
    stale,
    indexedAt,
    refresh,
  } = useMyNotes(accountUnlocked ? address : undefined);
  const links = trpc.paymentLinks.listByOwner.useQuery(
    { owner: username ?? "" },
    { enabled: Boolean(username) },
  );
  const insight = useMemo(() => weeklyActivity(notes), [notes]);
  const statusSummary = useMemo(
    () => linkStatusSummary(links.data ?? []),
    [links.data],
  );
  const topLinks = useMemo(() => topPaidLinks(links.data ?? []), [links.data]);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const payLink = username && origin ? `${origin}/pay/${username}` : "";
  const locked = Boolean(address) && !accountUnlocked;
  const privateReady = !locked && !loading;
  const money = (units: bigint) => (amountsHidden ? "••••" : formatUsd(units));

  return (
    <>
      <div className="dashboard-bento grid grid-cols-1 gap-4 pb-6 md:grid-cols-2 lg:grid-cols-4 lg:gap-5">
        <section aria-label="Account summary" className="min-w-0">
          <BalanceCard
            claimable={claimable}
            loading={loading}
            locked={locked}
            onUnlock={promptUnlock}
            onRefresh={refresh}
            refreshing={refreshing}
            stale={stale}
            indexedAt={indexedAt}
            amountsHidden={amountsHidden}
            onToggleAmounts={() => setAmountsHidden((hidden) => !hidden)}
          />
        </section>

        <AddCashTile payLink={payLink} />

        <section className="min-w-0 md:col-span-2">
          <PayMeTile payLink={payLink} />
        </section>

        <Link
          href={HISTORY_PATH}
          className={tileFocus}
          aria-label="Open Disclosures"
        >
          <DashboardTile
            appearance="glass"
            className="dashboard-nav-card justify-between text-brand-linen"
            header={
              <TileHeading
                title="Disclosures"
                arrow="light"
                description="Share evidence of one payment as a PDF, like a receipt. Nothing else is shared."
              />
            }
            footer={
              <Stat
                value={privateReady ? notes.length : "—"}
                label={
                  <>
                    Payments you
                    <br />
                    can disclose
                  </>
                }
                tone="glass"
              />
            }
          />
        </Link>

        <section className="min-w-0">
          <DashboardTile
            appearance="linen"
            header={
              <div className="flex h-10 items-center">
                <h2 className="dashboard-tile-title">This week</h2>
              </div>
            }
            content={
              <div className="mt-3">
                <WeeklyChart buckets={privateReady ? insight.buckets : []} />
              </div>
            }
            footer={
              <div className="flex items-center gap-4">
                <Stat
                  value={privateReady ? insight.received : "—"}
                  label="Received"
                />
                <Stat
                  value={privateReady ? insight.cashedOut : "—"}
                  label="Withdrawn"
                />
              </div>
            }
          />
        </section>

        <Link
          href={WITHDRAW_PATH}
          className={tileFocus}
          aria-label="Open Withdraw"
        >
          <DashboardTile
            appearance="linen"
            className="dashboard-nav-card"
            header={
              <TileHeading
                title="Withdraw"
                arrow="dark"
                description="Send money to any Stellar wallet, or to a bank account."
              />
            }
            footer={
              <div className="flex flex-wrap gap-1.5">
                <Chip>Stellar wallet</Chip>
                <Chip>Bank account</Chip>
              </div>
            }
          />
        </Link>

        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          disabled={!username}
          className={`${tileFocus} w-full text-left disabled:cursor-not-allowed disabled:opacity-55`}
          aria-label="Create a payment link"
        >
          <DashboardTile
            appearance="glass"
            className="dashboard-nav-card items-center justify-between text-center text-brand-linen"
            header={<Plus className="size-8" aria-hidden="true" />}
            content={
              <h2 className="dashboard-tile-title">New payment link</h2>
            }
            footer={
              <span className={cn(bodySmall, "text-brand-linen/88")}>
                Make a link for one client or one job.
              </span>
            }
          />
        </button>

        <section className="min-w-0 md:col-span-2">
          <StatusTile
            summary={statusSummary}
            loading={links.isLoading && Boolean(username)}
            money={money}
          />
        </section>

        <section className="min-w-0 md:col-span-2">
          <RecentPaymentsTile
            notes={notes}
            ready={privateReady}
            locked={locked}
            onUnlock={promptUnlock}
            money={money}
          />
        </section>

        <section className="min-w-0 md:col-span-2">
          <TopLinksTile links={topLinks} money={money} />
        </section>

        <section className="min-w-0">
          <DashboardTile
            appearance="glass"
            className="min-h-75 text-brand-linen"
            header={
              <div className="grid gap-3">
                <div className="flex items-center gap-2.5">
                  <ShieldCheck className="size-5" aria-hidden="true" />
                  <h2 className="dashboard-tile-title">Private pool</h2>
                </div>
                <p className={cn(bodySmall, "text-brand-linen/88")}>
                  Your payments sit among every deposit in the pool. The
                  bigger the pool, the harder any one of them is to pick out.
                </p>
              </div>
            }
            footer={
              <div className="grid gap-0.5">
                <div className="flex items-baseline gap-2">
                  <span className="dashboard-stat">
                    {privateReady ? poolSize.toLocaleString("en-US") : "—"}
                  </span>
                  <span className={cn(bodySmall, "text-brand-linen/88")}>
                    deposits
                  </span>
                </div>
                <span className={cn(caption, "text-brand-linen/88")}>
                  {privateReady ? checkedAgo(indexedAt) : "Unlock to see"}
                </span>
              </div>
            }
          />
        </section>

        <section className="min-w-0">
          <LatestWithdrawalTile
            notes={notes}
            ready={privateReady}
            money={money}
          />
        </section>
      </div>

      <LinkEditorDialog
        mode="create"
        open={createOpen}
        username={username ?? ""}
        onOpenChange={setCreateOpen}
        onSaved={() => {
          setCreateOpen(false);
          void links.refetch();
        }}
      />
    </>
  );
}

function TileHeading({
  title,
  description,
  arrow,
}: {
  title: string;
  description?: string;
  arrow?: "light" | "dark";
}) {
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-4">
        <h2 className="dashboard-tile-title">{title}</h2>
        {arrow ? <QuietArrow tone={arrow} /> : null}
      </div>
      {description ? (
        <p
          className={cn(
            bodySmall,
            arrow === "light" ? "text-brand-linen/88" : "text-muted-foreground",
          )}
        >
          {description}
        </p>
      ) : null}
    </div>
  );
}

function Stat({
  value,
  label,
  tone = "linen",
}: {
  value: ReactNode;
  label: ReactNode;
  tone?: "linen" | "glass";
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="dashboard-stat">{value}</span>
      <span
        className={cn(
          bodySmall,
          tone === "glass" ? "text-brand-linen/88" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
    </div>
  );
}

function Chip({
  children,
  tone = "linen",
}: {
  children: ReactNode;
  tone?: "linen" | "glass";
}) {
  return (
    <span
      className={cn(
        "inline-flex h-7.5 items-center rounded-full px-3 text-xs leading-[1.0625rem] font-medium",
        tone === "glass"
          ? "bg-brand-obsidian/45 text-brand-linen"
          : "bg-foreground/7 text-foreground",
      )}
    >
      {children}
    </span>
  );
}

function AddCashTile({ payLink }: { payLink: string }) {
  return (
    <section className="min-w-0">
      <DashboardTile
        appearance="glass"
        className="text-brand-linen"
        header={
          <div className="grid gap-3">
            <div className="flex items-center justify-between gap-4">
              <h2 className="dashboard-tile-title">Add cash</h2>
              <a
                href={payLink || undefined}
                target="_blank"
                rel="noreferrer"
                aria-disabled={!payLink}
                aria-label="Add cash through your payment page"
                title="Add cash"
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-linen !text-brand-obsidian transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-linen focus-visible:ring-offset-2 focus-visible:ring-offset-brand-obsidian aria-disabled:pointer-events-none aria-disabled:opacity-45"
              >
                <Wallet className="size-[1.125rem]" aria-hidden="true" />
              </a>
            </div>
            <p className={cn(bodySmall, "text-brand-linen/88")}>
              Put money into your private balance by paying your own link.
              Use it for payments, or withdraw it whenever you need it.
            </p>
          </div>
        }
        footer={
          <div className="flex flex-wrap gap-1.5">
            <Chip tone="glass">Stellar wallet</Chip>
            <Chip tone="glass">USDC on other chains</Chip>
          </div>
        }
      />
    </section>
  );
}

function PayMeTile({ payLink }: { payLink: string }) {
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const qrTriggerRef = useRef<HTMLButtonElement>(null);
  const displayLink = payLink.replace(/^https?:\/\//, "");

  async function copyLink() {
    if (!payLink) return;
    await navigator.clipboard?.writeText(payLink);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <DashboardTile
      appearance="linen"
      header={
        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-4">
            <h2 className="dashboard-tile-title">Your payment link</h2>
            <Link
              href={LINKS_PATH}
              aria-label="Manage payment links"
              title="Manage payment links"
              className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <QuietArrow tone="dark" />
            </Link>
          </div>
          <p className={cn(bodySmall, "text-muted-foreground")}>
            Share this the way you&apos;d send an invoice. Your client
            doesn&apos;t need an Olio account.
          </p>
        </div>
      }
      content={
        <div className="mt-5 flex h-13 items-center truncate rounded-[1.125rem] bg-foreground/7 px-4 font-mono text-base leading-[1.375rem] font-semibold text-foreground">
          <span className="truncate">
            {displayLink || "Preparing your payment link…"}
          </span>
        </div>
      }
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <PayLinkAction
            primary
            label={copied ? "Link copied" : "Copy link"}
            onClick={copyLink}
            disabled={!payLink}
          >
            {copied ? <Check /> : <Copy />}
          </PayLinkAction>
          <PayLinkAction
            ref={qrTriggerRef}
            label="Show QR"
            onClick={() => setQrOpen(true)}
            disabled={!payLink}
          >
            <QrCode />
          </PayLinkAction>
          <a
            href={payLink || undefined}
            target="_blank"
            rel="noreferrer"
            aria-disabled={!payLink}
            className={cn(
              payActionClass,
              "aria-disabled:pointer-events-none aria-disabled:opacity-45",
            )}
          >
            <ExternalLink className="size-4" aria-hidden="true" /> Preview
          </a>
          {payLink ? (
            <PaymentQrDialog
              open={qrOpen}
              onOpenChange={setQrOpen}
              url={payLink}
              triggerRef={qrTriggerRef}
            />
          ) : null}
          <span className="sr-only" aria-live="polite">
            {copied ? "Link copied" : ""}
          </span>
        </div>
      }
    />
  );
}

const payActionClass =
  "inline-flex min-h-10 items-center gap-2 rounded-xl border border-(--control-border) bg-(--control) px-4 text-sm font-medium !text-(--control-foreground) transition-colors hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45";
const payPrimaryClass =
  "inline-flex min-h-10 items-center gap-2 rounded-xl bg-(--action) px-4 text-sm font-medium text-(--action-foreground) transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45";

const PayLinkAction = forwardRef(function PayLinkAction(
  {
    label,
    onClick,
    disabled,
    primary = false,
    children,
  }: {
    label: string;
    onClick: () => void;
    disabled: boolean;
    primary?: boolean;
    children: ReactNode;
  },
  ref: ForwardedRef<HTMLButtonElement>,
) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={primary ? payPrimaryClass : payActionClass}
    >
      <span className="[&_svg]:size-4" aria-hidden="true">
        {children}
      </span>
      {label}
    </button>
  );
});

function QuietArrow({ tone }: { tone: "light" | "dark" }) {
  return (
    <span
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-full transition-transform duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:-translate-y-0.5 group-hover:translate-x-0.5",
        tone === "light"
          ? "bg-brand-linen text-brand-obsidian"
          : "bg-primary text-primary-foreground",
      )}
      aria-hidden="true"
    >
      <ArrowUpRight className="size-[1.125rem]" />
    </span>
  );
}

const DAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"];

function WeeklyChart({ buckets }: { buckets: number[] }) {
  const values = buckets.length ? buckets : Array.from({ length: 7 }, () => 0);
  const max = Math.max(1, ...values);
  const peak = Math.max(...values);
  const today = new Date().getDay();
  const days = values.map((_, index) => DAY_INITIALS[(today + 1 + index) % 7]);

  return (
    <div className="grid gap-1.5">
      <div
        className="flex h-21 items-end gap-1.5"
        role="img"
        aria-label={`Payments over the last seven days: ${values.join(", ")}`}
      >
        {values.map((value, index) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed seven-day buckets
            key={index}
            className={cn(
              "min-h-1.5 flex-1 rounded-xl",
              value === 0
                ? "bg-foreground/12"
                : value === peak
                  ? "bg-linear-to-b from-(--action) to-(--action)/35"
                  : "bg-foreground/28",
            )}
            style={{ height: `${Math.max(7, (value / max) * 100)}%` }}
          />
        ))}
      </div>
      <div
        className="flex gap-1.5 text-center text-[0.6875rem] leading-[0.9375rem] font-medium text-muted-foreground"
        aria-hidden="true"
      >
        {days.map((day, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed seven-day buckets
          <span key={index} className="flex-1">
            {day}
          </span>
        ))}
      </div>
    </div>
  );
}

const STATUS_COLOR: Record<LinkStatusSummary["key"], string> = {
  paid: "bg-(--action)",
  pending: "bg-(--status-warning-fg)",
  archived: "bg-(--control-muted)",
};

function StatusTile({
  summary,
  loading,
  money,
}: {
  summary: LinkStatusSummary[];
  loading: boolean;
  money: (units: bigint) => string;
}) {
  const total = summary.reduce((sum, row) => sum + row.count, 0);

  return (
    <DashboardTile
      appearance="linen"
      className="min-h-75 justify-between"
      header={
        <div>
          <h2 className="dashboard-tile-title">Payment links by status</h2>
          <p className={cn(bodySmall, "mt-0.5 text-muted-foreground")}>
            {loading
              ? "Loading your links…"
              : `${total} ${total === 1 ? "link" : "links"} in total`}
          </p>
        </div>
      }
      content={
        <div
          className="mt-6 flex h-3 gap-1 overflow-hidden rounded-full bg-foreground/7"
          role="img"
          aria-label={summary
            .map((row) => `${row.label}: ${row.count}`)
            .join(", ")}
        >
          {total > 0
            ? summary
                .filter((row) => row.count > 0)
                .map((row) => (
                  <span
                    key={row.key}
                    className={STATUS_COLOR[row.key]}
                    style={{ flexGrow: row.count }}
                  />
                ))
            : null}
        </div>
      }
      footer={
        <ul className="grid gap-1.5">
          {summary.map((row) => (
            <li key={row.key}>
              <Link
                href={LINKS_PATH}
                className="flex items-center gap-2.5 rounded-lg py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span
                  className={cn("size-2.5 rounded-full", STATUS_COLOR[row.key])}
                  aria-hidden="true"
                />
                <span className="flex-1 text-[0.8125rem] leading-[1.125rem] font-medium">
                  {row.label}
                </span>
                <span className={cn(caption, "text-muted-foreground")}>
                  {row.count} {row.count === 1 ? "link" : "links"}
                </span>
                <span className="w-24 text-right text-[0.8125rem] leading-[1.125rem] font-semibold tabular-nums">
                  {money(row.amount)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      }
    />
  );
}

function StatusBadge({
  tone,
  children,
}: {
  tone: "success" | "warning" | "neutral";
  children: ReactNode;
}) {
  const tones = {
    success:
      "border-(--status-success-border) bg-(--status-success-bg) text-(--status-success-fg)",
    warning:
      "border-(--status-warning-border) bg-(--status-warning-bg) text-(--status-warning-fg)",
    neutral:
      "border-(--status-neutral-border) bg-(--status-neutral-bg) text-(--status-neutral-fg)",
  };
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs leading-[1.0625rem] font-medium",
        tones[tone],
      )}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {children}
    </span>
  );
}

function RecentPaymentsTile({
  notes,
  ready,
  locked,
  onUnlock,
  money,
}: {
  notes: MyNote[];
  ready: boolean;
  locked: boolean;
  onUnlock: () => void;
  money: (units: bigint) => string;
}) {
  const recent = useMemo(
    () =>
      [...notes]
        .sort((a, b) => (b.receivedAt ?? "").localeCompare(a.receivedAt ?? ""))
        .slice(0, 4),
    [notes],
  );

  return (
    <DashboardTile
      appearance="linen"
      className="min-h-75"
      header={
        <div className="flex items-start justify-between gap-4">
          <h2 className="dashboard-tile-title">Recent payments</h2>
          <Link
            href={HISTORY_PATH}
            aria-label="Open payments list"
            title="Open payments list"
            className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <QuietArrow tone="dark" />
          </Link>
        </div>
      }
      footer={
        locked ? (
          <div className="grid justify-items-start gap-3">
            <p className={cn(bodySmall, "text-muted-foreground")}>
              Unlock with your PIN to see your payments.
            </p>
            <button
              type="button"
              onClick={onUnlock}
              className={payPrimaryClass}
            >
              Unlock
            </button>
          </div>
        ) : !ready ? (
          <div className="grid gap-3" aria-hidden="true">
            {[0, 1, 2].map((row) => (
              <div
                key={row}
                className="h-9 rounded-lg bg-foreground/7 motion-safe:animate-pulse"
              />
            ))}
          </div>
        ) : recent.length === 0 ? (
          <p className={cn(bodySmall, "text-muted-foreground")}>
            No payments yet. Share your payment link to get paid privately.
          </p>
        ) : (
          <ul className="divide-y divide-(--line-soft)">
            {recent.map((note) => (
              <li key={note.leafIndex}>
                <Link
                  href={HISTORY_PATH}
                  className="flex items-center gap-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="truncate text-[0.8125rem] leading-[1.125rem] font-semibold">
                      Private payment
                    </span>
                    <span
                      className={cn(caption, "truncate text-muted-foreground")}
                    >
                      Payment #{note.leafIndex}
                      {note.receivedAt
                        ? ` · ${formatWhen(note.receivedAt)}`
                        : ""}
                    </span>
                  </span>
                  {note.spent ? (
                    <StatusBadge tone="neutral">Withdrawn</StatusBadge>
                  ) : (
                    <StatusBadge tone="success">In balance</StatusBadge>
                  )}
                  <span className="w-22 text-right text-[0.8125rem] leading-[1.125rem] font-semibold tabular-nums">
                    {money(note.amount)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )
      }
    />
  );
}

function TopLinksTile({
  links,
  money,
}: {
  links: { id: string; label: string; amount: bigint }[];
  money: (units: bigint) => string;
}) {
  const max = links.reduce((m, link) => (link.amount > m ? link.amount : m), 1n);

  return (
    <DashboardTile
      appearance="linen"
      className="min-h-75"
      header={
        <div>
          <h2 className="dashboard-tile-title">Top payment links</h2>
          <p className={cn(bodySmall, "mt-0.5 text-muted-foreground")}>
            Paid links, by amount
          </p>
        </div>
      }
      footer={
        links.length === 0 ? (
          <p className={cn(bodySmall, "text-muted-foreground")}>
            When a client pays one of your links, it shows here.
          </p>
        ) : (
          <ul className="grid gap-5">
            {links.map((link) => (
              <li key={link.id} className="flex items-center gap-3.5">
                <span className="w-32 truncate text-[0.8125rem] leading-[1.125rem] font-medium sm:w-52">
                  {link.label}
                </span>
                <span className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-foreground/7">
                  <span
                    className="block h-full rounded-full bg-(--action)"
                    style={{
                      width: `${Math.max(4, Number((link.amount * 100n) / max))}%`,
                    }}
                  />
                </span>
                <span className="w-21 text-right text-[0.8125rem] leading-[1.125rem] font-semibold tabular-nums">
                  {money(link.amount)}
                </span>
              </li>
            ))}
          </ul>
        )
      }
    />
  );
}

function LatestWithdrawalTile({
  notes,
  ready,
  money,
}: {
  notes: MyNote[];
  ready: boolean;
  money: (units: bigint) => string;
}) {
  const latest = useMemo(
    () =>
      notes
        .filter((note) => note.spent)
        .sort((a, b) => (b.spentAt ?? "").localeCompare(a.spentAt ?? ""))[0],
    [notes],
  );

  return (
    <DashboardTile
      appearance="linen"
      className="min-h-75 justify-between"
      header={<h2 className="dashboard-tile-title">Latest withdrawal</h2>}
      footer={
        !ready ? (
          <p className={cn(bodySmall, "text-muted-foreground")}>
            Unlock to see your withdrawals.
          </p>
        ) : latest ? (
          <div className="grid justify-items-start gap-3">
            <div className="grid gap-1">
              <span className="text-2xl leading-[1.875rem] font-semibold tracking-[-0.0125em] tabular-nums">
                {money(latest.amount)}
              </span>
              <span className="text-[0.8125rem] leading-[1.125rem] font-medium">
                From your private balance
              </span>
              {latest.spentAt ? (
                <span className={cn(caption, "text-muted-foreground")}>
                  {formatWhen(latest.spentAt)}
                </span>
              ) : null}
            </div>
            <StatusBadge tone="success">Completed</StatusBadge>
          </div>
        ) : (
          <p className={cn(bodySmall, "text-muted-foreground")}>
            No withdrawals yet.
          </p>
        )
      }
    />
  );
}
