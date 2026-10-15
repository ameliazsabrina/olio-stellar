import { BadgeCheck, CircleSlash, Clock } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { DashboardBackground } from "@/components/dashboard/DashboardBackground";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { DashboardTile } from "@/components/dashboard/DashboardTile";
import { formatUsdc } from "@/lib/documentPdf";
import { cn } from "@/lib/utils";
import {
  statementIdSchema,
  type VerifyStatementOutput,
} from "@/server/modules/passport/passport.schema";
import { verifyStatement } from "@/server/modules/passport/passport.statement";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Olio statement check",
  description: "Confirm that an Olio payment statement is genuine.",
  robots: { index: false, follow: false },
};

type Statement = NonNullable<VerifyStatementOutput>;

const HEADINGS: Record<Statement["status"], string> = {
  valid: "Statement verified by Olio",
  revoked: "Statement revoked",
  expired: "Statement expired",
};

const DETAIL: Record<Statement["detail"], string> = {
  summary: "Monthly summary",
  full: "Full payment list",
};

function utcDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function utcDateTime(value: string): string {
  return `${new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  }).format(new Date(value))} UTC`;
}

function StatusNote({ statement }: { statement: Statement }) {
  const Icon =
    statement.status === "valid"
      ? BadgeCheck
      : statement.status === "revoked"
        ? CircleSlash
        : Clock;
  const text =
    statement.status === "valid"
      ? `Valid until ${utcDate(statement.expiresAt)}. Olio issued this statement and its content has a recorded digest.`
      : statement.status === "revoked"
        ? `The business revoked this statement on ${utcDate(statement.revokedAt ?? statement.issuedAt)}. Do not rely on it.`
        : `This statement expired on ${utcDate(statement.expiresAt)}. Ask the business for a current one.`;
  return (
    <div
      data-testid="statement-status"
      data-status={statement.status}
      className={cn(
        "flex items-start gap-3 rounded-[1.5rem] p-5 ring-1",
        statement.status === "valid"
          ? "bg-brand-linen text-brand-obsidian ring-brand-obsidian/10"
          : "bg-brand-linen/8 text-brand-linen ring-brand-linen/15",
      )}
    >
      <Icon className="mt-0.5 size-6 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-heading text-xl font-semibold tracking-tight">
          {statement.businessName ?? "Unnamed business"}
        </p>
        <p
          className={cn(
            "text-sm leading-6",
            statement.status === "valid"
              ? "text-brand-obsidian/70"
              : "text-brand-linen/70",
          )}
        >
          {text}
        </p>
      </div>
    </div>
  );
}

export default async function VerifyStatementPage({
  params,
}: {
  params: Promise<{ statementId: string }>;
}) {
  const { statementId } = await params;
  const parsed = statementIdSchema.safeParse(statementId);
  const statement = parsed.success ? await verifyStatement(parsed.data) : null;

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
          <h1 className="sr-only">Olio statement check</h1>
          <DashboardTile
            appearance="glass"
            className="min-h-0 text-brand-linen"
            header={
              <h2 className="dashboard-tile-title text-brand-linen">
                {statement ? HEADINGS[statement.status] : "Statement not found"}
              </h2>
            }
            content={
              <div className="mt-6 space-y-5">
                {statement ? (
                  <>
                    <StatusNote statement={statement} />
                    <p className="text-sm leading-6 text-brand-linen/80">
                      Issued by Olio on {utcDate(statement.issuedAt)} for{" "}
                      {statement.businessName ?? "an unnamed business"},
                      covering {utcDate(statement.period.from)} to{" "}
                      {utcDate(statement.period.to)} (UTC). Payment records were
                      complete as of {utcDateTime(statement.recordsAsOf)}.
                    </p>
                    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                      {[
                        [
                          "Total received",
                          formatUsdc(BigInt(statement.summary.totalReceived)),
                        ],
                        ["Payments", String(statement.summary.paymentCount)],
                        [
                          "Distinct payers",
                          String(statement.summary.distinctPayers),
                        ],
                        ["Detail", DETAIL[statement.detail]],
                      ].map(([term, value]) => (
                        <div key={term}>
                          <dt className="text-xs text-brand-linen/60">
                            {term}
                          </dt>
                          <dd className="font-medium">{value}</dd>
                        </div>
                      ))}
                    </dl>
                    <div className="space-y-2">
                      <p className="text-xs text-brand-linen/60">
                        SHA-256 digest. It must match the digest printed in the
                        PDF.
                      </p>
                      <code
                        className="block break-all rounded-lg bg-brand-linen/8 px-3 py-2 font-mono text-xs"
                        data-testid="statement-digest"
                      >
                        {statement.digest}
                      </code>
                    </div>
                    <p className="text-xs leading-5 text-brand-linen/60">
                      {statement.identityCurrent
                        ? "The business's identity verification with Olio is current."
                        : "The business's identity verification with Olio is no longer current."}
                    </p>
                  </>
                ) : (
                  <p
                    className="max-w-md text-sm leading-6 text-brand-linen/70"
                    data-testid="statement-not-found"
                  >
                    Olio has no statement with this link. Check that the link
                    matches the one printed on the PDF.
                  </p>
                )}
                <p className="max-w-xl text-xs leading-5 text-brand-linen/60">
                  A payment statement lists payments that settled to this
                  business through Olio, excluding self-funded and fully
                  refunded ones. It does not verify customers, creditworthiness
                  or legal compliance.
                </p>
              </div>
            }
          />
        </div>
      </DashboardShell>
    </DashboardBackground>
  );
}
