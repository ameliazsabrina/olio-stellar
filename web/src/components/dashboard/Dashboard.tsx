"use client";

import {
  ArrowUpRight,
  Check,
  CircleArrowDown,
  Copy,
  ExternalLink,
  Plus,
  QrCode,
} from "lucide-react";
import Image from "next/image";
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
import { HISTORY_PATH, WITHDRAW_PATH } from "../../lib/auth-routes";
import {
  moneyGramCashInEnabled,
  moneyGramCashInUnavailableReason,
} from "../../lib/moneygram-status";
import { useWallet } from "../WalletProvider";
import { AddCashDialog } from "./AddCashDialog";
import { BalanceCard } from "./BalanceCard";
import { DashboardTile } from "./DashboardTile";
import { weeklyActivity } from "./dashboardAnalytics";
import { LinkEditorDialog } from "./LinkEditorDialog";
import { PaymentQrDialog } from "./PaymentQrDialog";
import { ReceiveDialog } from "./ReceiveDialog";
import { useMyNotes } from "./useMyNotes";

const tileFocus =
  "group block min-h-full rounded-[2.25rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-linen focus-visible:ring-offset-4 focus-visible:ring-offset-brand-obsidian";

export function Dashboard() {
  const { address, username, accountUnlocked, promptUnlock } = useWallet();
  const [origin, setOrigin] = useState("");
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [addCashOpen, setAddCashOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const { notes, claimable, loading, refreshing, stale, refresh } =
    useMyNotes(address);
  const insight = useMemo(() => weeklyActivity(notes), [notes]);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const payLink = username && origin ? `${origin}/pay/${username}` : "";
  const locked = Boolean(address) && !accountUnlocked;
  const proofCount = locked || loading ? null : notes.length;

  return (
    <>
      <h1 className="sr-only">Dashboard: Hi, {username || "there"}.</h1>

      <div className="dashboard-bento mx-auto grid max-w-6xl grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-12 lg:grid-rows-2 lg:gap-5 pb-16">
        <section
          aria-label="Account summary"
          className="order-1 min-w-0 lg:col-span-3 lg:col-start-1 lg:row-start-1"
        >
          <BalanceCard
            claimable={claimable}
            loading={loading}
            locked={locked}
            onUnlock={promptUnlock}
            onReceive={() => setReceiveOpen(true)}
            onRefresh={refresh}
            refreshing={refreshing}
            stale={stale}
          />
        </section>

        <button
          type="button"
          onClick={() => setAddCashOpen(true)}
          disabled={!moneyGramCashInEnabled || loading}
          className={`${tileFocus} order-2 w-full text-left disabled:cursor-not-allowed disabled:opacity-55 lg:col-span-3 lg:col-start-4 lg:row-start-1`}
          aria-label="Open deposit funds"
          aria-describedby={
            moneyGramCashInUnavailableReason
              ? "deposit-funds-unavailable"
              : undefined
          }
          title={moneyGramCashInUnavailableReason ?? "Add cash with MoneyGram"}
        >
          <DashboardTile
            appearance="glass"
            className="dashboard-nav-card text-brand-linen"
            header={
              <div className="flex items-start justify-between gap-4">
                <h2 className="dashboard-tile-title text-brand-linen">
                  Deposit fund
                </h2>
                <span
                  className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
                  aria-hidden="true"
                >
                  <CircleArrowDown className="size-4" />
                </span>
              </div>
            }
            content={
              <div className="mt-4 max-w-52 text-sm leading-5 text-brand-linen/65">
                <p>
                  Add money to your Olio balance. Use it for payments, or
                  withdraw it whenever you need it.
                </p>
                {moneyGramCashInUnavailableReason ? (
                  <p
                    id="deposit-funds-unavailable"
                    className="mt-3 font-medium text-brand-linen/80"
                  >
                    {moneyGramCashInUnavailableReason}
                  </p>
                ) : null}
              </div>
            }
            footer={
              <div className="flex items-center -space-x-2">
                <MoneyGramLogo />
                <DurianpayLogo />
              </div>
            }
          />
        </button>

        <section className="order-3 min-w-0 md:col-span-2 lg:col-span-6 lg:col-start-7 lg:row-start-1">
          <PayMeTile payLink={payLink} onCreate={() => setCreateOpen(true)} />
        </section>

        <Link
          href={HISTORY_PATH}
          className={`${tileFocus} order-4 lg:col-span-3 lg:col-start-1 lg:row-start-2`}
          aria-label="Open Payment proofs"
        >
          <DashboardTile
            appearance="glass"
            className="dashboard-nav-card text-brand-linen"
            header={
              <div className="flex items-start justify-between gap-4">
                <h2 className="dashboard-tile-title text-brand-linen">
                  Proof your Payment
                </h2>
                <QuietArrow />
              </div>
            }
            content={
              <p className="mt-4 max-w-52 text-sm leading-5 text-brand-linen/65">
                Generate a PDF that proves your payment, just like a receipt.
              </p>
            }
            footer={
              <div className="flex items-end gap-2">
                <span className="font-mono text-5xl font-medium leading-none tabular-nums">
                  {proofCount ?? "—"}
                </span>
                <span className="pb-1 text-sm leading-4 text-brand-linen/75">
                  Available
                  <br />
                  PDFs
                </span>
              </div>
            }
          />
        </Link>

        <section className="order-5 lg:col-span-3 lg:col-start-4 lg:row-start-2">
          <DashboardTile
            appearance="linen"
            header={<h2 className="dashboard-tile-title">Weekly Insight</h2>}
            content={
              <div className="mt-6">
                <WeeklyChart buckets={insight.buckets} />
              </div>
            }
            footer={
              <div className="grid grid-cols-2 gap-5">
                <InsightTotal value={insight.received} label="Cash In" />
                <InsightTotal value={insight.cashedOut} label="Cash Out" />
              </div>
            }
          />
        </section>

        <Link
          href={WITHDRAW_PATH}
          className={`${tileFocus} order-6 lg:col-span-3 lg:col-start-7 lg:row-start-2`}
          aria-label="Open Withdraw"
        >
          <DashboardTile
            appearance="linen"
            className="dashboard-nav-card"
            header={
              <div className="flex items-start justify-between gap-4">
                <h2 className="dashboard-tile-title">Withdraw</h2>
                <QuietArrow />
              </div>
            }
            content={
              <p className="mt-4 max-w-52 text-sm leading-5 text-muted-foreground">
                Move a private payment to a Stellar wallet or an available cash
                anchor.
              </p>
            }
            footer={
              <div className="flex items-center -space-x-2">
                <span className="flex size-12 items-center justify-center overflow-hidden rounded-full bg-brand-obsidian ring-2 ring-brand-linen">
                  <Image
                    src="/assets/stellar-black.webp"
                    alt="Stellar"
                    width={36}
                    height={36}
                    className="size-9 object-contain"
                  />
                </span>
                <MoneyGramLogo />
              </div>
            }
          />
        </Link>

        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          disabled={!username}
          className={`${tileFocus} order-7 w-full text-left disabled:cursor-not-allowed disabled:opacity-55 lg:col-span-3 lg:col-start-10 lg:row-start-2`}
          aria-label="Create a payment link"
        >
          <DashboardTile
            appearance="glass"
            className="dashboard-nav-card items-center justify-center text-center text-brand-linen"
            content={
              <div className="grid justify-items-center gap-5">
                <Plus className="size-11" aria-hidden="true" />
                <h2 className="font-heading text-2xl font-medium tracking-tight">
                  Payment Link
                </h2>
              </div>
            }
            footer={
              <span className="text-sm font-medium text-brand-linen/65">
                Create a payment link
              </span>
            }
          />
        </button>
      </div>

      <ReceiveDialog
        open={receiveOpen}
        onClose={() => setReceiveOpen(false)}
        username={username ?? ""}
        origin={origin}
      />
      <AddCashDialog
        open={addCashOpen}
        onOpenChange={setAddCashOpen}
        onComplete={refresh}
      />
      <LinkEditorDialog
        mode="create"
        open={createOpen}
        username={username ?? ""}
        onOpenChange={setCreateOpen}
        onSaved={() => setCreateOpen(false)}
      />
    </>
  );
}

function PayMeTile({
  payLink,
  onCreate,
}: {
  payLink: string;
  onCreate: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const qrTriggerRef = useRef<HTMLButtonElement>(null);
  const displayLink = payLink.replace(/^https?:\/\//, "");

  async function copyLink() {
    if (!payLink) return;
    await navigator.clipboard?.writeText(payLink);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <DashboardTile
      appearance="linen"
      header={
        <div className="flex items-start justify-between gap-5">
          <div>
            <h2 className="dashboard-tile-title">Pay Me!</h2>
            <p className="mt-2 max-w-sm text-sm leading-5 text-muted-foreground">
              Your shareable link for receiving payments seamlessly.
            </p>
          </div>
          <button
            type="button"
            onClick={onCreate}
            className="rounded-full p-1 text-foreground transition-transform duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] hover:rotate-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-obsidian"
            aria-label="Create a payment link"
            title="Create payment link"
          >
            <Plus className="size-9" aria-hidden="true" />
          </button>
        </div>
      }
      content={
        <div className="mt-6 truncate rounded-full bg-brand-obsidian/6 px-5 py-3 font-mono text-base font-semibold text-foreground ring-1 ring-brand-obsidian/5 sm:text-lg">
          {displayLink || "Preparing your payment link…"}
        </div>
      }
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <PayLinkAction
            label={copied ? "Link copied" : "Copy link"}
            onClick={copyLink}
            disabled={!payLink}
          >
            {copied ? <Check /> : <Copy />}
          </PayLinkAction>
          <PayLinkAction
            ref={qrTriggerRef}
            label="Show QR code"
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
            className="flex min-h-10 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold !text-primary-foreground transition-colors hover:bg-primary/85 hover:!text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 aria-disabled:pointer-events-none aria-disabled:opacity-45"
          >
            <ExternalLink className="size-4" aria-hidden="true" /> Open link
          </a>
          {payLink ? (
            <PaymentQrDialog
              open={qrOpen}
              onOpenChange={setQrOpen}
              url={payLink}
              triggerRef={qrTriggerRef}
            />
          ) : null}
        </div>
      }
    />
  );
}

const PayLinkAction = forwardRef(function PayLinkAction(
  {
    label,
    onClick,
    disabled,
    children,
  }: {
    label: string;
    onClick: () => void;
    disabled: boolean;
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
      className="flex min-h-10 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45"
      aria-label={label}
      title={label}
    >
      <span className="[&_svg]:size-4">{children}</span>
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
});

function QuietArrow() {
  return (
    <span
      className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
      aria-hidden="true"
    >
      <ArrowUpRight className="size-4" />
    </span>
  );
}

function WeeklyChart({ buckets }: { buckets: number[] }) {
  const max = Math.max(1, ...buckets);
  const dayKeys = [
    "day-1",
    "day-2",
    "day-3",
    "day-4",
    "day-5",
    "day-6",
    "day-7",
  ];
  return (
    <div
      className="flex h-20 items-end gap-2 border-b border-border px-1"
      role="img"
      aria-label={`Seven day activity: ${buckets.join(", ")}`}
    >
      {buckets.map((value, index) => (
        <span
          key={dayKeys[index]}
          className="min-h-1 flex-1 rounded-t-full bg-foreground/75"
          style={{ height: `${Math.max(8, (value / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

function InsightTotal({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex items-end gap-2">
      <span className="font-mono text-4xl font-medium leading-none tabular-nums">
        {value}
      </span>
      <span className="pb-0.5 text-sm leading-4">{label}</span>
    </div>
  );
}

function MoneyGramLogo() {
  return (
    <span className="flex size-12 items-center justify-center overflow-hidden rounded-full ring-2 ring-brand-linen bg-brand-linen p-2">
      <Image
        src="/assets/moneygram.svg"
        alt="MoneyGram"
        width={48}
        height={48}
        className="size-12 object-contain"
      />
    </span>
  );
}

function DurianpayLogo() {
  return (
    <span
      className="flex size-12 items-center justify-center overflow-hidden rounded-full bg-brand-linen p-2 ring-2 ring-brand-linen"
      title="Durianpay support is coming soon"
    >
      <Image
        src="/assets/durianpay.png"
        alt="Durianpay, coming soon"
        width={32}
        height={32}
        className="size-8 object-contain"
      />
    </span>
  );
}
